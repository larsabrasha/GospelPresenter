namespace GospelPresenter.Shared.Utils;

public sealed class Debouncer : IDisposable
{
    private readonly int delayMs;
    private CancellationTokenSource? cts;
    private bool disposed;

    public Debouncer(int delayMs = 500)
    {
        this.delayMs = delayMs;
    }

    public void Run(Func<Task> action)
    {
        if (disposed) return;
        var old = cts;
        cts = new CancellationTokenSource();
        old?.Cancel();
        old?.Dispose();
        _ = RunAsync(action, cts.Token);
    }

    private async Task RunAsync(Func<Task> action, CancellationToken token)
    {
        try
        {
            await Task.Delay(delayMs, token);
            if (!disposed)
                await action();
        }
        catch (TaskCanceledException) { }
    }

    public void Dispose()
    {
        if (disposed) return;
        disposed = true;
        cts?.Cancel();
        cts?.Dispose();
    }
}
