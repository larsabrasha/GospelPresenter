using System.Security.Claims;
using GospelPresenter.Client.Auth;
using GospelPresenter.Shared.Models;
using Microsoft.Extensions.Logging.Abstractions;
using Shouldly;

namespace GospelPresenter.UnitTests.Client;

/// <summary>
/// The device's offline session: the token in secure storage and the identity beside it must
/// survive restarts indefinitely, and a corrupt store must degrade to "sign in again" rather
/// than a crash on launch.
/// </summary>
public class DeviceAuthTests : IDisposable
{
    private static readonly DeviceIdentity Identity =
        new("user-1", "Anna", "anna@example.com", UserRole.Admin, "org-1", "Församlingen");

    private readonly string identityPath;
    private readonly FakeSecureTokenStore tokenStore = new();

    public DeviceAuthTests()
    {
        identityPath = Path.Combine(Path.GetTempPath(), $"gp-test-identity-{Guid.NewGuid()}.json");
    }

    public void Dispose()
    {
        if (File.Exists(identityPath))
            File.Delete(identityPath);
    }

    [Fact]
    public async Task Load_WithNothingStored_IsSignedOut()
    {
        var auth = CreateService();

        await auth.LoadAsync();

        auth.IsSignedIn.ShouldBeFalse();
        auth.CurrentIdentity.ShouldBeNull();
    }

    [Fact]
    public async Task SignIn_Persists_AndANewInstanceRestoresIt()
    {
        // Arrange
        var first = CreateService();
        await first.SignInAsync("gpdt_secret", Identity);

        // Act -- a fresh instance, as after an app restart
        var second = CreateService();
        await second.LoadAsync();

        // Assert
        second.IsSignedIn.ShouldBeTrue();
        second.Token.ShouldBe("gpdt_secret");
        second.CurrentIdentity.ShouldBe(Identity);
    }

    [Fact]
    public async Task SignOut_ClearsTokenAndIdentity()
    {
        // Arrange
        var auth = CreateService();
        await auth.SignInAsync("gpdt_secret", Identity);

        // Act
        await auth.SignOutAsync();

        // Assert
        auth.IsSignedIn.ShouldBeFalse();
        (await tokenStore.GetTokenAsync()).ShouldBeNull();
        File.Exists(identityPath).ShouldBeFalse();

        var restarted = CreateService();
        await restarted.LoadAsync();
        restarted.IsSignedIn.ShouldBeFalse();
    }

    [Fact]
    public async Task Load_WithACorruptIdentityFile_DegradesToSignedOut()
    {
        // Arrange
        await tokenStore.SetTokenAsync("gpdt_secret");
        await File.WriteAllTextAsync(identityPath, "not json at all {");

        // Act
        var auth = CreateService();
        await auth.LoadAsync();

        // Assert -- no exception escapes; the user just signs in again
        auth.IsSignedIn.ShouldBeFalse();
    }

    [Fact]
    public async Task TheAuthStateProvider_MirrorsTheServersClaims()
    {
        // Arrange
        var auth = CreateService();
        var provider = new DeviceAuthStateProvider(auth);
        var notified = false;
        provider.AuthenticationStateChanged += _ => notified = true;

        // Act
        (await provider.GetAuthenticationStateAsync()).User.Identity!.IsAuthenticated.ShouldBeFalse();
        await auth.SignInAsync("gpdt_secret", Identity);

        // Assert
        notified.ShouldBeTrue("Blazor must re-render when the sign-in state changes");
        var user = (await provider.GetAuthenticationStateAsync()).User;
        user.Identity!.IsAuthenticated.ShouldBeTrue();
        user.FindFirst("user_id")!.Value.ShouldBe("user-1");
        user.FindFirst("organization_id")!.Value.ShouldBe("org-1");
        user.FindFirst(ClaimTypes.Role)!.Value.ShouldBe(nameof(UserRole.Admin));
    }


    /// <summary>
    /// The ordering is the fix, not the writing. Changed is what makes Blazor re-render as signed
    /// in, and the avatar menu it draws then reads the user's name straight out of the local
    /// database — so the row has to be there first. Written the other way round, the menu wins the
    /// race, finds no user and shows a blank name over a silhouette, which is exactly what being
    /// signed out looks like.
    /// </summary>
    [Fact]
    public async Task SignIn_WritesTheIdentityRow_BeforeItTellsBlazor()
    {
        var store = new RecordingIdentityStore();
        var auth = CreateService(store);
        var storedWhenNotified = false;
        auth.Changed += () => storedWhenNotified = store.Saved.Count == 1;

        await auth.SignInAsync("gpdt_test", Identity);

        store.Saved.ShouldBe([Identity]);
        storedWhenNotified.ShouldBeTrue(
            "the identity row must exist before anything re-renders on the strength of it");
    }

    /// <summary>
    /// A refreshed identity is the case that happens on every start: /api/me is called in the
    /// background, well after the menu has been drawn.
    /// </summary>
    [Fact]
    public async Task UpdateIdentity_WritesTheIdentityRowToo()
    {
        var store = new RecordingIdentityStore();
        var auth = CreateService(store);
        var renamed = Identity with { Name = "Anna Ny" };

        await auth.UpdateIdentityAsync(renamed);

        store.Saved.ShouldBe([renamed]);
    }

    /// <summary>
    /// The seam is optional, and a host without a local database has to keep working without it.
    /// </summary>
    [Fact]
    public async Task SignIn_WithNoIdentityStore_StillSignsIn()
    {
        var auth = CreateService();

        await auth.SignInAsync("gpdt_test", Identity);

        auth.IsSignedIn.ShouldBeTrue();
    }

    private DeviceAuthService CreateService(IDeviceIdentityStore? identityStore = null) =>
        new(tokenStore, identityPath, NullLogger<DeviceAuthService>.Instance, identityStore);

    private sealed class RecordingIdentityStore : IDeviceIdentityStore
    {
        public List<DeviceIdentity> Saved { get; } = [];

        public Task SaveAsync(DeviceIdentity identity, CancellationToken ct = default)
        {
            Saved.Add(identity);
            return Task.CompletedTask;
        }
    }

    private class FakeSecureTokenStore : ISecureTokenStore
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
}
