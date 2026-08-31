using GospelPresenter.Shared.Services;

namespace GospelPresenter.Desktop.Services;

/// <summary>
/// Nothing overlaps the page here. The measurement exists for phones, where the OS draws a clock and
/// a battery over the top of the app and the live view has to keep its content out from under them;
/// a desktop window is given its whole client area, so the answer is zero — the same one the web
/// host gives.
/// </summary>
public class DesktopStatusBarService : IStatusBarService
{
    public int GetStatusBarHeight() => 0;
}
