using GospelPresenter.Client.Auth;
using GospelPresenter.Shared.Contexts;
using GospelPresenter.Shared.Models;
using Microsoft.EntityFrameworkCore;

namespace GospelPresenter.Desktop.Services;

/// <summary>
/// TEMPORARY, alongside <see cref="DevAuthenticationStateProvider"/>: the rows and the signed-in
/// <see cref="DeviceAuthService"/> that the fixed developer identity needs to be more than a set of
/// claims. Without the organisation row the dashboard has nothing to show, and without the auth
/// service holding an identity the media endpoints cannot resolve an object key.
///
/// All of this goes when the device-token sign-in is wired into this host.
/// </summary>
public static class DevIdentity
{
    private const string OrganizationName = "Utvecklingsmiljö";

    public static async Task SeedAsync(IServiceProvider services)
    {
        var factory = services.GetRequiredService<IDbContextFactory<PresentationContext>>();
        await using var context = await factory.CreateDbContextAsync();

        if (!await context.Organizations.AnyAsync(o => o.Id == DevAuthenticationStateProvider.OrganizationId))
        {
            context.Organizations.Add(new Organization
            {
                Id = DevAuthenticationStateProvider.OrganizationId,
                Name = OrganizationName,
            });
        }

        if (!await context.Users.AnyAsync(u => u.Id == DevAuthenticationStateProvider.UserId))
        {
            context.Users.Add(new User
            {
                Id = DevAuthenticationStateProvider.UserId,
                Name = "Utvecklare",
                Email = "dev@example.com",
                Role = UserRole.Admin,
                OrganizationId = DevAuthenticationStateProvider.OrganizationId,
            });
        }

        await context.SaveChangesAsync();

        // The identity the media endpoints read the organisation from. The token is never sent
        // anywhere — nothing in this host talks to a server yet.
        await services.GetRequiredService<DeviceAuthService>().SignInAsync("dev-token", new DeviceIdentity(
            DevAuthenticationStateProvider.UserId,
            "Utvecklare",
            "dev@example.com",
            UserRole.Admin,
            DevAuthenticationStateProvider.OrganizationId,
            OrganizationName));
    }
}

/// <summary>
/// TEMPORARY: holds the device token for the process lifetime only. The real desktop store belongs
/// in the platform's credential vault (Keychain, DPAPI, libsecret) and lands with the sign-in flow;
/// until then nothing is worth persisting, because the token above is made up.
/// </summary>
public class InMemoryTokenStore : ISecureTokenStore
{
    private string? token;

    public Task<string?> GetTokenAsync() => Task.FromResult(token);

    public Task SetTokenAsync(string value)
    {
        token = value;
        return Task.CompletedTask;
    }

    public Task RemoveTokenAsync()
    {
        token = null;
        return Task.CompletedTask;
    }
}
