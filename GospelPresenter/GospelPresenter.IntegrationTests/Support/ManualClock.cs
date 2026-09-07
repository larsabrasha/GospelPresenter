namespace GospelPresenter.IntegrationTests.Support;

/// <summary>A clock the test moves by hand. Hand-written rather than a package for one method.</summary>
public sealed class ManualClock(DateTimeOffset start) : TimeProvider
{
    public DateTimeOffset UtcNow { get; set; } = start;

    public override DateTimeOffset GetUtcNow() => UtcNow;

    public void Advance(TimeSpan by) => UtcNow += by;
}
