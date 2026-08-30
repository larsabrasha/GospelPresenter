namespace GospelPresenter.Client.Sync;

/// <summary>
/// "Something was written to the local database." Raised by <see cref="LocalWriteInterceptor"/> and
/// listened to by <see cref="SyncScheduler"/>, which is the only thing that decides what to do
/// about it.
///
/// A separate object rather than a direct reference because of construction order: both hosts build
/// their DbContextOptions — and therefore the interceptor — long before the container that holds
/// the scheduler exists.
///
/// Raised from inside a database operation, so a handler must return immediately.
/// </summary>
public sealed class LocalWriteSignal
{
    public event Action? Written;

    public void Raise() => Written?.Invoke();
}
