using GospelPresenter.Shared.Services;
using GospelPresenter.Shared.State;
using Microsoft.Extensions.Logging.Abstractions;
using Shouldly;

namespace GospelPresenter.UnitTests.State;

/// <summary>
/// The anonymous image proxies hand out the slide on screen and the overlay over it, and nothing
/// else in the organisation's library.
/// </summary>
public class LiveMediaScopeTests
{
    private const string SessionId = "0123456789abcdef0123456789abcdef";
    private readonly SharedAppState state = new(TimeSpan.FromMinutes(240), NullLogger<SharedAppState>.Instance);

    [Fact]
    public void IsOnScreen_TheCurrentSlidesImage_IsAllowed_AndAnotherImageIsNot()
    {
        state.SetLiveSlide(SessionId, new LiveSlide(
            LiveSlideStatus.ShowingPresentation, ProjectItemType.Image, "item", 0,
            null, null, ImageUrlHelper.LiveOrgImageUrl(SessionId, "img-1", "full"), null));

        LiveMediaScope.IsOnScreen(state, SessionId, "org-image/img-1/full").ShouldBeTrue();
        LiveMediaScope.IsOnScreen(state, SessionId, "org-image/img-1/thumb").ShouldBeFalse();
        LiveMediaScope.IsOnScreen(state, SessionId, "org-image/img-2/full").ShouldBeFalse();
        LiveMediaScope.IsOnScreen(state, SessionId, "slides/deck/1").ShouldBeFalse();
    }

    [Fact]
    public void IsOnScreen_TheActiveOverlaysImage_IsAllowed()
    {
        state.SetLiveSlide(SessionId, new LiveSlide(
            LiveSlideStatus.ShowingPresentation, ProjectItemType.Song, "item", 0, null, null, null, null));
        state.SetOverlay(SessionId, null, ImageUrlHelper.LiveOverlayImageUrl(SessionId, "ov-1"), "ov-1");

        LiveMediaScope.IsOnScreen(state, SessionId, "overlay/ov-1/image").ShouldBeTrue();
        LiveMediaScope.IsOnScreen(state, SessionId, "overlay/ov-2/image").ShouldBeFalse();
    }

    [Fact]
    public void IsOnScreen_AnotherSessionsSlide_IsNotAllowedUnderThisSessionId()
    {
        const string other = "ffffffffffffffffffffffffffffffff";
        state.SetLiveSlide(other, new LiveSlide(
            LiveSlideStatus.ShowingPresentation, ProjectItemType.Image, "item", 0,
            null, null, ImageUrlHelper.LiveOrgImageUrl(other, "img-1", "full"), null));

        LiveMediaScope.IsOnScreen(state, SessionId, "org-image/img-1/full").ShouldBeFalse();
    }
}
