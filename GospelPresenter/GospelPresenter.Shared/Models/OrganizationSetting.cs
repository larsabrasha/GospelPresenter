namespace GospelPresenter.Shared.Models;

public class OrganizationSetting
{
    public const string SongFontSize = "SongFontSize";
    public const int DefaultSongFontSize = 85;

    public string Id { get; set; } = Guid.NewGuid().ToString();
    public string OrganizationId { get; set; } = "";
    public Organization Organization { get; set; } = null!;
    public string Key { get; set; } = "";
    public string Value { get; set; } = "";
}
