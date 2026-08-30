using GospelPresenter.Shared.Services;
using Shouldly;

namespace GospelPresenter.UnitTests.Services;

/// <summary>
/// The client and the server derive this independently and must land on the same string, so the
/// derivation is pinned rather than left to whatever the hash happens to produce today.
/// </summary>
public class DeviceSessionIdTests
{
    [Fact]
    public void For_ForTheSameDevice_IsStable()
    {
        DeviceSessionId.For("token-1").ShouldBe(DeviceSessionId.For("token-1"));
    }

    [Fact]
    public void For_ForDifferentDevices_Differs()
    {
        DeviceSessionId.For("token-1").ShouldNotBe(DeviceSessionId.For("token-2"));
    }

    [Fact]
    public void For_DoesNotLeakTheDeviceTokenId()
    {
        // The id is served anonymously in the live image URLs.
        DeviceSessionId.For("device-token-primary-key")
            .ShouldNotContain("device-token", Case.Insensitive);
    }

    [Fact]
    public void For_IsTwelveLowercaseHexCharacters()
    {
        var id = DeviceSessionId.For("2f8c4b1e-0000-4a9d-b3f1-1c2d3e4f5a6b");

        id.Length.ShouldBe(12);
        id.ShouldAllBe(c => (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'));
    }

    [Fact]
    public void For_MatchesTheValueBothSidesWereBuiltAgainst()
    {
        // Changing this changes every running installation's session id at once, and with it the
        // live image URLs and public output bindings already in flight. Do not update it to match
        // a new implementation — the old value is the contract.
        DeviceSessionId.For("token-1").ShouldBe("4222e23e909e");
    }
}
