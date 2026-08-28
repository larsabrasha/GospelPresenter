using System.Net.Http.Json;
using GospelPresenter.Client.Auth;
using GospelPresenter.Configuration;
using GospelPresenter.Shared.Models;
using GospelPresenter.Shared.Services;
using Microsoft.Extensions.Logging;

namespace GospelPresenter.Services;

/// <summary>
/// The interactive device sign-in: opens the server's /app-login in the system browser (never an
/// embedded webview — Google refuses OAuth in those), receives the device token in the fragment
/// of the gospelpresenter:// callback, fetches /api/me with it, and hands both to
/// <see cref="DeviceAuthService"/> for offline-persistent storage.
/// </summary>
public class DeviceSignInService(
    DeviceAuthService auth,
    IHttpClientFactory httpClientFactory,
    ILogger<DeviceSignInService> logger) : IDeviceSignIn
{
    public async Task<bool> SignInAsync(CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrEmpty(Settings.ApiBaseUrl))
        {
            logger.LogWarning("Sign-in attempted but no server URL is configured for this build scheme");
            return false;
        }

        WebAuthenticatorResult result;
        try
        {
            var deviceName = DeviceInfo.Current.Name;
            result = await WebAuthenticator.Default.AuthenticateAsync(new WebAuthenticatorOptions
            {
                Url = new Uri($"{Settings.ApiBaseUrl}/app-login?device={Uri.EscapeDataString(deviceName)}"),
                CallbackUrl = new Uri("gospelpresenter://auth"),
            });
        }
        catch (TaskCanceledException)
        {
            // The user closed the browser sheet.
            return false;
        }

        if (!result.Properties.TryGetValue("token", out var token) || string.IsNullOrEmpty(token))
        {
            logger.LogError("The sign-in callback carried no token");
            return false;
        }

        try
        {
            using var http = httpClientFactory.CreateClient();
            http.BaseAddress = new Uri(Settings.ApiBaseUrl);
            http.DefaultRequestHeaders.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);
            var me = await http.GetFromJsonAsync<MeResponse>("/api/me", cancellationToken);
            if (me?.OrganizationId is null)
            {
                logger.LogError("Could not load the signed-in user's profile");
                return false;
            }

            await auth.SignInAsync(token, new DeviceIdentity(
                me.Id, me.Name, me.Email,
                Enum.TryParse<UserRole>(me.Role, out var role) ? role : UserRole.User,
                me.OrganizationId, me.OrganizationName ?? ""));

            logger.LogInformation("Signed in as {UserId} in organization {OrganizationId}", me.Id, me.OrganizationId);
            return true;
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Sign-in failed after receiving a token");
            return false;
        }
    }

    public Task SignOutAsync() => auth.SignOutAsync();

    private sealed record MeResponse(
        string Id, string Name, string Email, string Role,
        string? OrganizationId, string? OrganizationName);
}
