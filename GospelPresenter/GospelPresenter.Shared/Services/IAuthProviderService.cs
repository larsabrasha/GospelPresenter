namespace GospelPresenter.Shared.Services;

public record AuthProvider(string Id, string DisplayName);

public interface IAuthProviderService
{
    IReadOnlyList<AuthProvider> EnabledProviders { get; }
    bool IsEnabled(string providerId);
}
