using GospelPresenter.Shared;
using GospelPresenter.Shared.Contexts;
using GospelPresenter.Shared.State;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Shouldly;

namespace GospelPresenter.UnitTests.State;

/// <summary>
/// The service registrations every host shares. Four of them call
/// <see cref="SharedServicesSetup.AddSharedGospelPresenterServices"/> — the web, the desktop app,
/// the MAUI app and the migration tool — and until now nothing checked the result.
///
/// The failure this guards against is a singleton that takes a scoped service as a dependency.
/// It compiles, it resolves in the host that happens to ask from a scope, and it throws in the one
/// that asks from the root — or worse, it captures one circuit's state and serves it to everybody.
/// The container can prove that on its own, so let it.
/// </summary>
public class SharedServicesSetupTests : IDisposable
{
    private readonly SqliteConnection connection;
    private readonly IDbContextFactory<PresentationContext> databases;

    public SharedServicesSetupTests()
    {
        // The one dependency the shared registrations expect a host to bring: five of them reach the
        // database, and each host wires its own — the web to Postgres, the device to a local file.
        connection = new SqliteConnection("DataSource=:memory:");
        connection.Open();
        databases = new TestDbContextFactory(
            new DbContextOptionsBuilder<PresentationContext>().UseSqlite(connection).Options);
    }

    public void Dispose() => connection.Dispose();

    [Fact]
    public void AddSharedGospelPresenterServices_BuildsAContainerThatValidates()
    {
        var services = Registrations();

        // ValidateOnBuild constructs every registration; ValidateScopes is the half that catches a
        // singleton holding on to something scoped.
        var build = () => services.BuildServiceProvider(new ServiceProviderOptions
        {
            ValidateOnBuild = true,
            ValidateScopes = true
        });

        build.ShouldNotThrow();
    }

    /// <summary>
    /// One editor state per circuit, which is the whole point of it: it holds what one operator has
    /// open. Registered as a singleton it would hand every circuit the same selected song.
    /// </summary>
    [Fact]
    public void PresentationEditorState_IsOnePerScope()
    {
        using var provider = BuildProvider();
        using var first = provider.CreateScope();
        using var second = provider.CreateScope();

        first.ServiceProvider.GetRequiredService<PresentationEditorState>()
            .ShouldNotBeSameAs(second.ServiceProvider.GetRequiredService<PresentationEditorState>());
    }

    [Fact]
    public void PresentationEditorState_IsTheSameWithinAScope()
    {
        using var provider = BuildProvider();
        using var scope = provider.CreateScope();

        scope.ServiceProvider.GetRequiredService<PresentationEditorState>()
            .ShouldBeSameAs(scope.ServiceProvider.GetRequiredService<PresentationEditorState>());
    }

    /// <summary>
    /// The other half of the live-panel fix. The presentation page renders two live panels and lets
    /// CSS pick which one the operator sees; the outputs they show — the windows this host opened
    /// and the projector output — are only one answer if both panels resolve the same object.
    /// Registered per panel, each restored the saved configuration on the way in and the operator
    /// got two of everything. See LiveOutputsStateTests.
    /// </summary>
    [Fact]
    public void LiveOutputsState_IsOnePerScope()
    {
        using var provider = BuildProvider();
        using var scope = provider.CreateScope();

        scope.ServiceProvider.GetRequiredService<LiveOutputsState>()
            .ShouldBeSameAs(scope.ServiceProvider.GetRequiredService<LiveOutputsState>());
    }

    /// <summary>And not shared between circuits: the windows belong to one browser.</summary>
    [Fact]
    public void LiveOutputsState_IsNotSharedBetweenScopes()
    {
        using var provider = BuildProvider();
        using var first = provider.CreateScope();
        using var second = provider.CreateScope();

        first.ServiceProvider.GetRequiredService<LiveOutputsState>()
            .ShouldNotBeSameAs(second.ServiceProvider.GetRequiredService<LiveOutputsState>());
    }

    /// <summary>
    /// The live state is the opposite case, and the pair is worth stating together: it is one object
    /// for the whole process, because a phone and the machine it drives are two circuits looking at
    /// the same session.
    /// </summary>
    [Fact]
    public void SharedAppState_IsOneForTheWholeProcess()
    {
        using var provider = BuildProvider();
        using var first = provider.CreateScope();
        using var second = provider.CreateScope();

        first.ServiceProvider.GetRequiredService<SharedAppState>()
            .ShouldBeSameAs(second.ServiceProvider.GetRequiredService<SharedAppState>());
    }

    private ServiceCollection Registrations()
    {
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddSingleton(databases);
        services.AddSharedGospelPresenterServices();
        return services;
    }

    private ServiceProvider BuildProvider() =>
        Registrations().BuildServiceProvider(new ServiceProviderOptions { ValidateScopes = true });

    private class TestDbContextFactory(DbContextOptions<PresentationContext> options)
        : IDbContextFactory<PresentationContext>
    {
        public PresentationContext CreateDbContext() => new(options);
    }
}
