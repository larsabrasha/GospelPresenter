using GospelPresenter.Client.Auth;
using Serilog;

namespace GospelPresenter.Services;

/// <summary>
/// The device token at rest in the platform keychain/keystore, with a fallback for the one host
/// that cannot offer a keychain yet. Mac Catalyst wants the keychain-access-groups entitlement,
/// which an ad-hoc signature cannot carry — macOS kills the app at launch for asking — so
/// SecureStorage throws MissingEntitlement there and the token goes to Preferences instead:
/// plaintext, but inside the app's own sandboxed container.
///
/// The fallback deliberately applies to Release builds too. Refusing there would only protect
/// against a threat that does not exist yet: without an Apple developer account the app is
/// neither notarised nor distributable, so the only person a refusal locks out is whoever built
/// it. Once the entitlement is in place the keychain succeeds and this path stops being reached;
/// narrow it back to a hard failure then.
/// </summary>
public class MauiSecureTokenStore : ISecureTokenStore
{
    private const string Key = "gp_device_token";

    public async Task<string?> GetTokenAsync()
    {
        try
        {
            return await SecureStorage.Default.GetAsync(Key) ?? FallbackGet();
        }
        catch (Exception e)
        {
            Log.Warning("The keychain is unavailable ({Message}); reading the fallback store", e.Message);
            return FallbackGet();
        }
    }

    public async Task SetTokenAsync(string token)
    {
        try
        {
            await SecureStorage.Default.SetAsync(Key, token);
        }
        catch (Exception e)
        {
            Log.Warning("The keychain is unavailable ({Message}); storing the token unencrypted in Preferences", e.Message);
            Preferences.Default.Set(Key, token);
        }
    }

    public Task RemoveTokenAsync()
    {
        try
        {
            SecureStorage.Default.Remove(Key);
        }
        catch (Exception)
        {
            // The fallback below is the only copy then.
        }
        Preferences.Default.Remove(Key);
        return Task.CompletedTask;
    }

    private static string? FallbackGet() => Preferences.Default.Get<string?>(Key, null);
}
