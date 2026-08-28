#if IOS || MACCATALYST
using System.Collections.Concurrent;
using Foundation;
using GospelPresenter.Client.Media;
using WebKit;

namespace GospelPresenter.Handlers;

/// <summary>
/// Serves <c>gpmedia://media/api/...</c> requests inside the webview from the local media store.
/// Components render these URLs because MauiProgram installed ImageUrlHelper.HostUrlTransform;
/// the actual resolution (path → key → blob, theme art, range slicing) lives in the testable
/// <see cref="MediaRequestHandler"/> — this class only marshals WebKit's threading rules: work
/// happens in the background, every task callback on the main thread, and never after WebKit
/// said stop (that would throw and take the app down).
/// </summary>
public class GpMediaSchemeHandler : NSObject, IWKUrlSchemeHandler
{
    public const string Scheme = "gpmedia";

    private readonly ConcurrentDictionary<IntPtr, bool> stoppedTasks = new();

    private static MediaRequestHandler Media =>
        IPlatformApplication.Current!.Services.GetRequiredService<MediaRequestHandler>();

    [Export("webView:startURLSchemeTask:")]
    public void StartUrlSchemeTask(WKWebView webView, IWKUrlSchemeTask urlSchemeTask)
    {
        var taskHandle = urlSchemeTask.Handle.Handle;
        var url = urlSchemeTask.Request.Url;
        var path = url?.Path;
        var rangeHeader = urlSchemeTask.Request.Headers?["Range"]?.ToString();

        _ = Task.Run(async () =>
        {
            MediaResponse? response;
            try
            {
                response = path is null ? null : await Media.HandleAsync(path, rangeHeader);
            }
            catch (Exception)
            {
                response = null;
            }

            MainThread.BeginInvokeOnMainThread(() =>
            {
                if (stoppedTasks.TryRemove(taskHandle, out _) || url is null)
                    return;

                try
                {
                    if (response is null)
                    {
                        Send(urlSchemeTask, url, 404, [], new NSMutableDictionary<NSString, NSString>());
                        return;
                    }

                    var headers = new NSMutableDictionary<NSString, NSString>
                    {
                        [(NSString)"Content-Type"] = (NSString)response.ContentType,
                        [(NSString)"Content-Length"] = (NSString)response.Data.Length.ToString(),
                        [(NSString)"Accept-Ranges"] = (NSString)"bytes",
                        [(NSString)"Cache-Control"] = (NSString)"no-cache",
                    };
                    if (response.ContentRange is not null)
                        headers[(NSString)"Content-Range"] = (NSString)response.ContentRange;

                    Send(urlSchemeTask, url, response.Status, response.Data, headers);
                }
                catch (Exception)
                {
                    // WebKit throws if the task was invalidated between our check and the call;
                    // there is nothing left to answer.
                }
            });
        });
    }

    private static void Send(
        IWKUrlSchemeTask task, NSUrl url, int status, byte[] data, NSMutableDictionary<NSString, NSString> headers)
    {
        using var response = new NSHttpUrlResponse(url, status, "HTTP/1.1", headers);
        task.DidReceiveResponse(response);
        if (data.Length > 0)
            task.DidReceiveData(NSData.FromArray(data));
        task.DidFinish();
    }

    [Export("webView:stopURLSchemeTask:")]
    public void StopUrlSchemeTask(WKWebView webView, IWKUrlSchemeTask urlSchemeTask)
    {
        stoppedTasks[urlSchemeTask.Handle.Handle] = true;
    }
}
#endif
