using Serilog;

namespace GospelPresenter;

public partial class App : Application
{
    public App()
    {
        InitializeComponent();
    }

    protected override Window CreateWindow(IActivationState? activationState)
    {
        var window = new Window(new MainPage()) { Title = "GospelPresenter" };

        window.Created += (sender, args) =>
        {
            Log.Information("App was started");

            Log.Information("********************************************************************");
            Log.Information("* {Key,22}: {Value,-40} *", "App Id", AppInfo.PackageName);
            Log.Information("* {Key,22}: {Value,-40} *", "App Version", AppInfo.VersionString);
            Log.Information("* {Key,22}: {Value,-40} *", "Device Manufacturer", DeviceInfo.Manufacturer);
            Log.Information("* {Key,22}: {Value,-40} *", "Device Model", DeviceInfo.Model);
            Log.Information("* {Key,22}: {Value,-40} *", "Device Platform", DeviceInfo.Platform.ToString());
            Log.Information("* {Key,22}: {Value,-40} *", "Device Os Version", DeviceInfo.VersionString);
            Log.Information("********************************************************************");

#if DEBUG
            Log.Information("{Key}: {Value}", "App Data Directory", FileSystem.Current.AppDataDirectory);
#endif
        };

        window.Destroying += (sender, args) =>
        {
            Log.Information("App is terminating");
            Log.CloseAndFlush();
        };

        return window;
    }
}
