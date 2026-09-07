namespace GospelPresenter.UnitTests.Support;

/// <summary>
/// A clock the test moves by hand: the system clock plus an offset, so rows the test writes through
/// the real SaveChanges (stamped with the real time) stay ordered against it, and Advance() moves the
/// clock ahead of anything written before the call. Hand-written rather than a package for one method.
/// </summary>
public sealed class ManualClock : TimeProvider
{
    private TimeSpan offset;

    public ManualClock(DateTimeOffset start)
    {
        offset = start - DateTimeOffset.UtcNow;
    }

    public DateTimeOffset UtcNow => DateTimeOffset.UtcNow + offset;

    public override DateTimeOffset GetUtcNow() => UtcNow;

    public void Advance(TimeSpan by) => offset += by;
}
