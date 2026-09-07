using GospelPresenter.Web.Security;
using GospelPresenter.IntegrationTests.Support;
using Shouldly;

namespace GospelPresenter.IntegrationTests.Services;

public class FailureThrottleTests
{
    private readonly ManualClock clock = new(DateTimeOffset.Parse("2026-09-07T10:00:00Z"));

    [Fact]
    public void IsBlocked_BelowTheThreshold_IsFalse_AndAtIt_IsTrue()
    {
        var throttle = new FailureThrottle(clock);

        for (var i = 0; i < FailureThrottle.MaxFailures - 1; i++)
            throttle.RecordFailure("1.2.3.4");
        throttle.IsBlocked("1.2.3.4").ShouldBeFalse();

        throttle.RecordFailure("1.2.3.4");
        throttle.IsBlocked("1.2.3.4").ShouldBeTrue();
        throttle.IsBlocked("5.6.7.8").ShouldBeFalse();
    }

    [Fact]
    public void IsBlocked_OnceTheWindowHasPassed_IsFalseAgain()
    {
        var throttle = new FailureThrottle(clock);
        for (var i = 0; i < FailureThrottle.MaxFailures; i++)
            throttle.RecordFailure("1.2.3.4");

        clock.Advance(FailureThrottle.Window + TimeSpan.FromSeconds(1));

        throttle.IsBlocked("1.2.3.4").ShouldBeFalse();
        // And a new failure starts a fresh count rather than reviving the old one.
        throttle.RecordFailure("1.2.3.4");
        throttle.IsBlocked("1.2.3.4").ShouldBeFalse();
    }
}
