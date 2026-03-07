namespace GospelPresenter.Shared.Models;

public class PresentationItemPart
{
    public string Id { get; set; } = Guid.NewGuid().ToString();
    public string Content { get; set; } = "";
    public int SortOrder { get; set; }

    public string PresentationItemId { get; set; } = "";
    public PresentationItem PresentationItem { get; set; } = null!;
}
