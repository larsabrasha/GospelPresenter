namespace GospelPresenter.Shared.Models;

public class OrganizationImage
{
    public string Id { get; set; } = Guid.NewGuid().ToString();
    public string FileName { get; set; } = "";
    public string ContentType { get; set; } = "image/jpeg";
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;

    public string OrganizationId { get; set; } = "";
    public Organization Organization { get; set; } = null!;
}
