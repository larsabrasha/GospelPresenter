using GospelPresenter.Client.Auth;
using GospelPresenter.Shared.Contexts;
using GospelPresenter.Shared.Models;
using Microsoft.EntityFrameworkCore;

namespace GospelPresenter.Desktop.Services;

/// <summary>
/// The fallback for an installation with no server configured: a fixed developer identity, and the
/// organisation and user rows it needs to be more than a set of claims. Without the organisation
/// row the dashboard has nothing to show, and without the auth service holding an identity the
/// media endpoints cannot resolve an object key.
///
/// It signs <see cref="DeviceAuthService"/> in with a made-up token rather than standing beside it,
/// so there is one notion of who is signed in whether or not a server exists — the same auth state
/// provider and the same HTTP scheme serve both, and nothing downstream has a development branch.
///
/// This is the desktop twin of the MAUI host's DEBUG dev-identity path, and like it, it is reached
/// only when the server URL is empty.
/// </summary>
public static class DevIdentity
{
    public const string UserId = "dev-user";
    public const string OrganizationId = "dev-org";
    private const string OrganizationName = "Utvecklingsmiljö";

    public static async Task SeedAsync(IServiceProvider services)
    {
        var factory = services.GetRequiredService<IDbContextFactory<PresentationContext>>();
        await using var context = await factory.CreateDbContextAsync();

        if (!await context.Organizations.AnyAsync(o => o.Id == OrganizationId))
        {
            context.Organizations.Add(new Organization
            {
                Id = OrganizationId,
                Name = OrganizationName,
            });
        }

        if (!await context.Users.AnyAsync(u => u.Id == UserId))
        {
            context.Users.Add(new User
            {
                Id = UserId,
                Name = "Utvecklare",
                Email = "dev@example.com",
                Role = UserRole.Admin,
                OrganizationId = OrganizationId,
            });
        }

        await context.SaveChangesAsync();

        // The token is never sent anywhere: this path exists precisely because there is no server.
        await services.GetRequiredService<DeviceAuthService>().SignInAsync("dev-token", new DeviceIdentity(
            UserId, "Utvecklare", "dev@example.com", UserRole.Admin, OrganizationId, OrganizationName));
    }
}

/// <summary>
/// The token store for an installation with no server: holds the made-up token for the process
/// lifetime and writes nothing.
///
/// That is not tidiness. DeviceAuthService restores a cached identity only when a token comes back
/// with it, so keeping the developer token out of the real store is what stops the fixed identity
/// from surviving into a run that does have a server configured — where it would be restored as a
/// signed-in user and the sync engine would spend its retries being told the token is invalid.
/// Leaving nothing behind makes that impossible rather than merely unlikely, and it keeps a
/// pretend credential out of the user's keychain.
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
