using GospelPresenter.Shared.State;
using Shouldly;

namespace GospelPresenter.UnitTests.State;

public class PublicOutputStateTests
{
    private const string Code = "abc1234";
    private const string OtherCode = "xyz9876";
    private const string ViewerA = "viewer-a";
    private const string ViewerB = "viewer-b";

    private readonly PublicOutputState state = new();

    [Fact]
    public void GetViewerCount_ForUnknownCode_ReturnsZero()
    {
        state.GetViewerCount(Code).ShouldBe(0);
    }

    [Fact]
    public void TryAddViewer_AddsViewer()
    {
        var added = state.TryAddViewer(Code, ViewerA, out _);

        added.ShouldBeTrue();
        state.GetViewerCount(Code).ShouldBe(1);
    }

    [Fact]
    public void TryAddViewer_WithSameViewerIdTwice_CountsOnce()
    {
        state.TryAddViewer(Code, ViewerA, out _);
        state.TryAddViewer(Code, ViewerA, out _);

        state.GetViewerCount(Code).ShouldBe(1);
    }

    [Fact]
    public void TryAddViewer_WithDifferentViewerIds_CountsEach()
    {
        state.TryAddViewer(Code, ViewerA, out _);
        state.TryAddViewer(Code, ViewerB, out _);

        state.GetViewerCount(Code).ShouldBe(2);
    }

    [Fact]
    public void TryAddViewer_CountsPerOutput()
    {
        state.TryAddViewer(Code, ViewerA, out _);
        state.TryAddViewer(OtherCode, ViewerB, out _);

        state.GetViewerCount(Code).ShouldBe(1);
        state.GetViewerCount(OtherCode).ShouldBe(1);
    }

    [Fact]
    public void TryAddViewer_WhenReconnecting_CompletesThePreviousChannel()
    {
        state.TryAddViewer(Code, ViewerA, out var first);
        state.TryAddViewer(Code, ViewerA, out var second);

        first.Completion.IsCompleted.ShouldBeTrue();
        second.Completion.IsCompleted.ShouldBeFalse();
    }

    [Fact]
    public void TryAddViewer_AtCap_RejectsNewViewer()
    {
        var capped = new PublicOutputState(maxViewersPerOutput: 1);
        capped.TryAddViewer(Code, ViewerA, out _);

        var added = capped.TryAddViewer(Code, ViewerB, out _);

        added.ShouldBeFalse();
        capped.GetViewerCount(Code).ShouldBe(1);
    }

    [Fact]
    public void TryAddViewer_AtCap_StillAcceptsAnAlreadyRegisteredViewer()
    {
        var capped = new PublicOutputState(maxViewersPerOutput: 1);
        capped.TryAddViewer(Code, ViewerA, out _);

        // A viewer that is already counted is reconnecting, not arriving — rejecting it would
        // break the page of someone who merely locked their phone.
        var added = capped.TryAddViewer(Code, ViewerA, out _);

        added.ShouldBeTrue();
    }

    [Fact]
    public void RemoveViewer_DecreasesCount()
    {
        state.TryAddViewer(Code, ViewerA, out _);
        state.TryAddViewer(Code, ViewerB, out _);

        state.RemoveViewer(Code, ViewerA);

        state.GetViewerCount(Code).ShouldBe(1);
    }

    [Fact]
    public void RemoveViewer_ForLastViewer_ForgetsTheOutput()
    {
        state.TryAddViewer(Code, ViewerA, out _);

        state.RemoveViewer(Code, ViewerA);

        state.GetCodesWithViewers().ShouldNotContain(Code);
    }

    [Fact]
    public void RemoveViewer_ForUnknownViewer_DoesNothing()
    {
        state.TryAddViewer(Code, ViewerA, out _);

        state.RemoveViewer(Code, ViewerB);

        state.GetViewerCount(Code).ShouldBe(1);
    }

    [Fact]
    public void RemoveAllViewers_RemovesEveryoneAndCompletesTheirChannels()
    {
        state.TryAddViewer(Code, ViewerA, out var readerA);
        state.TryAddViewer(Code, ViewerB, out var readerB);

        state.RemoveAllViewers(Code);

        state.GetViewerCount(Code).ShouldBe(0);
        readerA.Completion.IsCompleted.ShouldBeTrue();
        readerB.Completion.IsCompleted.ShouldBeTrue();
    }

    [Fact]
    public void GetCodesWithViewers_ReturnsOnlyOutputsThatHaveViewers()
    {
        state.TryAddViewer(Code, ViewerA, out _);

        state.GetCodesWithViewers().ShouldBe([Code]);
    }

    [Fact]
    public async Task Publish_DeliversTheEventToEveryViewer()
    {
        state.TryAddViewer(Code, ViewerA, out var readerA);
        state.TryAddViewer(Code, ViewerB, out var readerB);

        state.Publish(Code, PublicOutputEvent.Slide("<p>Amazing grace</p>"));

        (await readerA.ReadAsync()).Html.ShouldBe("<p>Amazing grace</p>");
        (await readerB.ReadAsync()).Html.ShouldBe("<p>Amazing grace</p>");
    }

    [Fact]
    public async Task Publish_WhenAViewerHasNotKeptUp_DeliversOnlyTheLatestEvent()
    {
        state.TryAddViewer(Code, ViewerA, out var reader);

        state.Publish(Code, PublicOutputEvent.Slide("<p>First</p>"));
        state.Publish(Code, PublicOutputEvent.Slide("<p>Second</p>"));

        // Only the current slide matters, so a stalled viewer catches up rather than replaying.
        (await reader.ReadAsync()).Html.ShouldBe("<p>Second</p>");
        reader.TryRead(out _).ShouldBeFalse();
    }

    [Fact]
    public void Publish_WithNoViewers_DoesNothing()
    {
        Should.NotThrow(() => state.Publish(Code, PublicOutputEvent.Idle));
    }

    [Fact]
    public void ViewerCountChanged_IsRaisedWhenTheFirstViewerArrives()
    {
        var raisedFor = new List<string>();
        state.ViewerCountChanged += code => raisedFor.Add(code);

        state.TryAddViewer(Code, ViewerA, out _);

        raisedFor.ShouldBe([Code]);
    }
}
