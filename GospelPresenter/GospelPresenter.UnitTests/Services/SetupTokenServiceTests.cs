using GospelPresenter.Shared.Services;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Shouldly;

namespace GospelPresenter.UnitTests.Services;

public class SetupTokenServiceTests
{
    private const string ConfiguredToken = "correct-horse-battery-staple";

    [Fact]
    public void Verify_WithTheConfiguredToken_ReturnsTrue()
    {
        // Arrange
        var service = new SetupTokenService(ConfiguredToken, new ListLogger());

        // Act & Assert -- surrounding whitespace from a paste is forgiven
        service.Verify(ConfiguredToken).ShouldBeTrue();
        service.Verify($"  {ConfiguredToken}\n").ShouldBeTrue();
        service.IsGenerated.ShouldBeFalse();
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("correct-horse-battery")]
    [InlineData("correct-horse-battery-staple-and-more")]
    [InlineData("CORRECT-HORSE-BATTERY-STAPLE")]
    public void Verify_WithAnyOtherValue_ReturnsFalse(string? candidate)
    {
        // Arrange
        var service = new SetupTokenService(ConfiguredToken, new ListLogger());

        // Act & Assert
        service.Verify(candidate).ShouldBeFalse();
    }

    [Fact]
    public void Verify_WithAWrongToken_LogsAWarningWithoutTheCandidate()
    {
        // Arrange
        var logger = new ListLogger();
        var service = new SetupTokenService(ConfiguredToken, logger);
        const string wrong = "guess-number-one";

        // Act
        service.Verify(wrong);

        // Assert
        var entry = logger.Entries.ShouldHaveSingleItem();
        entry.Level.ShouldBe(LogLevel.Warning);
        entry.Message.ShouldNotContain(wrong);
        entry.Message.ShouldNotContain(ConfiguredToken);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("  ")]
    public void Constructor_WithoutAConfiguredToken_GeneratesARandomToken(string? configured)
    {
        // Arrange
        var firstLogger = new ListLogger();
        var first = new SetupTokenService(configured, firstLogger);
        var second = new SetupTokenService(configured, new ListLogger());

        // Act
        first.AnnounceSetupPending();
        var generated = TokenFromMessage(firstLogger.Entries.Single().Message);

        // Assert -- an unconfigured installation must still not accept an empty or guessable token
        first.IsGenerated.ShouldBeTrue();
        generated.Length.ShouldBe(64);
        first.Verify("").ShouldBeFalse();
        first.Verify(generated).ShouldBeTrue();
        second.Verify(generated).ShouldBeFalse();
    }

    [Fact]
    public void AnnounceSetupPending_WithAGeneratedToken_LogsItOnceAtWarning()
    {
        // Arrange
        var logger = new ListLogger();
        var service = new SetupTokenService(null, logger);

        // Act
        service.AnnounceSetupPending();
        service.AnnounceSetupPending();

        // Assert
        var entry = logger.Entries.ShouldHaveSingleItem();
        entry.Level.ShouldBe(LogLevel.Warning);
        service.Verify(TokenFromMessage(entry.Message)).ShouldBeTrue();
    }

    [Fact]
    public void AnnounceSetupPending_WithAConfiguredToken_NeverLogsTheToken()
    {
        // Arrange
        var logger = new ListLogger();
        var service = new SetupTokenService(ConfiguredToken, logger);

        // Act
        service.AnnounceSetupPending();

        // Assert
        var entry = logger.Entries.ShouldHaveSingleItem();
        entry.Level.ShouldBe(LogLevel.Information);
        entry.Message.ShouldNotContain(ConfiguredToken);
    }

    [Theory]
    [InlineData("from-key", "from-env", "from-key")]
    [InlineData(null, "from-env", "from-env")]
    [InlineData("", "from-env", "from-env")]
    [InlineData(null, null, null)]
    public void ReadConfiguredToken_PrefersSetupTokenOverTheEnvironmentVariable(
        string? setupToken, string? environmentVariable, string? expected)
    {
        // Arrange
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                [SetupTokenService.ConfigurationKey] = setupToken,
                [SetupTokenService.EnvironmentVariable] = environmentVariable,
            })
            .Build();

        // Act & Assert
        SetupTokenService.ReadConfiguredToken(configuration).ShouldBe(expected);
    }

    private static string TokenFromMessage(string message) => message[(message.LastIndexOf(' ') + 1)..];

    private sealed class ListLogger : ILogger<SetupTokenService>
    {
        public List<(LogLevel Level, string Message)> Entries { get; } = [];

        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
        public bool IsEnabled(LogLevel logLevel) => true;

        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception,
            Func<TState, Exception?, string> formatter)
            => Entries.Add((logLevel, formatter(state, exception)));
    }
}
