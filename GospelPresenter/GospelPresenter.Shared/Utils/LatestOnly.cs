namespace GospelPresenter.Shared.Utils;

/// <summary>
/// Runs background work where only the newest run matters, cancelling the one before it.
///
/// The search fields all want the same thing: a query typed a moment ago is worthless once a
/// newer one arrives, and the work has to happen off the renderer's thread so a slow search does
/// not block the circuit and queue every UI event behind it.
///
/// Sibling of <see cref="Debouncer"/>: that one delays, this one supersedes. The waiting is done
/// in the browser now (see initThrottledInput in utils.js), so what is left server-side is
/// exactly the superseding.
/// </summary>
public sealed class LatestOnly : IDisposable
{
    private CancellationTokenSource? cts;
    private bool disposed;

    /// <summary>
    /// Runs <paramref name="work"/> on a thread-pool thread and hands the result to
    /// <paramref name="apply"/> back on the caller's context — unless a newer call arrived
    /// first, in which case nothing happens at all. <paramref name="work"/> must only touch
    /// state that is safe to read from another thread.
    /// </summary>
    public async Task RunAsync<T>(Func<T> work, Func<T, Task> apply)
    {
        if (disposed) return;

        var token = Restart();

        try
        {
            var result = await Task.Run(work, token);
            token.ThrowIfCancellationRequested();
            await apply(result);
        }
        catch (OperationCanceledException)
        {
            // A newer call took over, or the field was cleared while this one was running.
        }
    }

    /// <summary>For callers whose <paramref name="apply"/> has nothing to await.</summary>
    public Task RunAsync<T>(Func<T> work, Action<T> apply) =>
        RunAsync(work, result =>
        {
            apply(result);
            return Task.CompletedTask;
        });

    /// <summary>Abandons whatever is running, without starting anything new.</summary>
    public void Cancel()
    {
        cts?.Cancel();
    }

    private CancellationToken Restart()
    {
        var old = cts;
        cts = new CancellationTokenSource();
        old?.Cancel();
        old?.Dispose();
        return cts.Token;
    }

    public void Dispose()
    {
        if (disposed) return;
        disposed = true;
        cts?.Cancel();
        cts?.Dispose();
    }
}
