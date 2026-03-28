namespace GospelPresenter.Shared.Models;

public class OrganizationAudio
{
    public string Id { get; set; } = Guid.NewGuid().ToString();
    public string FileName { get; set; } = "";
    public string ContentType { get; set; } = "audio/mpeg";
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;

    public string OrganizationId { get; set; } = "";
    public Organization Organization { get; set; } = null!;
}
