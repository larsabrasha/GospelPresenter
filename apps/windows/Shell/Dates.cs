// TEMPORARY(core): a rule in a shell, to be replaced by the core's view (Lars, 2026-11-22: no logic in a shell). The
// core's owner moves this line, now in gp_tui::dates::subtitle and apps/mac's Model.swift too, into a view; then the
// start page reads it from there and this file goes. Until then, as the Mac's `subtitle` and `dateLabel` (the web's
// dashboard.ts): "Idag", "Imorgon" or "mån 4 maj" (with the year where the list asks), the time and the place.
using System.Globalization;

namespace GospelPresenter.Shell;

public static class Dates
{
    /// <summary>The culture dates are written in for the app's language.</summary>
    public static CultureInfo Culture => CultureInfo.GetCultureInfo(Texts.Language == "sv" ? "sv-SE" : "en-GB");

    /// <summary>The row's second line, leaving out what is not set.</summary>
    public static string Subtitle(this PresentationRow row, string today, bool showDate, bool withYear)
    {
        var date = showDate && row.EventDate is { } d ? DateLabel(d, today, withYear) : null;
        var when = string.Join(" · ", new[] { date, row.Time }.Where(s => !string.IsNullOrEmpty(s)));
        return string.Join(" · ", new[] { when, row.Location }.Where(s => !string.IsNullOrEmpty(s)));
    }

    /// <summary>"Idag", "Imorgon", or the day and date, with the year when asked; the text itself when it is not a
    /// date.</summary>
    public static string DateLabel(string iso, string today, bool withYear)
    {
        if (iso == today) return Texts.T("presentations.today");
        if (!DateTime.TryParseExact(iso, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var day)) return iso;
        if (DateTime.TryParseExact(today, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var now)
            && now.AddDays(1) == day) return Texts.T("presentations.tomorrow");
        return day.ToString(withYear ? "ddd d MMMM yyyy" : "ddd d MMMM", Culture).Replace(".", "");
    }
}
