namespace GospelPresenter.Shared.Models;

public class PresentationItem : ISyncTracked
{
    public string Id { get; set; } = Guid.NewGuid().ToString();
    public string? SourceId { get; set; }
    public PresentationItemType Type { get; set; }
    public string Title { get; set; } = "";
    public string? ArrangementId { get; set; }
    public int SortOrder { get; set; }
    public DateTimeOffset ModifiedAt { get; set; }

    public long Version { get; set; }

    public string PresentationId { get; set; } = "";
    public Presentation Presentation { get; set; } = null!;

    public List<PresentationItemPart> Parts { get; set; } = [];
}

public enum PresentationItemType
{
    Song,
    BibleText,
    Image,
    Audio,
    Slides
}
