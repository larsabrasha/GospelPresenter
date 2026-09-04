namespace GospelPresenter.Shared.Sync;

/// <summary>
/// Marks the work a particular device's push is doing, so a change announcement can leave that
/// device out — it already has the change it just sent, and answering it with its own echo would
/// cost every push an extra empty sync cycle.
///
/// Ambient rather than a parameter because the writes it has to cover happen deep inside
/// <c>SaveChanges</c>, several layers below the endpoint that knows which device is calling.
/// Threading a device id through every service signature to be read by an interceptor would be a
/// worse trade: dozens of touched methods, and every future write path a chance to forget.
///
/// Nothing outside a device push ever sets this, so "no scope" and "a browser wrote it" are the same
/// thing — which is correct, since a browser belongs to no device and excludes nobody.
/// </summary>
public static class DeviceWriteScope
{
    private static readonly AsyncLocal<string?> CurrentDevice = new();

    /// <summary>The device whose push is being applied on this execution path, if any.</summary>
    public static string? CurrentDeviceId => CurrentDevice.Value;

    /// <summary>
    /// Opens the scope for the duration of one push. Restores the previous value rather than
    /// clearing it, so nesting cannot leave the ambient state half set.
    /// </summary>
    public static IDisposable For(string? deviceId)
    {
        var previous = CurrentDevice.Value;
        CurrentDevice.Value = deviceId;
        return new Restore(previous);
    }

    private sealed class Restore(string? previous) : IDisposable
    {
        private bool disposed;

        public void Dispose()
        {
            if (disposed)
                return;
            disposed = true;
            CurrentDevice.Value = previous;
        }
    }
}
