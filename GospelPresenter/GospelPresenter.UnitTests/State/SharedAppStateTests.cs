using GospelPresenter.Shared.Models;
using GospelPresenter.Shared.State;
using Microsoft.Extensions.Logging.Abstractions;
using Shouldly;

namespace GospelPresenter.UnitTests.State;

/// <summary>
/// What counts as a change worth announcing.
///
/// SharedAppState is one singleton for the whole process and every open page subscribes, so a
/// notification is not cheap: it repaints a page in every circuit that is listening for that
/// session. The surfaces that write here mostly report what they are *showing* rather than what
/// they *changed* — a mirroring desktop client sends its whole state on every slide change — so
/// without a comparison the common case was four notifications announcing nothing.
/// </summary>
public class SharedAppStateTests
{
    private const string SessionId = "session-1";
    private const string OrganizationId = "org-1";
    private const string PresentationId = "pres-1";

    private readonly SharedAppState state = new(TimeSpan.FromMinutes(240), NullLogger<SharedAppState>.Instance);

    private static readonly LiveSlide Slide = SharedAppState.DefaultSlide with
    {
        ItemType = ProjectItemType.Song,
        ProjectItemId = "item-1",
        ItemPartIndex = 0,
        Text = "Amazing grace"
    };

    [Fact]
    public void SetLiveSlide_WritingTheSameSlideAgain_AnnouncesNothing()
    {
        state.SetLiveSlide(SessionId, Slide);

        CountingChanges(() => state.SetLiveSlide(SessionId, Slide)).ShouldBe(0);
    }

    [Fact]
    public void SetLiveSlide_WritingTheSameSlideAgain_KeepsTheSlide()
    {
        state.SetLiveSlide(SessionId, Slide);
        state.SetLiveSlide(SessionId, Slide);

        state.GetLiveSlide(SessionId).ShouldBe(Slide);
    }

    [Fact]
    public void SetLiveSlide_MovingToAnotherSlide_AnnouncesTheChange()
    {
        state.SetLiveSlide(SessionId, Slide);

        CountingChanges(() => state.SetLiveSlide(SessionId, Slide with { ItemPartIndex = 1 }))
            .ShouldBe(1);
    }

    /// <summary>
    /// The reason the comparison is on the value and not the reference: SetOverlay builds a new
    /// ActiveOverlay every time it is called, so an identical overlay is never the same instance.
    /// </summary>
    [Fact]
    public void SetOverlay_SettingTheSameOverlayAgain_AnnouncesNothing()
    {
        state.SetOverlay(SessionId, "Welcome", null, "overlay-1");

        CountingChanges(() => state.SetOverlay(SessionId, "Welcome", null, "overlay-1")).ShouldBe(0);
    }

    /// <summary>
    /// The commonest empty notification of them all: a mirroring client reports "no overlay" on
    /// every single slide change, and the session usually has none to begin with.
    /// </summary>
    [Fact]
    public void ClearOverlay_WhenNoOverlayIsShowing_AnnouncesNothing()
    {
        CountingChanges(() => state.ClearOverlay(SessionId)).ShouldBe(0);
    }

    [Fact]
    public void ClearOverlay_WhenAnOverlayIsShowing_AnnouncesTheChange()
    {
        state.SetOverlay(SessionId, "Welcome", null, "overlay-1");

        CountingChanges(() => state.ClearOverlay(SessionId)).ShouldBe(1);
    }

    [Fact]
    public void ActivatePresentation_ReportingTheSameSessionAgain_AnnouncesNothing()
    {
        state.ActivatePresentation(SessionId, OrganizationId, PresentationId, "Sunday service");

        CountingChanges(() =>
                state.ActivatePresentation(SessionId, OrganizationId, PresentationId, "Sunday service"))
            .ShouldBe(0);
    }

