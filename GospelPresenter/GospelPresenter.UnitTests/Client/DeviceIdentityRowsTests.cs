using GospelPresenter.Client.Auth;
using GospelPresenter.Client.Data;
using GospelPresenter.Shared.Models;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Shouldly;

namespace GospelPresenter.UnitTests.Client;

/// <summary>
/// The two rows the device's own identity produces, against a real SQLite database.
///
/// Users and Organizations sit outside the sync protocol, so nothing else creates them: before
/// this, they arrived only with the first pull that landed, and until then the signed-in user had
/// no name anywhere the UI could read it.
/// </summary>
public class DeviceIdentityRowsTests : IAsyncLifetime, IDisposable
{
    private static readonly DeviceIdentity Identity =
        new("user-1", "Anna", "anna@example.com", UserRole.Admin, "org-1", "Församlingen");

    private readonly SqliteConnection connection;
    private readonly IDbContextFactory<ClientDataContext> factory;

    public DeviceIdentityRowsTests()
    {
        connection = new SqliteConnection("DataSource=:memory:");
        connection.Open();
        factory = new TestDbContextFactory(new DbContextOptionsBuilder<ClientDataContext>()
            .UseSqlite(connection)
            .Options);
    }

    public async Task InitializeAsync() =>
        await new ClientDatabaseInitializer(factory, NullLogger<ClientDatabaseInitializer>.Instance)
            .InitializeAsync();

    public Task DisposeAsync() => Task.CompletedTask;

    public void Dispose() => connection.Dispose();

    [Fact]
    public async Task AnIdentity_CreatesTheUserAndOrganizationRows()
    {
        await using var db = await factory.CreateDbContextAsync();

        var changed = await DeviceIdentityRows.UpsertAsync(db, Identity);

        changed.ShouldBeTrue();
        var user = await db.Users.SingleAsync();
        user.Id.ShouldBe("user-1");
        user.Name.ShouldBe("Anna");
        user.Email.ShouldBe("anna@example.com");
        user.Role.ShouldBe(UserRole.Admin);
        user.OrganizationId.ShouldBe("org-1");
        (await db.Organizations.SingleAsync()).Name.ShouldBe("Församlingen");
    }

    [Fact]
    public async Task ARenamedUser_IsUpdatedRatherThanDuplicated()
    {
        await using var db = await factory.CreateDbContextAsync();
        await DeviceIdentityRows.UpsertAsync(db, Identity);

        var changed = await DeviceIdentityRows.UpsertAsync(
            db, Identity with { Name = "Anna Ny", OrganizationName = "Nya församlingen" });

        changed.ShouldBeTrue();
        (await db.Users.SingleAsync()).Name.ShouldBe("Anna Ny");
        (await db.Organizations.SingleAsync()).Name.ShouldBe("Nya församlingen");
    }

    /// <summary>
    /// What the "did anything change" answer is for: it is what decides whether the UI is told,
    /// and the identity is re-stored on every single start.
    /// </summary>
    [Fact]
    public async Task AnUnchangedIdentity_ReportsNoChange()
    {
        await using var db = await factory.CreateDbContextAsync();
        await DeviceIdentityRows.UpsertAsync(db, Identity);

        (await DeviceIdentityRows.UpsertAsync(db, Identity)).ShouldBeFalse();
    }

    /// <summary>
    /// The whole point, stated as the symptom: signing in has to leave a readable name behind
    /// without any pull having happened.
    /// </summary>
    [Fact]
    public async Task SigningIn_LeavesAReadableUser_WithoutAnySync()
    {
        var identityPath = Path.Combine(Path.GetTempPath(), $"gp-identity-rows-{Guid.NewGuid()}.json");
        try
        {
            var auth = new DeviceAuthService(
                new FakeTokenStore(),
                identityPath,
                NullLogger<DeviceAuthService>.Instance,
                new LocalDeviceIdentityStore(factory, NullLogger<LocalDeviceIdentityStore>.Instance));

            await auth.SignInAsync("gpdt_test", Identity);

            await using var db = await factory.CreateDbContextAsync();
            (await db.Users.SingleAsync()).Name.ShouldBe("Anna");
        }
        finally
        {
            if (File.Exists(identityPath))
                File.Delete(identityPath);
        }
    }

    private sealed class TestDbContextFactory(DbContextOptions<ClientDataContext> options)
        : IDbContextFactory<ClientDataContext>
    {
        public ClientDataContext CreateDbContext() => new(options);
    }

    private sealed class FakeTokenStore : ISecureTokenStore
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
