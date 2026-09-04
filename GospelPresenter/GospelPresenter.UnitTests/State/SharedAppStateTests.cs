using System.ComponentModel;
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

    /// <summary>
    /// Counts the notifications this session's pages would act on while <paramref name="write"/>
    /// runs. Subscribed inside rather than in the fixture so that the set-up above a test does not
    /// count towards it.
    /// </summary>
    private int CountingChanges(Action write)
    {
        var changes = 0;

        void Count(object? sender, PropertyChangedEventArgs e)
        {
            if (e.PropertyName == SessionId) changes++;
        }

        state.PropertyChanged += Count;
        try
        {
            write();
        }
        finally
        {
            state.PropertyChanged -= Count;
        }

        return changes;
    }
}
