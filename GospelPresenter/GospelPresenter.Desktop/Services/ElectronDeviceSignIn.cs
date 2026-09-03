using System.Net.Http.Json;
using ElectronNET.API;
using GospelPresenter.Client.Auth;
using GospelPresenter.Shared.Models;
using GospelPresenter.Shared.Services;

namespace GospelPresenter.Desktop.Services;

/// <summary>
/// The interactive device sign-in for the desktop: opens the server's /app-login in the system
/// browser — never a window of our own, because Google refuses OAuth in embedded webviews — and
/// waits for the token to arrive back on this installation's callback scheme.
///
/// The flow is the MAUI app's: one endpoint, one shape, and the token travels in a URL fragment,
/// which no server ever sees. The loopback redirect that native desktop apps often use instead
/// would have meant a second server-side branch and a token in this app's own request log.
///
/// The scheme, though, is this installation's rather than a constant. An operating system routes a
/// scheme to exactly one application, so Prod and Test sharing gospelpresenter:// would mean a
/// sign-in against one server handing its token to whichever of the two the OS picked. The server
/// is told which one to answer on, and allow-lists it — see DeviceTokenEndpoints.
///
/// How the URL gets here differs by platform, and Electron papers over most of it: macOS delivers
/// it to the running app as an open-url event, while Windows and Linux start a second process with
/// the URL in its arguments, which the single-instance lock forwards to the first.
/// </summary>
public class ElectronDeviceSignIn(
    DeviceAuthService auth,
    IHttpClientFactory httpClientFactory,
    string apiBaseUrl,
    ILogger<ElectronDeviceSignIn> logger) : IDeviceSignIn
{
    private static string CallbackScheme => DesktopBuild.CallbackScheme;

    /// <summary>Long enough for a real sign-in with a password manager and a second factor.</summary>
    private static readonly TimeSpan CallbackTimeout = TimeSpan.FromMinutes(5);

    private TaskCompletionSource<Uri>? pendingCallback;

    /// <summary>
    /// Claims the scheme and starts listening, once, at startup. Registering is not enough on its
    /// own: the OS needs to know which application answers for gospelpresenter://, and the
    /// single-instance lock is what keeps a second launch from becoming a second app.
    /// </summary>
    public async Task InitialiseAsync()
    {
        await Electron.App.SetAsDefaultProtocolClientAsync(CallbackScheme);

        // macOS delivers the callback to the running app as an open-url event; the event does not
        // exist on the other platforms, which start a second process instead — handled below.
        if (OperatingSystem.IsMacOS())
            Electron.App.OpenUrl += url => Deliver(url);

        await Electron.App.RequestSingleInstanceLockAsync((argv, _) =>
        {
            var url = Array.Find(argv, a => a.StartsWith($"{CallbackScheme}://", StringComparison.OrdinalIgnoreCase));
            if (url is not null)
                Deliver(url);
        });
    }

    public async Task<bool> SignInAsync(CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrEmpty(apiBaseUrl))
        {
            logger.LogWarning("Sign-in attempted but no server URL is configured");
            return false;
        }

        // One at a time. A second attempt while the browser is still open would otherwise leave the
        // first waiter to be completed by a callback it no longer expects.
        var callback = new TaskCompletionSource<Uri>(TaskCreationOptions.RunContinuationsAsynchronously);
        if (Interlocked.CompareExchange(ref pendingCallback, callback, null) is not null)
        {
            logger.LogDebug("A sign-in is already waiting for its callback");
            return false;
        }

        try
        {
            var deviceName = Environment.MachineName;
            // callback_scheme is what keeps two installed builds apart. A server that does not
            // know the parameter ignores it and answers on gospelpresenter://, which is right for
            // Prod and wrong for the others — so a Test build against an old server fails to hear
            // back rather than taking the real app's place, which is the safer of the two.
            await Electron.Shell.OpenExternalAsync(
                $"{apiBaseUrl}/app-login?device={Uri.EscapeDataString(deviceName)}" +
                $"&callback_scheme={Uri.EscapeDataString(CallbackScheme)}");

            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            timeout.CancelAfter(CallbackTimeout);

            Uri url;
            try
            {
                url = await callback.Task.WaitAsync(timeout.Token);
            }
            catch (OperationCanceledException)
            {
                // The user closed the browser, or walked away. Neither is an error.
                logger.LogDebug("The sign-in was abandoned before the callback arrived");
                return false;
            }

            var token = FragmentValue(url, "token");
            if (string.IsNullOrEmpty(token))
            {
                logger.LogError("The sign-in callback carried no token");
                return false;
            }

            return await CompleteAsync(token, cancellationToken);
        }
        finally
        {
            Interlocked.CompareExchange(ref pendingCallback, null, callback);
        }
    }

    public Task SignOutAsync() => auth.SignOutAsync();

    /// <summary>
    /// Turns the token into a cached identity. /api/me is resolved fresh from the server's database
    /// rather than read out of the callback, so the app starts from the same picture the server has
    /// rather than from whatever the login page happened to know.
    /// </summary>
    private async Task<bool> CompleteAsync(string token, CancellationToken cancellationToken)
    {
        try
        {
            using var http = httpClientFactory.CreateClient();
            http.BaseAddress = new Uri(apiBaseUrl);
            http.DefaultRequestHeaders.Authorization =
                new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);

            var me = await http.GetFromJsonAsync<MeResponse>("/api/me", cancellationToken);
            if (me?.OrganizationId is null)
            {
                logger.LogError("Could not load the signed-in user's profile");
                return false;
            }

            await auth.SignInAsync(token, ToIdentity(me));

            logger.LogInformation("Signed in as {UserId} in organization {OrganizationId}",
                me.Id, me.OrganizationId);
            return true;
        }
        catch (Exception e)
        {
            logger.LogError(e, "The sign-in could not be completed");
            return false;
        }
    }

    /// <summary>
    /// Brings a stored identity up to date with the server, and is how an installation that signed
    /// in before the device id existed acquires one. Silent on failure: the app is expected to run
    /// for weeks without reaching the server, and a stale identity is not a reason to disturb
    /// anyone — the cached one keeps working exactly as it did.
    /// </summary>
    public async Task RefreshIdentityAsync(CancellationToken cancellationToken = default)
    {
        if (auth.Token is not { } token) return;

        try
        {
            using var http = httpClientFactory.CreateClient();
            http.BaseAddress = new Uri(apiBaseUrl);
            http.DefaultRequestHeaders.Authorization =
                new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);

            var me = await http.GetFromJsonAsync<MeResponse>("/api/me", cancellationToken);
            if (me?.OrganizationId is null) return;

            var refreshed = ToIdentity(me);
            if (refreshed == auth.CurrentIdentity) return;

            await auth.UpdateIdentityAsync(refreshed);
            logger.LogDebug("Refreshed the stored identity for {UserId}", me.Id);
        }
        catch (Exception e)
        {
            logger.LogDebug(e, "Could not refresh the stored identity; keeping the cached one");
        }
    }

    private static DeviceIdentity ToIdentity(MeResponse me) => new(
        me.Id, me.Name, me.Email,
        Enum.TryParse<UserRole>(me.Role, out var role) ? role : UserRole.User,
        me.OrganizationId ?? "", me.OrganizationName ?? "", me.DeviceId);

    private void Deliver(string url)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var parsed))
            return;

        if (!string.Equals(parsed.Scheme, CallbackScheme, StringComparison.OrdinalIgnoreCase))
            return;

        // A callback with nobody waiting is not an error: the OS will happily hand us one after a
        // timeout, or because someone clicked an old link.
        if (pendingCallback?.TrySetResult(parsed) is not true)
            logger.LogDebug("A {Scheme} callback arrived with no sign-in waiting for it", CallbackScheme);
    }

    private static string? FragmentValue(Uri url, string key)
    {
        var fragment = url.Fragment.TrimStart('#');
        foreach (var pair in fragment.Split('&', StringSplitOptions.RemoveEmptyEntries))
        {
            var separator = pair.IndexOf('=');
            if (separator > 0 && pair[..separator] == key)
                return Uri.UnescapeDataString(pair[(separator + 1)..]);
        }

        return null;
    }

    private sealed record MeResponse(
        string Id,
        string Name,
        string Email,
        string Role,
        string? OrganizationId,
        string? OrganizationName,
        string? DeviceId);
}
