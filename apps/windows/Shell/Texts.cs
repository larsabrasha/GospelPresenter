// The app's texts: the web's (apps/web/src/i18n.ts, as texts.json by apps/windows/texts.mjs), in the device's language
// when it is Swedish or English, else Swedish, as the web's default and apps/mac/Sources/GPMac/Texts.swift.
using System.Globalization;
using System.Text.Json;

namespace GospelPresenter.Shell;

public static class Texts
{
    static readonly Dictionary<string, Dictionary<string, string>> table = Load();

    /// <summary>"sv" or "en": the device's, Swedish when it is neither.</summary>
    public static string Language { get; set; } =
        CultureInfo.CurrentUICulture.TwoLetterISOLanguageName == "en" ? "en" : "sv";

    /// <summary>The text for <paramref name="key"/>, its `{name}` placeholders filled from <paramref name="vars"/>; the
    /// key itself when there is none.</summary>
    public static string T(string key, IReadOnlyDictionary<string, object>? vars = null)
    {
        var text = table.GetValueOrDefault(Language)?.GetValueOrDefault(key)
            ?? table.GetValueOrDefault("sv")?.GetValueOrDefault(key) ?? key;
        foreach (var (name, value) in vars ?? new Dictionary<string, object>())
            text = text.Replace($"{{{name}}}", Convert.ToString(value, CultureInfo.InvariantCulture));
        return text;
    }

    static Dictionary<string, Dictionary<string, string>> Load()
    {
        using var stream = typeof(Texts).Assembly.GetManifestResourceStream("texts.json");
        if (stream is null) return [];
        return JsonSerializer.Deserialize<Dictionary<string, Dictionary<string, string>>>(stream) ?? [];
    }
}
