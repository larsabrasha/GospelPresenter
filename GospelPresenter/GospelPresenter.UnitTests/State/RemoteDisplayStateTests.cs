using GospelPresenter.Shared.State;
using Shouldly;

namespace GospelPresenter.UnitTests.State;

public class RemoteDisplayStateTests
{
    private readonly RemoteDisplayState state = new();

    [Fact]
    public void GeneratePairingCode_Returns4DigitCode()
    {
        var code = state.GeneratePairingCode("display-1");

        code.Length.ShouldBe(4);
        int.TryParse(code, out var num).ShouldBeTrue();
        num.ShouldBeGreaterThanOrEqualTo(1000);
        num.ShouldBeLessThan(9999);
    }

    [Fact]
    public void GeneratePairingCode_ReturnsUniqueCodesForDifferentDisplays()
    {
        var code1 = state.GeneratePairingCode("display-1");
        var code2 = state.GeneratePairingCode("display-2");

        code1.ShouldNotBe(code2);
    }

    [Fact]
    public void GeneratePairingCode_ReplacesExistingCodeForSameDisplay()
    {
        var code1 = state.GeneratePairingCode("display-1");
        var code2 = state.GeneratePairingCode("display-1");

        code1.ShouldNotBe(code2);

        // Old code should no longer work
        state.PairDisplay(code1, "session-1").ShouldBeFalse();

        // New code should work
        state.PairDisplay(code2, "session-1").ShouldBeTrue();
    }

    [Fact]
    public void PairDisplay_WithValidCode_ReturnsTrue()
    {
        var code = state.GeneratePairingCode("display-1");

        var result = state.PairDisplay(code, "session-1");

        result.ShouldBeTrue();
    }

    [Fact]
    public void PairDisplay_WithInvalidCode_ReturnsFalse()
    {
        var result = state.PairDisplay("999999", "session-1");

        result.ShouldBeFalse();
    }

    [Fact]
    public void PairDisplay_SameCodeTwice_FailsSecondTime()
    {
        var code = state.GeneratePairingCode("display-1");

        state.PairDisplay(code, "session-1").ShouldBeTrue();
        state.PairDisplay(code, "session-2").ShouldBeFalse();
    }

    [Fact]
    public void GetSessionForDisplay_AfterPairing_ReturnsSessionId()
    {
        var code = state.GeneratePairingCode("display-1");
        state.PairDisplay(code, "session-1");

        var sessionId = state.GetSessionForDisplay("display-1");

        sessionId.ShouldBe("session-1");
    }

    [Fact]
    public void GetSessionForDisplay_BeforePairing_ReturnsNull()
    {
        state.GeneratePairingCode("display-1");

        var sessionId = state.GetSessionForDisplay("display-1");

        sessionId.ShouldBeNull();
    }

    [Fact]
    public void UnpairDisplay_CleansUpEverything()
    {
        var code = state.GeneratePairingCode("display-1");
        state.PairDisplay(code, "session-1");

        state.UnpairDisplay("display-1");

        state.GetSessionForDisplay("display-1").ShouldBeNull();
        state.GetConnectedDisplayCount("session-1").ShouldBe(0);
    }

    [Fact]
    public void GetConnectedDisplayCount_TracksMultipleDisplays()
    {
        var code1 = state.GeneratePairingCode("display-1");
        var code2 = state.GeneratePairingCode("display-2");

        state.PairDisplay(code1, "session-1");
        state.PairDisplay(code2, "session-1");

        state.GetConnectedDisplayCount("session-1").ShouldBe(2);
    }

    [Fact]
    public void GetConnectedDisplayCount_DoesNotCountOtherSessions()
    {
        var code1 = state.GeneratePairingCode("display-1");
        var code2 = state.GeneratePairingCode("display-2");

        state.PairDisplay(code1, "session-1");
        state.PairDisplay(code2, "session-2");

        state.GetConnectedDisplayCount("session-1").ShouldBe(1);
        state.GetConnectedDisplayCount("session-2").ShouldBe(1);
    }

    [Fact]
    public void DisconnectDisplay_RemovesFromSession()
    {
        var code = state.GeneratePairingCode("display-1");
        state.PairDisplay(code, "session-1");

        state.DisconnectDisplay("display-1");

        state.GetSessionForDisplay("display-1").ShouldBeNull();
        state.GetConnectedDisplayCount("session-1").ShouldBe(0);
    }

    [Fact]
    public void DisplayPaired_EventFires_WhenDisplayIsPaired()
    {
        string? pairedDisplayId = null;
        state.DisplayPaired += id => pairedDisplayId = id;

        var code = state.GeneratePairingCode("display-1");
        state.PairDisplay(code, "session-1");

        pairedDisplayId.ShouldBe("display-1");
    }

    [Fact]
    public void DisplayUnpaired_EventFires_WhenDisplayIsDisconnected()
    {
        string? unpairedDisplayId = null;
        state.DisplayUnpaired += id => unpairedDisplayId = id;

        var code = state.GeneratePairingCode("display-1");
        state.PairDisplay(code, "session-1");
        state.DisconnectDisplay("display-1");

        unpairedDisplayId.ShouldBe("display-1");
    }

    [Fact]
    public void DisplayUnpaired_EventFires_WhenUnpairDisplayCalled()
    {
        string? unpairedDisplayId = null;
        state.DisplayUnpaired += id => unpairedDisplayId = id;

        state.GeneratePairingCode("display-1");
        state.UnpairDisplay("display-1");

        unpairedDisplayId.ShouldBe("display-1");
    }

    [Fact]
    public void EnableDisplay_ConnectsDisplayToSession()
    {
        state.EnableDisplay("display-1", "session-1", "Main Hall");

        state.IsDisplayConnected("display-1").ShouldBeTrue();
        state.GetSessionForDisplay("display-1").ShouldBe("session-1");
        state.GetDisplayName("display-1").ShouldBe("Main Hall");
    }

    [Fact]
    public void EnableDisplay_FiresDisplayPairedEvent()
    {
        string? pairedId = null;
        state.DisplayPaired += id => pairedId = id;

        state.EnableDisplay("display-1", "session-1");

        pairedId.ShouldBe("display-1");
    }

    [Fact]
    public void DisableDisplay_DisconnectsDisplay()
    {
        state.EnableDisplay("display-1", "session-1");

        state.DisableDisplay("display-1", "session-1");

        state.IsDisplayConnected("display-1").ShouldBeFalse();
        state.GetSessionForDisplay("display-1").ShouldBeNull();
    }

    [Fact]
    public void DisableDisplay_FiresDisplayUnpairedEvent()
    {
        state.EnableDisplay("display-1", "session-1");

        string? unpairedId = null;
        state.DisplayUnpaired += id => unpairedId = id;

        state.DisableDisplay("display-1", "session-1");

        unpairedId.ShouldBe("display-1");
    }

    [Fact]
    public void DisableDisplay_FromNonOwningSession_DoesNothing()
    {
        state.EnableDisplay("display-1", "session-a");

        string? unpairedId = null;
        state.DisplayUnpaired += id => unpairedId = id;

        state.DisableDisplay("display-1", "session-b");

        state.IsDisplayConnected("display-1").ShouldBeTrue();
        state.GetSessionForDisplay("display-1").ShouldBe("session-a");
        unpairedId.ShouldBeNull();
    }

    [Fact]
    public void IsDisplayConnected_ReturnsFalseForUnknownDisplay()
    {
        state.IsDisplayConnected("unknown").ShouldBeFalse();
    }
}
