using System.ComponentModel;
using GospelPresenter.Client.Auth;
using GospelPresenter.Shared.Live;
using GospelPresenter.Shared.State;
using Microsoft.AspNetCore.SignalR.Client;
using Microsoft.Extensions.Logging;

namespace GospelPresenter.Client.Live;

/// <summary>
/// Mirrors this device's live presentation to the server, and applies what a controller sends back.
///
/// The device stays the owner throughout. Nothing here decides what the projector shows — the local
/// <see cref="SharedAppState"/> does, exactly as it did before any of this existed, and this class
/// only watches it and reports. A command that arrives from a phone is applied to that same local
/// state and then echoed back like any other change, so the connection can drop at any moment and
/// the service continues untouched.
/// </summary>
public class LiveSessionClient : ILiveSessionMirror, IAsyncDisposable
{
    private readonly SharedAppState sharedAppState;
    private readonly DeviceAuthService auth;
    private readonly string apiBaseUrl;
    private readonly Func<CancellationToken, Task>? prepare;
    private readonly ILogger<LiveSessionClient> logger;

    private readonly SemaphoreSlim gate = new(1, 1);
    private readonly CancellationTokenSource lifetime = new();

    private HubConnection? connection;
    private CancellationTokenSource? sessionScope;
    private string? sessionId;
    private MirroredSessionState? lastSent;

    /// <summary>
    /// Where the mirroring has got to. The presentation itself is unaffected by all of it — the
    /// projector is driven by the local state and starts the moment the operator says so.
    /// </summary>
    public LiveMirrorStatus Status { get; private set; } = LiveMirrorStatus.Off;

    /// <summary>
    /// Applies a command to the local state. Set by the host, because turning a selection into a
    /// live slide needs the presentation the operator has open — which lives in the UI, not here.
    /// Until it is set, a device mirrors upward but cannot be driven.
    /// </summary>
    public Func<MirroredSessionCommand, Task>? CommandHandler { get; set; }

    /// <summary>Raised when the connection comes or goes, for the status indicator.</summary>
    public event Action? Changed;

    public bool IsConnected => connection?.State == HubConnectionState.Connected;

    /// <param name="prepare">
    /// Gets this device's content onto the server before anything is mirrored. The server rebuilds
    /// slides from its own copy of the presentation, so mirroring a presentation it has not
    /// received yet would show a phone and a congregation the wrong thing — or nothing.
    /// </param>
    public LiveSessionClient(
        SharedAppState sharedAppState,
        DeviceAuthService auth,
        string apiBaseUrl,
        Func<CancellationToken, Task>? prepare,
        ILogger<LiveSessionClient> logger)
    {
        this.sharedAppState = sharedAppState;
        this.auth = auth;
        this.apiBaseUrl = apiBaseUrl;
        this.prepare = prepare;
        this.logger = logger;
    }

    /// <summary>
    /// Begins mirroring the given session. Called when a presentation goes live rather than at
    /// startup: a device that is not presenting has nothing to mirror and no reason to hold a
    /// connection open.
    /// </summary>
    public async Task StartAsync(string sessionId)
    {
        await gate.WaitAsync(lifetime.Token);
        try
        {
            if (this.sessionId == sessionId && connection is not null) return;

            await StopConnectionAsync();
            this.sessionId = sessionId;
            lastSent = null;

            connection = BuildConnection();
            connection.On<MirroredSessionCommand>(LiveSessionHubMethods.ApplyCommand, HandleCommandAsync);
            connection.Reconnected += OnReconnectedAsync;
            connection.Closed += OnClosedAsync;

            sharedAppState.PropertyChanged += OnSharedStateChanged;

            sessionScope = CancellationTokenSource.CreateLinkedTokenSource(lifetime.Token);
            var scope = sessionScope.Token;

            // Not awaited. The operator has just pressed start and the projector is already lit; a
            // sync that has megabytes of media to push must never be what stands between them and
            // the first slide.
            _ = Task.Run(() => PrepareThenConnectAsync(scope), scope);
        }
        finally
        {
            gate.Release();
        }

        SetStatus(LiveMirrorStatus.Preparing);
    }

