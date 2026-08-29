using System.Globalization;
using ElectronNET.API;
using GospelPresenter.Client.Auth;
using GospelPresenter.Shared.Models;
using GospelPresenter.Shared.Services;

namespace GospelPresenter.Desktop.Services;

/// <summary>
/// Decides which language the app runs in, and remembers the user's choice.
///
/// The web negotiates this per request — Accept-Language, a culture cookie, request localization.
/// None of that applies here: there is one user and one window, so the language is a property of
/// the process, set once at startup and again when the user picks one.
///
/// The order is the user's stored choice, then the operating system, then English.
/// </summary>
public class DesktopCultureService(
    DeviceAuthService auth,
    IServiceProvider services,
    ILogger<DesktopCultureService> logger)
{
    /// <summary>The languages the app has resources for; anything else falls back to English.</summary>
    private static readonly string[] SupportedLanguages = ["en", "sv"];

    private const string FallbackLanguage = "en";

    /// <summary>
    /// Resolves and applies the language. Called once Electron is ready and before the window is
    /// created, so the first paint is already in the right language — there is no second chance
    /// without a reload.
    /// </summary>
    public async Task ApplyAsync()
    {
        Apply(await ResolveAsync());
    }

    /// <summary>
    /// Stores the user's choice and applies it. The setting is the same row the web writes, so a
    /// language picked here syncs to the server and follows the user to their other devices.
    /// </summary>
    public async Task SetLanguageAsync(string language)
    {
        var chosen = Supported(language) ?? FallbackLanguage;

        var identity = auth.CurrentIdentity;
        if (identity is not null)
        {
            await using var scope = services.CreateAsyncScope();
            var users = scope.ServiceProvider.GetRequiredService<IUserService>();
            await users.SetUserSettingAsync(
                identity.UserId, UserSetting.PreferredLanguage, chosen, CallerFor(identity));
        }

        Apply(chosen);
        logger.LogInformation("Language set to {Language}", chosen);
    }

    private async Task<string> ResolveAsync()
    {
        // A language the user has actually chosen outranks anything the machine can tell us. It
        // arrives with the first sync, so on a fresh installation the operating system decides and
        // a language stored on the server takes over at the next start — or immediately, if the
        // user picks it in Settings.
        var stored = Supported(await StoredLanguageAsync());
        if (stored is not null)
            return stored;

        // Electron, not CultureInfo. On macOS the two disagree: CultureInfo follows the POSIX
        // LANG variable, which a terminal or a launch agent can set to something that has nothing
        // to do with the language the user reads their Mac in, while Electron resolves the real
        // preference list (AppleLanguages) — the same one it hands its own renderer as --lang.
        // Measured on a Swedish Mac in an en_US.UTF-8 shell: Electron said sv, CultureInfo said
        // en-US, and the app came up in English.
        var fromHost = Supported(await HostLanguageAsync());
        if (fromHost is not null)
            return fromHost;

        // Only reached if Electron could not answer. CultureInfo is then the sole remaining signal
        // and is right far more often than not — it is wrong specifically when LANG contradicts
        // the user's chosen language, which is the case Electron was consulted for.
        return Supported(CultureInfo.CurrentUICulture.TwoLetterISOLanguageName) ?? FallbackLanguage;
    }

    private async Task<string?> StoredLanguageAsync()
    {
        var identity = auth.CurrentIdentity;
        if (identity is null)
            return null;

        try
        {
            await using var scope = services.CreateAsyncScope();
            var users = scope.ServiceProvider.GetRequiredService<IUserService>();
            return await users.GetUserSettingAsync(
                identity.UserId, UserSetting.PreferredLanguage, CallerFor(identity));
        }
        catch (Exception ex)
        {
            // A language is not worth failing startup over.
            logger.LogWarning(ex, "Could not read the stored language; falling back to the system language");
            return null;
        }
    }

    private async Task<string?> HostLanguageAsync()
    {
        try
        {
            return await Electron.App.GetLocaleAsync();
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Could not read the system language from Electron");
            return null;
        }
    }

    private void Apply(string language)
    {
        var culture = new CultureInfo(language);
        CultureInfo.DefaultThreadCurrentCulture = culture;
        CultureInfo.DefaultThreadCurrentUICulture = culture;
    }

    /// <summary>
    /// Narrows a locale name to a language the app has resources for, or null. Handles the
    /// regional forms the sources return — Electron answers sv-SE where the resources are sv.
    /// </summary>
    private static string? Supported(string? locale)
    {
        if (string.IsNullOrWhiteSpace(locale))
            return null;

        string language;
        try
        {
            language = new CultureInfo(locale).TwoLetterISOLanguageName;
        }
        catch (CultureNotFoundException)
        {
            return null;
        }

        return Array.Exists(SupportedLanguages, l => l == language) ? language : null;
    }

    private static CallerContext CallerFor(DeviceIdentity identity) =>
        new(identity.UserId, identity.Role, identity.OrganizationId);
}
