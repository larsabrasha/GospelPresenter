namespace GospelPresenter.Shared.Models;

public class DbSongPartLabel : ISyncTracked
{
    public string Id { get; set; } = Guid.NewGuid().ToString();
    public string Text { get; set; } = "";
    public string Color { get; set; } = "#6b7280";
    public int SortOrder { get; set; }
    public DateTimeOffset ModifiedAt { get; set; }

    public long Version { get; set; }

    public string OrganizationId { get; set; } = "";
    public Organization Organization { get; set; } = null!;
}