    /// <summary>
    /// Waits until this device's content is on the server, then starts mirroring. Retries for as
    /// long as the presentation lasts: a service that begins offline should start mirroring by
    /// itself the moment the network comes back, without anyone having to notice or intervene.
    /// </summary>
    private async Task PrepareThenConnectAsync(CancellationToken scope)
    {
        var attempt = 0;
        while (!scope.IsCancellationRequested)
        {
            try
            {
                if (prepare is not null)
                    await prepare(scope);

                await ConnectAsync(scope);
                if (IsConnected) return;
            }
            catch (OperationCanceledException)
            {
                return;
            }
            catch (Exception e)
            {
                logger.LogDebug(e, "Could not prepare the live session for mirroring; will retry");
            }

            SetStatus(LiveMirrorStatus.Waiting);

            var delay = TimeSpan.FromSeconds(Math.Min(30, Math.Pow(2, Math.Min(attempt++, 5))));
            try
            {
                await Task.Delay(delay, scope);
            }
            catch (OperationCanceledException)
            {
                return;
            }
        }
    }

    /// <summary>
    /// Stops mirroring, telling the server the presentation is over. Distinct from the connection
    /// dropping, which leaves the session frozen rather than ending it.
    /// </summary>
    public async Task StopAsync()
    {
        await gate.WaitAsync(CancellationToken.None);
        try
        {
            sharedAppState.PropertyChanged -= OnSharedStateChanged;

            if (connection is { State: HubConnectionState.Connected })
            {
                try
                {
                    await connection.InvokeAsync(LiveSessionHubMethods.EndSession, lifetime.Token);
                }
                catch (Exception e)
                {
                    // The server drops the session on its own once it goes stale, so a failure
                    // here costs a slow cleanup rather than a wrong one.
                    logger.LogDebug(e, "Could not tell the server the live session ended");
                }
            }

            await StopConnectionAsync();
            sessionId = null;
            lastSent = null;
        }
        finally
        {
            gate.Release();
        }

        SetStatus(LiveMirrorStatus.Off);
    }

    private HubConnection BuildConnection() =>
        new HubConnectionBuilder()
            .WithUrl($"{apiBaseUrl.TrimEnd('/')}{LiveSessionHubMethods.Path}", options =>
            {
                // The .NET client puts this on the Authorization header for every transport,
                // including the WebSocket handshake — the server's device token handler reads
                // nothing else, and a token in a query string would end up in access logs.
                options.AccessTokenProvider = () => Task.FromResult(auth.Token);
            })
            // The default schedule gives up after about a minute. A service runs for an hour and a
            // half, and a router that reboots halfway through must not end the mirroring for good.
            .WithAutomaticReconnect(new ForeverRetryPolicy())
            .Build();

    private async Task ConnectAsync(CancellationToken scope)
    {
        if (connection is null) return;

        try
        {
            await connection.StartAsync(scope);
            await SendStateAsync(force: true);
            SetStatus(LiveMirrorStatus.Mirroring);
            logger.LogInformation("Mirroring live session {SessionId} to the server", sessionId);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception e)
        {
            // Offline is the normal case this app is built for, not an error. The caller waits and
            // tries again; until it succeeds the presentation simply runs unmirrored.
            logger.LogDebug(e, "Could not reach the live session hub; will keep trying");
        }
    }

    private void SetStatus(LiveMirrorStatus status)
    {
        if (Status == status) return;
        Status = status;
        Changed?.Invoke();
    }

    private async Task OnReconnectedAsync(string? _)
    {
        // The server may have been restarted and know nothing about this session. The state is
        // absolute, so re-sending it is the whole of the resynchronisation.
        await SendStateAsync(force: true);
        SetStatus(LiveMirrorStatus.Mirroring);
    }

