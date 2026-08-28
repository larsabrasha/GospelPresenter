using ObjCRuntime;
using UIKit;
using Velopack;

namespace GospelPresenter;

public class Program
{
    // This is the main entry point of the application.
    static void Main(string[] args)
    {
        // MUST stay the first executable statement. Velopack runs the app with hook arguments
        // during install, update and uninstall; the hook executes and the process exits from
        // inside Run(), so anything above this line runs again on every one of those.
        // See adr/0002-app-distribution-and-updates.md (19).
        VelopackApp.Build().Run();

        // if you want to use a different Application Delegate class from "AppDelegate"
        // you can specify it here.
        UIApplication.Main(args, null, typeof(AppDelegate));
    }
}
