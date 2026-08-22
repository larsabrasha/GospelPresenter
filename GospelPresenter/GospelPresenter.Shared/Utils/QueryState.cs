using Microsoft.AspNetCore.Components;
using Microsoft.AspNetCore.WebUtilities;

namespace GospelPresenter.Shared.Utils;

/// <summary>
/// Reads and writes a single query-string parameter for list views, so search text and sort choice
/// survive navigation and can be shared as links.
///
/// A parameter holding its default value is removed rather than written, which is what keeps
/// /admin/songs from turning into /admin/songs?q=&amp;sort=NameAsc merely because someone visited it.
/// Writes always replace the current history entry: typing in a search field must not fill the back
/// stack with one entry per keystroke.
/// </summary>
public static class QueryState
{
    public static string? Read(NavigationManager navigation, string key)
    {
        var query = new Uri(navigation.Uri).Query;
        if (string.IsNullOrEmpty(query))
            return null;

        return QueryHelpers.ParseQuery(query).TryGetValue(key, out var values)
            ? values.FirstOrDefault()
            : null;
    }

    /// <summary>Reads an enum parameter, falling back to <paramref name="fallback"/> when absent or unparsable.</summary>
    public static T ReadEnum<T>(NavigationManager navigation, string key, T fallback) where T : struct, Enum
    {
        var raw = Read(navigation, key);
        return Enum.TryParse<T>(raw, ignoreCase: true, out var parsed) && Enum.IsDefined(parsed)
            ? parsed
            : fallback;
    }

    /// <summary>Writes the parameter, or removes it when the value is null, empty or the default.</summary>
    public static void Write(NavigationManager navigation, string key, string? value, string? defaultValue = null)
    {
        var effective = string.IsNullOrEmpty(value) || value == defaultValue ? null : value;
        var target = navigation.GetUriWithQueryParameter(key, effective);
        if (target == navigation.Uri)
            return;

        navigation.NavigateTo(target, forceLoad: false, replace: true);
    }
}
