namespace GospelPresenter.Shared.Models;

public class PresentationItemPart : ISyncTracked
{
    public string Id { get; set; } = Guid.NewGuid().ToString();
    public string Content { get; set; } = "";
    public int SortOrder { get; set; }
    public DateTimeOffset ModifiedAt { get; set; }

    public long Version { get; set; }

    public string PresentationItemId { get; set; } = "";
    public PresentationItem PresentationItem { get; set; } = null!;
}
