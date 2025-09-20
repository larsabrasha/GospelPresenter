using GospelPresenter.Shared.Services;

namespace GospelPresenter.Shared.HttpClients;

public class AppHeadersHandler(IHeaderService headerService) : DelegatingHandler
{
    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        foreach (var (headerKey, value) in headerService.AppHeaders)
        {
            request.Headers.TryAddWithoutValidation(headerKey, value);
        }

        return await base.SendAsync(request, cancellationToken);
    }
}
