namespace GospelPresenter.Shared.Models;

public class OverlaySlide
{
    public string Id { get; set; } = Guid.NewGuid().ToString();
    public string Title { get; set; } = "";
    public string? Content { get; set; }
    public byte[]? ImageData { get; set; }
    public int SortOrder { get; set; }

    public string OrganizationId { get; set; } = "";
    public Organization Organization { get; set; } = null!;
}
