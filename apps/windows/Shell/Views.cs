// The core's views as the pages read them (crates/gp-core/src/views.rs, page_models.rs), decoded, as
// apps/mac/Sources/GPMac/Views.swift's: only the fields this app shows.
namespace GospelPresenter.Shell;

/// <summary>A presentation as a list shows it (`Presentation`), with its number of items where the view gives it.</summary>
public sealed record PresentationRow(
    string Id, string Name, string? EventDate, string? Time, string? Location, string? Description, double? UpdatedAt,
    int? ItemCount);

/// <summary>One of the start page's lists as the core groups them for every shell (`startPageView`): Idag, Kommande
/// or Senast ändrade, in their order, an empty one left out; its title a text's key; whether its rows show their date
/// and its year.</summary>
public sealed record StartList(string Id, string Title, bool ShowDate, bool WithYear, List<PresentationRow> Rows);

/// <summary>The views this app reads, by the core's names.</summary>
public static class Views
{
    /// <summary>The start page's lists for <paramref name="today"/> (`YYYY-MM-DD`, the device's date).</summary>
    public static List<StartList> StartPage(this Core core, string today) =>
        core.View<List<StartList>>("startPageView", new { today });

    /// <summary>Today's date on this device as event dates are stored (`localToday`).</summary>
    public static string LocalToday(DateTime? now = null) => 
        (now ?? DateTime.Now).ToString("yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture);
}
