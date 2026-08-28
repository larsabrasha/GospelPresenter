namespace GospelPresenter.Client.Auth;

/// <summary>
/// Where the device token lives at rest. The MAUI app implements this over SecureStorage
/// (keychain/keystore); tests use an in-memory fake. The token is the only secret the app holds —
/// the identity next to it is not sensitive and lives in a plain file.
/// </summary>
public interface ISecureTokenStore
{
    Task<string?> GetTokenAsync();
    Task SetTokenAsync(string token);
    Task RemoveTokenAsync();
}
