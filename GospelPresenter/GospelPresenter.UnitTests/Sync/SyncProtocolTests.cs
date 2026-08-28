using GospelPresenter.Shared.Sync;
using Shouldly;

namespace GospelPresenter.UnitTests.Sync;

/// <summary>
/// Pins how a client's claimed protocol version is read, because the three cases mean three
/// different things and only one of them is a number someone sent on purpose.
/// See adr/0002-app-distribution-and-updates.md (25).
/// </summary>
public class SyncProtocolTests
{
    [Fact]
    public void Parse_WithNoHeader_ReadsAsCurrent()
    {
        // A caller predating the header never agreed to the contract, so it is not held to it.
        SyncProtocol.Parse(null).ShouldBe(SyncProtocol.Current);
    }

    [Theory]
    [InlineData("1", 1)]
    [InlineData("2", 2)]
    [InlineData("17", 17)]
    public void Parse_WithANumber_ReadsThatNumber(string header, int expected)
    {
        SyncProtocol.Parse(header).ShouldBe(expected);
    }

    [Theory]
    [InlineData("")]
    [InlineData("not-a-number")]
    [InlineData("1.0")]
    [InlineData("v2")]
    public void Parse_WithGarbage_ReadsAsZeroSoTheFloorCatchesIt(string header)
    {
        // Present but unparseable is a client bug, and must not be mistaken for "no header".
        SyncProtocol.Parse(header).ShouldBe(0);
        SyncProtocol.Parse(header).ShouldBeLessThan(SyncProtocol.Minimum);
    }

    [Fact]
    public void Minimum_IsNotAboveCurrent()
    {
        // A floor above what this build speaks would lock the app out of its own server.
        SyncProtocol.Minimum.ShouldBeLessThanOrEqualTo(SyncProtocol.Current);
    }
}
