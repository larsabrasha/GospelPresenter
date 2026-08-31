using Android.App;
using Android.Content;
using Android.Content.PM;

namespace GospelPresenter;

/// <summary>
/// Receives the gospelpresenter:// callback that completes the system-browser sign-in flow and
/// hands it to WebAuthenticator.
/// </summary>
[Activity(NoHistory = true, LaunchMode = LaunchMode.SingleTop, Exported = true)]
[IntentFilter(
    [Intent.ActionView],
    Categories = [Intent.CategoryDefault, Intent.CategoryBrowsable],
    DataScheme = CallbackScheme)]
public class WebAuthenticationCallbackActivity : Microsoft.Maui.Authentication.WebAuthenticatorCallbackActivity
{
    private const string CallbackScheme = "gospelpresenter";
}
