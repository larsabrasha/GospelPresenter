namespace GospelPresenter.Shared.Models;

public class OrganizationVideo
{
    public string Id { get; set; } = Guid.NewGuid().ToString();
    public string YoutubeVideoId { get; set; } = "";
    public string Title { get; set; } = "";
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;

    public string OrganizationId { get; set; } = "";
    public Organization Organization { get; set; } = null!;
}
