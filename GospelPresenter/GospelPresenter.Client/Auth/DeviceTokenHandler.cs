using System.Net.Http.Headers;

namespace GospelPresenter.Client.Auth;

/// <summary>Adds the device token as a Bearer header on every API call the sync engine makes.</summary>
public class DeviceTokenHandler(DeviceAuthService auth) : DelegatingHandler
{
    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        if (auth.Token is { } token)
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return base.SendAsync(request, cancellationToken);
    }
}