    private Task OnClosedAsync(Exception? _)
    {
        SetStatus(LiveMirrorStatus.Waiting);
        return Task.CompletedTask;
    }

    private void OnSharedStateChanged(object? sender, PropertyChangedEventArgs e)
    {
        // SharedAppState raises PropertyChanged with the session id as the property name.
        if (e.PropertyName != sessionId) return;

        _ = SendStateAsync(force: false);
    }

    private async Task SendStateAsync(bool force)
    {
        if (sessionId is null || connection is not { State: HubConnectionState.Connected }) return;

        // The shared reader, not a copy of it: the server decides whether a change came from
        // this device by comparing the two descriptions, and they have to be built the same way.
        var state = MirroredSessionStateReader.Read(sharedAppState, sessionId);
        if (state is null) return;

        // Every write to the live state raises a change, including ones that alter nothing this
        // protocol carries. Sending only real differences keeps a long service to a message per
        // slide rather than a message per keystroke elsewhere in the app.
        if (!force && state == lastSent) return;

        try
        {
            await connection.InvokeAsync(LiveSessionHubMethods.ReportState, state, lifetime.Token);
            lastSent = state;
        }
        catch (Exception e)
        {
            // Dropped mid-send: the reconnect handler re-sends the current state, which by then is
            // whatever the operator has moved on to. Nothing is queued, because nothing should be —
            // a slide the operator has already left is not worth delivering late.
            logger.LogDebug(e, "Could not report the live session state");
        }
    }

    private async Task HandleCommandAsync(MirroredSessionCommand command)
    {
        if (CommandHandler is not { } handler) return;

        try
        {
            await handler(command);
        }
        catch (Exception e)
        {
            logger.LogWarning(e, "Could not apply a remote command");
        }
    }

    private async Task StopConnectionAsync()
    {
        if (sessionScope is not null)
        {
            await sessionScope.CancelAsync();
            sessionScope.Dispose();
            sessionScope = null;
        }

        if (connection is null) return;

        connection.Reconnected -= OnReconnectedAsync;
        connection.Closed -= OnClosedAsync;

        try
        {
            await connection.DisposeAsync();
        }
        catch (Exception e)
        {
            logger.LogDebug(e, "Failed to dispose the live session connection");
        }

        connection = null;
    }

    public async ValueTask DisposeAsync()
    {
        sharedAppState.PropertyChanged -= OnSharedStateChanged;
        await lifetime.CancelAsync();
        await StopConnectionAsync();
        lifetime.Dispose();
        gate.Dispose();
        GC.SuppressFinalize(this);
    }

    /// <summary>
    /// Backs off to half a minute and then keeps trying for as long as the presentation lasts.
    /// Giving up is never the right answer here: the operator has no way to ask for a retry, and a
    /// network that comes back should simply resume mirroring.
    /// </summary>
    private sealed class ForeverRetryPolicy : IRetryPolicy
    {
        public TimeSpan? NextRetryDelay(RetryContext retryContext) => retryContext.PreviousRetryCount switch
        {
            0 => TimeSpan.Zero,
            1 => TimeSpan.FromSeconds(2),
            2 => TimeSpan.FromSeconds(5),
            3 => TimeSpan.FromSeconds(10),
            _ => TimeSpan.FromSeconds(30)
        };
    }
}

/// <summary>Where a device has got to in offering its live presentation to the server.</summary>
public enum LiveMirrorStatus
{
    /// <summary>Nothing is being presented, or this host does not mirror at all.</summary>
    Off,

    /// <summary>Getting this device's content onto the server before anything is offered.</summary>
    Preparing,

    /// <summary>Offered and reachable: a phone can drive it and a public output can follow it.</summary>
    Mirroring,

    /// <summary>The server cannot be reached. The presentation carries on regardless.</summary>
    Waiting
}
