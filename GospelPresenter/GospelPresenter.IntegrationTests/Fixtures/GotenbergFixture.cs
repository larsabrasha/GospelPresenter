using DotNet.Testcontainers.Builders;
using DotNet.Testcontainers.Containers;

namespace GospelPresenter.IntegrationTests.Fixtures;

// Spins up a real Gotenberg container once per test collection. Tests share the same
// container — the converter is stateless so this is safe.
public class GotenbergFixture : IAsyncLifetime
{
    private const int GotenbergPort = 3000;
    private IContainer container = null!;

    public Uri BaseAddress { get; private set; } = null!;

    public async Task InitializeAsync()
    {
        container = new ContainerBuilder()
            .WithImage("gotenberg/gotenberg:8")
            .WithCommand("gotenberg", "--api-timeout=120s", "--libreoffice-restart-after=10")
            .WithPortBinding(GotenbergPort, assignRandomHostPort: true)
            .WithWaitStrategy(Wait.ForUnixContainer().UntilHttpRequestIsSucceeded(req =>
                req.ForPort(GotenbergPort).ForPath("/health")))
            .Build();

        await container.StartAsync();

        var hostPort = container.GetMappedPublicPort(GotenbergPort);
        BaseAddress = new Uri($"http://{container.Hostname}:{hostPort}");
    }

    public Task DisposeAsync() => container.DisposeAsync().AsTask();
}

[CollectionDefinition(Name)]
public class GotenbergCollection : ICollectionFixture<GotenbergFixture>
{
    public const string Name = "Gotenberg";
}
