using GospelPresenter.Shared.Live;

namespace GospelPresenter.Web.Live;

/// <summary>
/// Ends mirrored sessions whose owning device has been gone long enough that it is not coming back.
///
/// Losing the connection freezes rather than stops, deliberately: a public output keeps the slide it
/// has, so a few seconds of bad wifi are invisible to a congregation. That is right for a few
/// seconds and wrong for the rest of the evening — a machine that was shut, killed, or carried out
/// of the building left its session running here, holding its screens and public outputs and
/// sitting on the dashboard.
///
/// The general session timeout in <c>SharedAppState</c> is not an answer to this. It is four hours,
/// it measures the last touch rather than the last sign of life — a read of the live slide counts,
/// so a visitor's phone reconnecting to a public output re-arms it — and it is swept only from
/// inside a touch, so on a quiet server nothing runs it at all. This is a real timer, it measures
/// how long the owner has actually been unreachable, and it ends the session the same way the
/// device's own Stop would: outputs released, registration removed.
/// </summary>
public class AbandonedSessionReaper(
    IServiceScopeFactory scopes,
    MirroredSessionRegistry registry,
    Shared.State.SharedAppState sharedAppState,
    TimeSpan endAfter,
    TimeSpan sweepEvery,
    ILogger<AbandonedSessionReaper> logger) : BackgroundService
{
    /// <summary>
    /// Which of these have been abandoned. Static and pure so the rule can be read and tested
    /// without a clock or a host: the sweep below is only this plus the ending.
    /// </summary>
    public static IReadOnlyList<string> Abandoned(
        IEnumerable<MirroredSession> sessions, TimeSpan endAfter, DateTimeOffset now) => sessions
        .Where(s => !s.OwnerConnected && now - s.OwnerLastSeen >= endAfter)
        .Select(s => s.SessionId)
        .ToList();

    /// <summary>
    /// Ends everything abandoned as of <paramref name="now"/>. Public so a test can run one sweep
    /// against a clock of its own rather than waiting out the interval.
    /// </summary>
    public void Sweep(DateTimeOffset now)
    {
        // The general session timeout, given a heartbeat while we are here. It is swept only from
        // inside a touch, so a browser session left behind on a server that then went quiet
        // outlived its own timeout until somebody started something else.
        sharedAppState.SweepStaleSessions();

        foreach (var sessionId in Abandoned(registry.All(), endAfter, now))
        {
            // A scope per session: the projector is scoped, as it is for the hub call and for the
            // controller's button, and one failure must not stop the rest being cleaned up.
            try
            {
                using var scope = scopes.CreateScope();
                scope.ServiceProvider.GetRequiredService<ILiveSessionEnder>().End(sessionId);
                logger.LogInformation(
                    "Ended live session {SessionId}: its device has been unreachable for over {Minutes} minutes",
                    sessionId, (int)endAfter.TotalMinutes);
            }
            catch (Exception e)
            {
                logger.LogError(e, "Could not end the abandoned live session {SessionId}", sessionId);
            }
        }
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(sweepEvery);

        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            // Never lets the host down over a sweep: the next tick tries again, and the manual
            // route — a controller's own button — is still there in the meantime.
            try
            {
                Sweep(DateTimeOffset.UtcNow);
            }
            catch (Exception e)
            {
                logger.LogError(e, "Sweeping for abandoned live sessions failed");
            }
        }
    }
}
