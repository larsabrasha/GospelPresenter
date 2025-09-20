using GospelPresenter.Shared.State;

namespace GospelPresenter.Web.Services.Auth;

public class AuthService(AppState appState) : Shared.Services.Auth.AuthService(appState)
{
    private static readonly string AuthTokenFilePath = Path.Combine(AppContext.BaseDirectory, "authToken.txt");

    public override void Logout()
    {
        base.Logout();
        
        File.Delete(AuthTokenFilePath);
    }

    public override async Task<string?> GetAccessTokenFromSecureStorageAsync()
    {
        if (File.Exists(AuthTokenFilePath))
        {
            return await File.ReadAllTextAsync(AuthTokenFilePath);
        }

        return null;
    }

    public override async Task SaveAccessTokenToSecureStorageAsync(string accessToken)
    {
        await File.WriteAllTextAsync(AuthTokenFilePath, accessToken);
    }
}
