using CommandLine;
using GospelPresenter.Screenshots;

using var cts = new CancellationTokenSource();
Console.CancelKeyPress += (_, e) =>
{
    Console.WriteLine("\nCancelling...");
    cts.Cancel();
    e.Cancel = true;
};

return await Parser.Default.ParseArguments<Options>(args)
    .MapResult(
        options => new ScreenshotCapturer(options, cts.Token).RunAsync(),
        _ => Task.FromResult(1));