    /// <summary>
    /// PresentationActivated is a separate event with its own subscribers, so suppressing the
    /// repetition has to cover it too. Display.OnPresentationActivated is the catch-up for a screen
    /// that was already paired when the presentation started; a screen that pairs later is told by
    /// RemoteDisplayState.DisplayPaired instead, so nothing needs the repeat.
    /// </summary>
    [Fact]
    public void ActivatePresentation_ReportingTheSameSessionAgain_DoesNotRaisePresentationActivatedAgain()
    {
        state.ActivatePresentation(SessionId, OrganizationId, PresentationId);
        var activations = 0;
        state.PresentationActivated += _ => activations++;

        state.ActivatePresentation(SessionId, OrganizationId, PresentationId);

        activations.ShouldBe(0);
    }

    [Fact]
    public void ActivatePresentation_SwitchingToAnotherPresentation_AnnouncesTheChange()
    {
        state.ActivatePresentation(SessionId, OrganizationId, PresentationId);

        CountingChanges(() => state.ActivatePresentation(SessionId, OrganizationId, "pres-2"))
            .ShouldBe(1);
    }

    /// <summary>
    /// Presentation.Dispose and MirroredSessionProjector.End both call this without knowing whether
    /// the session was ever live, so stopping something that was not running is the common case.
    /// </summary>
    [Fact]
    public void DeactivatePresentation_WhenNothingWasRunning_AnnouncesNothing()
    {
        CountingChanges(() => state.DeactivatePresentation(SessionId)).ShouldBe(0);
    }

    [Fact]
    public void DeactivatePresentation_WhenAPresentationWasRunning_AnnouncesTheChange()
    {
        state.ActivatePresentation(SessionId, OrganizationId, PresentationId);

        CountingChanges(() => state.DeactivatePresentation(SessionId)).ShouldBe(1);
    }

    [Fact]
    public void EnableRemoteControl_WhenItIsAlreadyOn_AnnouncesNothing()
    {
        state.EnableRemoteControl(SessionId);

        CountingChanges(() => state.EnableRemoteControl(SessionId)).ShouldBe(0);
    }

    [Fact]
    public void DisableRemoteControl_WhenItIsAlreadyOff_AnnouncesNothing()
    {
        CountingChanges(() => state.DisableRemoteControl(SessionId)).ShouldBe(0);
    }

    [Fact]
    public void DisableRemoteControl_WhenItWasOn_AnnouncesTheChange()
    {
        state.EnableRemoteControl(SessionId);

        CountingChanges(() => state.DisableRemoteControl(SessionId)).ShouldBe(1);
    }

    [Fact]
    public void SetSessionAudio_ClearingAudioThatWasNeverSet_AnnouncesNothing()
    {
        CountingChanges(() => state.SetSessionAudio(SessionId, null)).ShouldBe(0);
    }

    /// <summary>
    /// The one deliberate exception. A command is an inbox, not a value: two identical "play"
    /// presses are two requests, and dropping the second as a duplicate would lose one of them.
    /// </summary>
    [Fact]
    public void SetAudioCommand_SendingTheSameCommandTwice_AnnouncesBoth()
    {
        var command = new AudioCommand("play", "audio-1", null);

        CountingChanges(() =>
        {
            state.SetAudioCommand(SessionId, command);
            state.SetAudioCommand(SessionId, command);
        }).ShouldBe(2);
    }

    [Fact]
    public void SetLiveSlide_MovingToAnotherSlide_SaysItWasTheSlide()
    {
        state.SetLiveSlide(SessionId, Slide);

        Announced(() => state.SetLiveSlide(SessionId, Slide with { ItemPartIndex = 1 }))!
            .Kind.ShouldBe(SessionChangeKind.Slide);
    }

    [Fact]
    public void EnableRemoteControl_TurningItOn_SaysItWasRemoteControl()
    {
        Announced(() => state.EnableRemoteControl(SessionId))!.Kind.ShouldBe(SessionChangeKind.RemoteControl);
    }

    [Fact]
    public void ActivatePresentation_StartingAPresentation_SaysItWasAnActivation()
    {
        Announced(() => state.ActivatePresentation(SessionId, OrganizationId, PresentationId))!
            .Kind.ShouldBe(SessionChangeKind.Activation);
    }

