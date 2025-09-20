using GospelPresenter.Shared.State;

namespace GospelPresenter.Shared.Services.Auth;

public class AuthService(AppState appState) : IAuthService
{
    protected readonly AppState AppState = appState;

    public Task CancelLoginAsync()
    {
        return Task.CompletedTask;
    }

    public virtual void Logout()
    {
        AppState.Reset();
    }

    public async Task LoginAsDemoUserAsync()
    {
        var token = "demo";
        await SaveAccessTokenToSecureStorageAsync(token);
        
        AppState.LoggedInUser = new LoggedInUser(token, "demo");
        AppState.AuthProgress = ProgressEnum.Success;
        AppState.AuthMessage = null;
    }

    public virtual Task<string?> GetAccessTokenFromSecureStorageAsync()
    {
        return Task.FromResult<string?>(null);
    }

    public virtual Task SaveAccessTokenToSecureStorageAsync(string accessToken)
    {
        return Task.CompletedTask;
    }

    public void SetLoggedInUserFromAccessToken(string? accessToken)
    {
        if (accessToken is null) return;
        
        AppState.LoggedInUser = new LoggedInUser(accessToken, accessToken);
        AppState.AuthProgress = ProgressEnum.Success;
        AppState.AuthMessage = null;
    }
}
