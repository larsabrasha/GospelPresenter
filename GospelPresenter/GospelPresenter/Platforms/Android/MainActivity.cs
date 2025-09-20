using Android.App;
using Android.Content.PM;
using Android.Content;

namespace GospelPresenter;

[Activity(
    Theme = "@style/Maui.SplashTheme",
    MainLauncher = true,
    ConfigurationChanges = ConfigChanges.ScreenSize | ConfigChanges.Orientation | ConfigChanges.UiMode |
                           ConfigChanges.ScreenLayout | ConfigChanges.SmallestScreenSize | ConfigChanges.Density,
    LaunchMode = LaunchMode.SingleTop,
    Exported = true
)]
public class MainActivity : MauiAppCompatActivity
{
}
