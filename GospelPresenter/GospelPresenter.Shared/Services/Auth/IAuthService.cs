using Microsoft.JSInterop;

namespace GospelPresenter.Shared.Services.Auth;

public interface IAuthService
{
    public Task CancelLoginAsync();
    public void Logout();
    public Task LoginAsDemoUserAsync();
    public Task<string?> GetAccessTokenFromSecureStorageAsync();
    public Task SaveAccessTokenToSecureStorageAsync(string accessToken);
    public void SetLoggedInUserFromAccessToken(string? accessToken);
}
