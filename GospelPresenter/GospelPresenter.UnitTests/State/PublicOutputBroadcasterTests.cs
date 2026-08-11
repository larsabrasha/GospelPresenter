using GospelPresenter.Shared.Services;
using GospelPresenter.Shared.State;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Shouldly;

namespace GospelPresenter.UnitTests.State;

public class PublicOutputBroadcasterTests : IDisposable
{
    private const string OutputCode = "abc1234";
    private const string SessionId = "sess1234";
    private const string OrganizationId = "org-1";
    private const string LyricLine = "Amazing grace how sweet the sound";

    private readonly ServiceProvider services;
    private readonly SharedAppState sharedAppState = new(TimeSpan.FromMinutes(240));
    private readonly RemoteDisplayState remoteDisplayState = new();
    private readonly PublicOutputState publicOutputState = new();
    private readonly PublicOutputBroadcaster broadcaster;

    public PublicOutputBroadcasterTests()
    {
        services = new ServiceCollection()
            .AddLogging()
            .AddLocalization()
            .BuildServiceProvider();

        broadcaster = new PublicOutputBroadcaster(
            services,
            services.GetRequiredService<ILoggerFactory>(),
            sharedAppState,
            remoteDisplayState,
            publicOutputState);
    }

    public void Dispose()
    {
        broadcaster.Dispose();
        services.Dispose();
    }

    [Fact]
    public async Task GetCurrentEventAsync_WhenNoPresentationIsBoundToTheOutput_ReturnsIdle()
    {
        var result = await broadcaster.GetCurrentEventAsync(OutputCode);

        result.Type.ShouldBe(PublicOutputEventType.Idle);
    }

    [Fact]
    public async Task GetCurrentEventAsync_WhenTheBoundPresentationIsNotShowing_ReturnsIdle()
    {
        remoteDisplayState.EnableDisplay(OutputCode, SessionId);

        var result = await broadcaster.GetCurrentEventAsync(OutputCode);

        result.Type.ShouldBe(PublicOutputEventType.Idle);
    }

    [Fact]
    public async Task GetCurrentEventAsync_WhenShowingASong_ReturnsTheRenderedSlide()
    {
        StartBroadcastingSong();

        var result = await broadcaster.GetCurrentEventAsync(OutputCode);

        result.Type.ShouldBe(PublicOutputEventType.Slide);
        result.Html.ShouldNotBeNull();
        result.Html.ShouldContain(LyricLine);
    }

    [Fact]
    public async Task GetCurrentEventAsync_WhenShowingABlackScreen_ReturnsIdle()
    {
        StartBroadcastingSong();
        sharedAppState.ToggleBlackScreen(SessionId);

        var result = await broadcaster.GetCurrentEventAsync(OutputCode);

        // A visitor holding a phone cannot tell an all-black page from a broken one, so a black
        // screen shows the waiting screen instead of nothing at all.
        result.Type.ShouldBe(PublicOutputEventType.Idle);
    }

    [Fact]
    public async Task GetCurrentEventAsync_AfterTheOutputIsSwitchedOff_ReturnsIdle()
    {
        StartBroadcastingSong();
        remoteDisplayState.DisableDisplay(OutputCode, SessionId);

        var result = await broadcaster.GetCurrentEventAsync(OutputCode);

        result.Type.ShouldBe(PublicOutputEventType.Idle);
    }

    [Fact]
    public async Task GetCurrentEventAsync_RewritesImageUrlsThroughTheOutputProxy()
    {
        var liveImageUrl = ImageUrlHelper.LiveSlidesPageUrl(SessionId, "slides-1", 3);
        StartBroadcasting(new LiveSlide(
            LiveSlideStatus.ShowingPresentation,
            ProjectItemType.Slides,
            "item-1",
            0,
            null,
            null,
            liveImageUrl,
            null));

        var result = await broadcaster.GetCurrentEventAsync(OutputCode);

        // The operator's session id must never reach a visitor's device: knowing it grants
        // access to the unauthenticated /live view for as long as the presentation runs.
        result.Html.ShouldNotBeNull();
        result.Html.ShouldNotContain(SessionId);
        result.Html.ShouldContain($"/api/watch/{OutputCode}/image/slides/slides-1/3");
    }

    [Fact]
    public void GetBroadcastingOrganizationId_WhenNothingIsBroadcasting_ReturnsNull()
    {
        // This is the gate on the image proxy: no organisation means no image is served.
        broadcaster.GetBroadcastingOrganizationId(OutputCode).ShouldBeNull();
    }

    [Fact]
    public void GetBroadcastingOrganizationId_WhenTheBoundPresentationIsNotShowing_ReturnsNull()
    {
        remoteDisplayState.EnableDisplay(OutputCode, SessionId);

        broadcaster.GetBroadcastingOrganizationId(OutputCode).ShouldBeNull();
    }

    [Fact]
    public void GetBroadcastingOrganizationId_WhileBroadcasting_ReturnsTheOrganization()
    {
        StartBroadcastingSong();

        broadcaster.GetBroadcastingOrganizationId(OutputCode).ShouldBe(OrganizationId);
    }

    [Fact]
    public void GetBroadcastingOrganizationId_AfterTheOutputIsSwitchedOff_ReturnsNull()
    {
        StartBroadcastingSong();
        remoteDisplayState.DisableDisplay(OutputCode, SessionId);

        // Switching an output off must stop its images immediately, not at the next timeout.
        broadcaster.GetBroadcastingOrganizationId(OutputCode).ShouldBeNull();
    }

    [Fact]
    public void GetBroadcastingOrganizationId_ForAnotherOutputCode_ReturnsNull()
    {
        StartBroadcastingSong();

        broadcaster.GetBroadcastingOrganizationId("zzz9999").ShouldBeNull();
    }

    [Fact]
    public async Task GetCurrentEventAsync_WhenShowingBibleText_ReturnsTheRenderedText()
    {
        StartBroadcasting(new LiveSlide(
            LiveSlideStatus.ShowingPresentation,
            ProjectItemType.BibleText,
            "item-1",
            0,
            "For God so loved the world",
            "John 3:16",
            null,
            null));

        var result = await broadcaster.GetCurrentEventAsync(OutputCode);

        result.Type.ShouldBe(PublicOutputEventType.Slide);
        result.Html.ShouldNotBeNull();
        result.Html.ShouldContain("For God so loved the world");
        result.Html.ShouldContain("John 3:16");
    }

    private void StartBroadcastingSong() =>
        StartBroadcasting(new LiveSlide(
            LiveSlideStatus.ShowingPresentation,
            ProjectItemType.Song,
            "item-1",
            0,
            null,
            null,
            null,
            new SongPart("part-1", null, null, null, LyricLine)));

    private void StartBroadcasting(LiveSlide slide)
    {
        remoteDisplayState.EnableDisplay(OutputCode, SessionId);
        sharedAppState.ActivatePresentation(SessionId, OrganizationId, "presentation-1", "Sunday service");
        sharedAppState.SetLiveSlide(SessionId, slide);
    }
}
