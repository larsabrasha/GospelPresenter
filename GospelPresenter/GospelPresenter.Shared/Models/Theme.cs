using GospelPresenter.Shared.State;

namespace GospelPresenter.Shared.Models;

/// <summary>
/// A named slide theme. Rows with no organisation are the themes Gospel Presenter ships; they are
/// authored in <c>BuiltInThemes</c> and upserted on every deploy, so improving one changes the look
/// for everyone using it. Organisation-owned themes reuse this table.
/// </summary>
public class Theme : ISyncTracked
{
    /// <summary>A stable slug for built-in themes, so presentations keep pointing at them across reseeding.</summary>
    public string Id { get; set; } = Guid.NewGuid().ToString();

    /// <summary>Null for built-in themes.</summary>
    public string? OrganizationId { get; set; }

    public Organization? Organization { get; set; }

    /// <summary>
    /// Empty for built-in themes, whose name and description come from the resource files by the
    /// <c>Theme.Name.{Id}</c> convention. Only organisation-owned themes carry a name here.
    /// </summary>
    public string Name { get; set; } = "";

    public int SortOrder { get; set; }

    public SlideTheme Definition { get; set; } = new();

    public DateTimeOffset ModifiedAt { get; set; }

    public bool IsBuiltIn => OrganizationId is null;
}
