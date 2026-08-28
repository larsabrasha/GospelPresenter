using GospelPresenter.Client.Auth;

namespace GospelPresenter.Services;

/// <summary>The device token at rest in the platform keychain/keystore.</summary>
public class MauiSecureTokenStore : ISecureTokenStore
{
    private const string Key = "gp_device_token";

    public Task<string?> GetTokenAsync() => SecureStorage.Default.GetAsync(Key);

    public Task SetTokenAsync(string token) => SecureStorage.Default.SetAsync(Key, token);

    public Task RemoveTokenAsync()
    {
        SecureStorage.Default.Remove(Key);
        return Task.CompletedTask;
    }
}
