using System.Security.Claims;
using Microsoft.AspNetCore.Components.Authorization;
using Microsoft.AspNetCore.Components.Server.Circuits;

namespace GospelPresenter.Web.Live;

/// <summary>
/// Tells <see cref="ConnectedUserRegistry"/> when a circuit comes and goes, and who is on it.
///
/// Scoped, so there is one of these per circuit — which is what makes the circuit id it is handed
/// safe to keep in a field.
///
/// The identity is read twice on purpose. Whether the authentication state has been set by the
/// time the connection comes up is not something this can rely on, and a circuit recorded with no
/// name would sit in the view as an anonymous row for as long as the tab was open; subscribing as
/// well means that whenever the state does arrive, the row is filled in.
/// </summary>
public class ConnectedUserCircuitHandler(
    AuthenticationStateProvider authenticationStateProvider,
    ConnectedUserRegistry registry,
    ILogger<ConnectedUserCircuitHandler> logger) : CircuitHandler, IDisposable
{
    private string? circuitId;

    public override async Task OnConnectionUpAsync(Circuit circuit, CancellationToken cancellationToken)
    {
        if (circuitId is null)
        {
            circuitId = circuit.Id;
            authenticationStateProvider.AuthenticationStateChanged += OnAuthenticationStateChanged;
        }

        registry.MarkConnected(circuit.Id);
        await RecordAsync();
    }

    public override Task OnConnectionDownAsync(Circuit circuit, CancellationToken cancellationToken)
    {
        registry.MarkDisconnected(circuit.Id);
        return Task.CompletedTask;
    }

    public override Task OnCircuitClosedAsync(Circuit circuit, CancellationToken cancellationToken)
    {
        registry.Remove(circuit.Id);
        return Task.CompletedTask;
    }

    private void OnAuthenticationStateChanged(Task<AuthenticationState> state) => _ = RecordAsync(state);

    private async Task RecordAsync(Task<AuthenticationState>? state = null)
    {
        if (circuitId is not { } id) return;

        try
        {
            var user = (await (state ?? authenticationStateProvider.GetAuthenticationStateAsync())).User;
            if (user.Identity?.IsAuthenticated != true) return;

            var userId = user.FindFirst("user_id")?.Value ?? user.FindFirst(ClaimTypes.NameIdentifier)?.Value;
            if (userId is null) return;

            registry.Record(
                id,
                userId,
                user.FindFirst(ClaimTypes.Name)?.Value ?? user.Identity.Name ?? userId,
                user.FindFirst("organization_id")?.Value,
                user.FindFirst(ClaimTypes.Role)?.Value ?? "");
        }
        catch (Exception e)
        {
            // Never worth a circuit. Nobody is served by a page failing to open because a list of
            // who else is online could not be updated.
            logger.LogDebug(e, "Could not record who is on circuit {CircuitId}", id);
        }
    }

    public void Dispose() =>
        authenticationStateProvider.AuthenticationStateChanged -= OnAuthenticationStateChanged;
}
