using GospelPresenter.Shared.Services;
using GospelPresenter.Shared.State;

namespace GospelPresenter.Shared.HttpClients;

public class AuthTokenHandler(AppState appState, IHeaderService headerService) : DelegatingHandler
{
    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        var token = appState.LoggedInUser?.Token;
        
        if (!string.IsNullOrWhiteSpace(token))
        {
            request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);
            
            foreach (var (headerKey, value) in headerService.AppHeaders)
            {
                request.Headers.TryAddWithoutValidation(headerKey, value);
            }
        }

        return await base.SendAsync(request, cancellationToken);
    }
}
