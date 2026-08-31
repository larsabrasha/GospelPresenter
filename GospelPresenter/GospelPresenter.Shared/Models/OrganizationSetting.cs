namespace GospelPresenter.Shared.Models;

public class OrganizationSetting : ISyncTracked
{
    /// <summary>
    /// The theme presentations without one of their own are displayed with. Replaced the per-font
    /// slide settings; see adr/0001-slide-themes.md.
    /// </summary>
    public const string DefaultThemeId = "DefaultThemeId";

    public const string CcliCollectionEnabled = "CcliCollectionEnabled";

    public string Id { get; set; } = Guid.NewGuid().ToString();
    public string OrganizationId { get; set; } = "";
    public Organization Organization { get; set; } = null!;
    public string Key { get; set; } = "";
    public string Value { get; set; } = "";
    public DateTimeOffset ModifiedAt { get; set; }

    public long Version { get; set; }
}
