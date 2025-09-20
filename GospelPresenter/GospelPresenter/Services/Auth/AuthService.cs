using GospelPresenter.Services.Cache;
using GospelPresenter.Shared.State;
using ZiggyCreatures.Caching.Fusion;

namespace GospelPresenter.Services.Auth;

public class AuthService(
    AppState appState,
    IFusionCache cache,
    ISqliteCacheProxy sqliteCacheProxy
) : Shared.Services.Auth.AuthService(appState)
{
    private const string AuthTokenKey = "authToken";
    
    public override void Logout()
    {
        base.Logout();

        if (IsUsingPreferencesForSecureStorage())
        {
            Preferences.Remove(AuthTokenKey);
        }
        else
        {
            SecureStorage.Default.RemoveAll();
        }

        cache.Clear(false);
        
        sqliteCacheProxy.DeleteAndRecreateSqliteCache();
    }

    public override async Task<string?> GetAccessTokenFromSecureStorageAsync()
    {
        if (IsUsingPreferencesForSecureStorage())
        {
            await Task.Delay(100);
            return Preferences.Get(AuthTokenKey, null);
        }
        
        return await SecureStorage.Default.GetAsync(AuthTokenKey);
    }

    public override async Task SaveAccessTokenToSecureStorageAsync(string accessToken)
    {
        if (IsUsingPreferencesForSecureStorage())
        {
            Preferences.Set(AuthTokenKey, accessToken);
            await Task.Delay(10);
        }
        else
        {
            await SecureStorage.Default.SetAsync(AuthTokenKey, accessToken);
        }
    }

    private static bool IsUsingPreferencesForSecureStorage() =>
        DeviceInfo.Platform == DevicePlatform.MacCatalyst ||
        (DeviceInfo.Platform == DevicePlatform.iOS && DeviceInfo.DeviceType == DeviceType.Virtual);
}
