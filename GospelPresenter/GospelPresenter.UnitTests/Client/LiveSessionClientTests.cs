using GospelPresenter.Client.Auth;
using GospelPresenter.Client.Live;
using GospelPresenter.Shared.Live;
using GospelPresenter.Shared.State;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Shouldly;

namespace GospelPresenter.UnitTests.Client;

public class LiveSessionClientTests
{
    [Fact]
    public async Task DisposingTwice_DoesNotThrow()
    {
        // The desktop host registers this under its own type and again as ILiveSessionMirror through
        // a factory that returns the same object. The container tracks what a factory returns for
        // disposal without checking whether it already is, so shutdown disposes it twice -- and the
        // second call reached a cancellation source the first had disposed. Closing the app ended in
        // an unhandled ObjectDisposedException and exit code 134 rather than a clean stop.
        var client = Build();

        await client.DisposeAsync();

        await Should.NotThrowAsync(async () => await client.DisposeAsync());
    }

    [Fact]
    public async Task TheHostsOwnRegistrations_DisposeTheClientCleanly()
    {
        // The registration shape itself, so that keeping the alias does not quietly reintroduce it.
        var services = new ServiceCollection();
        services.AddSingleton(_ => Build());
        services.AddSingleton<ILiveSessionMirror>(sp => sp.GetRequiredService<LiveSessionClient>());

        var provider = services.BuildServiceProvider();
        provider.GetRequiredService<ILiveSessionMirror>();

        await Should.NotThrowAsync(async () => await provider.DisposeAsync());
    }

    private static LiveSessionClient Build() =>
        new(new SharedAppState(TimeSpan.FromHours(4)),
            new RemoteDisplayState(),
            new DeviceAuthService(
                new NoTokenStore(),
                Path.Combine(Path.GetTempPath(), $"identity-{Guid.NewGuid():N}.json"),
                NullLogger<DeviceAuthService>.Instance),
            "https://example.invalid",
            prepare: null,
            new UnusedCommandApplier(),
            NullLogger<LiveSessionClient>.Instance);

    /// <summary>Nothing here ever connects, so no command can arrive.</summary>
    private sealed class UnusedCommandApplier : ILiveSessionCommandApplier
    {
        public Task ApplyAsync(string sessionId, MirroredSessionCommand command) =>
            throw new NotSupportedException();
    }

    private sealed class NoTokenStore : ISecureTokenStore
    {
        public Task<string?> GetTokenAsync() => Task.FromResult<string?>(null);
        public Task SetTokenAsync(string value) => throw new NotSupportedException();
        public Task RemoveTokenAsync() => throw new NotSupportedException();
    }
}
