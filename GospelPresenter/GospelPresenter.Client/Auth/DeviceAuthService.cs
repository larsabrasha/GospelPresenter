using System.Text.Json;
using Microsoft.Extensions.Logging;

namespace GospelPresenter.Client.Auth;

/// <summary>
/// Holds the device's credential and cached identity. The token comes from the server's
/// /app-login flow and lives in secure storage; the identity is cached as JSON in the app data
/// directory so the user stays signed in offline indefinitely. There is no expiry on the client:
/// the token works until the server revokes it, and revocation surfaces as a 401 on the next
/// online call — never as a lockout while offline.
/// </summary>
public class DeviceAuthService(
    ISecureTokenStore tokenStore,
    string identityFilePath,
    ILogger<DeviceAuthService> logger)
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public DeviceIdentity? CurrentIdentity { get; private set; }
    public string? Token { get; private set; }
    public bool IsSignedIn => CurrentIdentity is not null && Token is not null;

    /// <summary>Raised when the user signs in or out, so the auth state provider can notify Blazor.</summary>
    public event Action? Changed;

    /// <summary>Restores the persisted session at startup. Safe to call when nothing is stored.</summary>
    public async Task LoadAsync()
    {
        try
        {
            Token = await tokenStore.GetTokenAsync();
            if (Token is not null && File.Exists(identityFilePath))
            {
                await using var stream = File.OpenRead(identityFilePath);
                CurrentIdentity = await JsonSerializer.DeserializeAsync<DeviceIdentity>(stream, JsonOptions);
            }
        }
        catch (Exception ex)
        {
            // A corrupt identity file must not brick the app — it just means signing in again.
            logger.LogError(ex, "Failed to restore the stored sign-in; the user will need to sign in again");
            Token = null;
            CurrentIdentity = null;
        }

        Changed?.Invoke();
    }

    public async Task SignInAsync(string token, DeviceIdentity identity)
    {
        await tokenStore.SetTokenAsync(token);
        await File.WriteAllTextAsync(identityFilePath, JsonSerializer.Serialize(identity, JsonOptions));
        Token = token;
        CurrentIdentity = identity;
        Changed?.Invoke();
    }

    /// <summary>Refreshes the cached identity (name, role, organisation) without touching the token.</summary>
    public async Task UpdateIdentityAsync(DeviceIdentity identity)
    {
        await File.WriteAllTextAsync(identityFilePath, JsonSerializer.Serialize(identity, JsonOptions));
        CurrentIdentity = identity;
        Changed?.Invoke();
    }

    public async Task SignOutAsync()
    {
        await tokenStore.RemoveTokenAsync();
        if (File.Exists(identityFilePath))
            File.Delete(identityFilePath);
        Token = null;
        CurrentIdentity = null;
        Changed?.Invoke();
    }
}
