using GospelPresenter.Shared.Services;
using GospelPresenter.Web.Configuration;
using Microsoft.Extensions.Options;

namespace GospelPresenter.Web.Services;

public class AuthProviderService : IAuthProviderService
{
    public IReadOnlyList<AuthProvider> EnabledProviders { get; }

    public AuthProviderService(IOptions<AuthenticationOptions> options)
    {
        var providers = new List<AuthProvider>();
        var auth = options.Value;

        if (auth.Google.Enabled && !string.IsNullOrEmpty(auth.Google.ClientId))
            providers.Add(new AuthProvider("google", "Google"));

        if (auth.OpenIdConnect.Enabled && !string.IsNullOrEmpty(auth.OpenIdConnect.ClientId))
            providers.Add(new AuthProvider("oidc", auth.OpenIdConnect.DisplayName));

        EnabledProviders = providers.AsReadOnly();
    }

    public bool IsEnabled(string providerId) =>
        EnabledProviders.Any(p => p.Id == providerId);
}
