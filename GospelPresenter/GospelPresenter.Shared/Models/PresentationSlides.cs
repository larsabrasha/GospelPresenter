namespace GospelPresenter.Shared.Models;

public class PresentationSlides
{
    public string Id { get; set; } = Guid.NewGuid().ToString();
    public string FileName { get; set; } = "";
    public int PageCount { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;

    public string PresentationId { get; set; } = "";
    public Presentation Presentation { get; set; } = null!;
}
