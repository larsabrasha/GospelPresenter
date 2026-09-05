using GospelPresenter.Shared.Services;
using Shouldly;

namespace GospelPresenter.UnitTests.Services;

public class AppVersionTests
{
    private static readonly Version AssemblyVersion = new(1, 0, 0, 0);

    [Fact]
    public void Format_WithPlainSemanticVersion_ReturnsItUnchanged()
    {
        // Arrange
        const string informational = "1.4.2";

        // Act
        var result = AppVersion.Format(informational, AssemblyVersion);

        // Assert
        result.ShouldBe("1.4.2");
    }

    [Fact]
    public void Format_WithCommitShaSuffix_ShortensTheShaToSevenCharacters()
    {
        // Arrange
        const string informational = "1.4.2+a3f9c21b7e4d5f6081920304050607080910111a";

        // Act
        var result = AppVersion.Format(informational, AssemblyVersion);

        // Assert
        result.ShouldBe("1.4.2+a3f9c21");
    }

    [Fact]
    public void Format_WithShaShorterThanSevenCharacters_LeavesItAlone()
    {
        // Arrange -- not a git sha, but the suffix is free-form build metadata and truncating a
        // short one would only make it less identifying.
        const string informational = "1.4.2+ci";

        // Act
        var result = AppVersion.Format(informational, AssemblyVersion);

        // Assert
        result.ShouldBe("1.4.2+ci");
    }

    [Fact]
    public void Format_WithPreReleaseLabelAndSha_KeepsTheLabelAndShortensOnlyTheSha()
    {
        // Arrange
        const string informational = "1.4.2-rc.1+a3f9c21b7e4d5f6081920304050607080910111a";

        // Act
        var result = AppVersion.Format(informational, AssemblyVersion);

        // Assert
        result.ShouldBe("1.4.2-rc.1+a3f9c21");
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void Format_WithoutInformationalVersion_FallsBackToTheAssemblyVersion(string? informational)
    {
        // Act
        var result = AppVersion.Format(informational, AssemblyVersion);

        // Assert
        result.ShouldBe("1.0.0.0");
    }

    [Fact]
    public void Format_WithNoVersionMetadataAtAll_ReturnsNullSoTheCallerCanRenderNothing()
    {
        // Act
        var result = AppVersion.Format(null, null);

        // Assert
        result.ShouldBeNull();
    }
}
