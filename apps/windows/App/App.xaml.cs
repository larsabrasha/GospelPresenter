// The app: one window on the demo data, as the Mac app's openDemo (apps/mac/Sources/GPMac/AppState.swift).
using Microsoft.UI.Xaml;

namespace GospelPresenter.App;

public partial class App : Application
{
    Window? window;

    public App() => InitializeComponent();

    protected override void OnLaunched(LaunchActivatedEventArgs args)
    {
        window = new MainWindow();
        window.Activate();
    }
}