    [Fact]
    public void ActivatePresentation_StartingAPresentation_NamesTheOrganization()
    {
        Announced(() => state.ActivatePresentation(SessionId, OrganizationId, PresentationId))!
            .OrganizationId.ShouldBe(OrganizationId);
    }

    /// <summary>
    /// The hard case, and the reason the organisation travels in the notification at all: stopping
    /// the presentation is what makes the organisation unanswerable, because it takes the session
    /// out of the active set. Looked up afterwards it would be null, and a dashboard filtering on
    /// its own organisation would miss the one event it most needs to hear.
    /// </summary>
    [Fact]
    public void DeactivatePresentation_StoppingAPresentation_StillNamesTheOrganization()
    {
        state.ActivatePresentation(SessionId, OrganizationId, PresentationId);

        Announced(() => state.DeactivatePresentation(SessionId))!.OrganizationId.ShouldBe(OrganizationId);
    }

    /// <summary>
    /// The same problem in the eviction sweep, which removes the session before announcing it.
    ///
    /// A negative timeout makes a session stale the moment anything looks at it, which is the only
    /// way to reach the sweep without waiting out a real clock. ActivatePresentation touches the
    /// session before it writes it, so the session survives its own activation and is evicted by
    /// the next read.
    /// </summary>
    [Fact]
    public void CleanupStaleSessions_EvictingALiveSession_StillNamesTheOrganization()
    {
        var expiring = new SharedAppState(TimeSpan.FromMilliseconds(-1), NullLogger<SharedAppState>.Instance);
        expiring.ActivatePresentation(SessionId, OrganizationId, PresentationId);
        SessionChange? announced = null;
        expiring.SessionChanged += change => announced ??= change;

        expiring.GetLiveSlide(SessionId);

        announced?.OrganizationId.ShouldBe(OrganizationId);
    }

    /// <summary>
    /// A session with nothing running belongs to no organisation, and appears in no organisation's
    /// list of live services either — so null is the honest answer rather than a missing one.
    /// </summary>
    [Fact]
    public void SetLiveSlide_OnASessionWithNoPresentation_NamesNoOrganization()
    {
        Announced(() => state.SetLiveSlide(SessionId, Slide))!.OrganizationId.ShouldBeNull();
    }

    /// <summary>
    /// Moving a live session to another presentation used to announce nothing, and got away with it
    /// because the caller writes a slide immediately afterwards and every page repainted on that.
    /// A dashboard now ignores slide changes, so this is what tells it the service has changed.
    /// </summary>
    [Fact]
    public void UpdateActivePresentationId_MovingToAnotherPresentation_SaysItWasAnActivation()
    {
        state.ActivatePresentation(SessionId, OrganizationId, PresentationId);

        Announced(() => state.UpdateActivePresentationId(SessionId, "pres-2", "Evening service"))!
            .Kind.ShouldBe(SessionChangeKind.Activation);
    }

    [Fact]
    public void UpdateActivePresentationId_RepeatingThePresentationItIsAlreadyOn_AnnouncesNothing()
    {
        state.ActivatePresentation(SessionId, OrganizationId, PresentationId);

        CountingChanges(() => state.UpdateActivePresentationId(SessionId, PresentationId)).ShouldBe(0);
    }

    /// <summary>
    /// Counts the notifications this session's pages would act on while <paramref name="write"/>
    /// runs. Subscribed inside rather than in the fixture so that the set-up above a test does not
    /// count towards it.
    /// </summary>
    private int CountingChanges(Action write)
    {
        var changes = 0;

        void Count(SessionChange change)
        {
            if (change.SessionId == SessionId) changes++;
        }

        state.SessionChanged += Count;
        try
        {
            write();
        }
        finally
        {
            state.SessionChanged -= Count;
        }

        return changes;
    }

    /// <summary>The first notification this session's pages would receive, or null if there was none.</summary>
    private SessionChange? Announced(Action write)
    {
        SessionChange? announced = null;

        void Remember(SessionChange change)
        {
            if (change.SessionId == SessionId) announced ??= change;
        }

        state.SessionChanged += Remember;
        try
        {
            write();
        }
        finally
        {
            state.SessionChanged -= Remember;
        }

        return announced;
    }
}
