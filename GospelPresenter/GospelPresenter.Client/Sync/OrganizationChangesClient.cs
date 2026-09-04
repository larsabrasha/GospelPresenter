using System.Net;
using GospelPresenter.Client.Auth;
using GospelPresenter.Shared.Sync;
using Microsoft.AspNetCore.Http.Connections.Client;
using Microsoft.AspNetCore.SignalR.Client;
using Microsoft.Extensions.Logging;

namespace GospelPresenter.Client.Sync;

/// <summary>
/// Holds the doorbell open: a socket to the server that says nothing and only listens, so that a
/// change made somewhere else reaches this device in about a second instead of waiting for the idle
/// pull.
///
/// Nothing about syncing moves here. The announcement's whole content is "ask again", and the asking
/// is the same HTTP push and pull it always was — which is why losing this socket costs latency and
/// not correctness, and why the scheduler's <see cref="SyncScheduler.IdlePullInterval"/> is kept.
///
/// Connected for as long as the device is signed in, unlike <c>LiveSessionClient</c>, which connects
/// only while something is being presented.
/// </summary>
public sealed class OrganizationChangesClient : IAsyncDisposable
{
    private readonly SyncScheduler scheduler;
    private readonly DeviceAuthService auth;
    private readonly string apiBaseUrl;
    private readonly Action<HttpConnectionOptions>? configureConnection;
    private readonly ILogger<OrganizationChangesClient> logger;

    private readonly SemaphoreSlim gate = new(1, 1);
    private readonly CancellationTokenSource lifetime = new();

    private HubConnection? connection;
    private CancellationTokenSource? attempts;
    private bool started;

    /// <param name="configureConnection">
    /// Extra transport configuration. The app passes nothing; the integration suite uses it to
    /// point the connection at the in-process test server, which has no sockets — so that these
    /// retry and reconnection paths are exercised by tests rather than only by hand.
    /// </param>
    public OrganizationChangesClient(
        SyncScheduler scheduler,
        DeviceAuthService auth,
        string apiBaseUrl,
        ILogger<OrganizationChangesClient> logger,
        Action<HttpConnectionOptions>? configureConnection = null)
    {
        this.scheduler = scheduler;
        this.auth = auth;
        this.apiBaseUrl = apiBaseUrl;
        this.logger = logger;
        this.configureConnection = configureConnection;
    }

    public bool IsConnected => connection?.State == HubConnectionState.Connected;

    /// <summary>
    /// Begins listening, and keeps the connection in step with the sign-in state from then on: a
    /// device that signs out stops listening, and one that signs in on the login page starts
    /// without waiting for a restart.
    /// </summary>
    public void Start()
    {
        if (started)
            return;
        started = true;

        auth.Changed += OnAuthChanged;
        if (auth.IsSignedIn)
            _ = ConnectAsync();
    }

    private void OnAuthChanged()
    {
        if (auth.IsSignedIn)
            _ = ConnectAsync();
        else
            _ = StopAsync();
    }

    private async Task ConnectAsync()
    {
        await gate.WaitAsync(lifetime.Token);
        CancellationToken scope;
        try
        {
            if (connection is not null)
                return;

            connection = BuildConnection();
            // No arguments to read: the announcement is the message. What changed, and whether any
            // of it matters here, is the pull's business.
            connection.On(OrganizationChangesHubMethods.OrganizationChanged, OnAnnouncement);
            connection.Reconnected += OnReconnectedAsync;

            attempts = CancellationTokenSource.CreateLinkedTokenSource(lifetime.Token);
            scope = attempts.Token;
        }
        finally
        {
            gate.Release();
        }

        // Not awaited by the caller: this retries for as long as it takes, and nothing the user is
        // looking at depends on it.
        _ = Task.Run(() => StartWithRetriesAsync(scope), scope);
    }

    /// <summary>
    /// Keeps trying until the socket is up. A device that starts in a church hall with no working
    /// wifi should begin listening by itself the moment the network appears, without anyone
    /// noticing there was anything to fix.
    ///
    /// Except for a rejected token: that will not fix itself, and the sync engine already tells the
    /// user what to do about it.
    /// </summary>
    private async Task StartWithRetriesAsync(CancellationToken scope)
    {
        var attempt = 0;
        while (!scope.IsCancellationRequested)
        {
            try
            {
                if (connection is null)
                    return;

                await connection.StartAsync(scope);
                logger.LogInformation("Listening for change announcements");

                // Whatever happened before this socket existed is unknown, and asking is cheap.
                scheduler.NotifyRemoteChanges();
                return;
            }
            catch (OperationCanceledException)
            {
                return;
            }
            catch (HttpRequestException e) when (e.StatusCode == HttpStatusCode.Unauthorized)
            {
                // Retrying forever here would leave a decommissioned machine knocking on the hub
                // until someone reads the server's logs. The sync engine reaches AuthRequired on its
                // own, and signing in again raises auth.Changed, which starts this over.
                logger.LogWarning("The device token was rejected by the change hub; not retrying");
                await StopAsync();
                return;
            }
            catch (Exception e)
            {
                // Offline is the normal state this app is built for, not an error.
                logger.LogDebug(e, "Could not reach the change hub; will keep trying");
            }

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

    private void OnAnnouncement() => scheduler.NotifyRemoteChanges();

    private Task OnReconnectedAsync(string? _)
    {
        // Anything at all may have happened while the socket was down, and any announcement made
        // during it was sent to a connection that no longer existed.
        scheduler.NotifyRemoteChanges();
        return Task.CompletedTask;
    }

    private HubConnection BuildConnection() =>
        new HubConnectionBuilder()
            .WithUrl($"{apiBaseUrl.TrimEnd('/')}{OrganizationChangesHubMethods.Path}", options =>
            {
                // On the Authorization header for every transport, the WebSocket handshake
                // included — the server's device token handler reads nothing else, and a token in a
                // query string would end up in access logs.
                options.AccessTokenProvider = () => Task.FromResult(auth.Token);
                configureConnection?.Invoke(options);
            })
            // The default schedule gives up after about a minute. This connection is meant to last
            // as long as the app is open, and a router that reboots must not leave a device quietly
            // back on five-minute polling for the rest of the evening.
            .WithAutomaticReconnect(new ForeverRetryPolicy())
            .Build();

    private async Task StopAsync()
    {
        await gate.WaitAsync(CancellationToken.None);
        try
        {
            if (attempts is not null)
            {
                await attempts.CancelAsync();
                attempts.Dispose();
                attempts = null;
            }

            if (connection is null)
                return;

            connection.Reconnected -= OnReconnectedAsync;
            try
            {
                await connection.DisposeAsync();
            }
            catch (Exception e)
            {
                logger.LogDebug(e, "Failed to dispose the change hub connection");
            }

            connection = null;
        }
        finally
        {
            gate.Release();
        }
    }

    private bool disposed;

    public async ValueTask DisposeAsync()
    {
        if (disposed)
            return;
        disposed = true;

        auth.Changed -= OnAuthChanged;
        await lifetime.CancelAsync();
        await StopAsync();
        lifetime.Dispose();
        gate.Dispose();
    }

    /// <summary>
    /// Backs off to half a minute and then keeps trying. Giving up is never right here: the user has
    /// no way to ask for a retry, and a network that comes back should simply resume listening.
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
