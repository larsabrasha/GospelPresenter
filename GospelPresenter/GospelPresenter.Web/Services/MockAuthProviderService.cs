using GospelPresenter.Shared.Services;

namespace GospelPresenter.Web.Services;

/// <summary>
/// No-op auth provider service for mock mode. Returns no enabled providers
/// since authentication is handled automatically by MockAuthenticationStateProvider.
/// </summary>
public class MockAuthProviderService : IAuthProviderService
{
    public IReadOnlyList<AuthProvider> EnabledProviders { get; } = [];

    public bool IsEnabled(string providerId) => false;
}
