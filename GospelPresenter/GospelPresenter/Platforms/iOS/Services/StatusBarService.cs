using GospelPresenter.Shared.Services;

namespace GospelPresenter.Services;

using UIKit;

public class StatusBarService : IStatusBarService
{
    public int GetStatusBarHeight()
    {
        var scene = UIApplication.SharedApplication.ConnectedScenes
            .OfType<UIWindowScene>()
            .FirstOrDefault();

        var statusBarManager = scene?.StatusBarManager;
        if (statusBarManager != null)
        {
            return (int)statusBarManager.StatusBarFrame.Height;
        }

        return 0;
    }
}
