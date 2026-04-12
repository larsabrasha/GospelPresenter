namespace GospelPresenter.Shared.Models;

public class RemoteDisplay
{
    public string Id { get; set; } = Guid.NewGuid().ToString();
    public string OrganizationId { get; set; } = "";
    public string DisplayIdentifier { get; set; } = "";
    public string Name { get; set; } = "";
    public DateTimeOffset CreatedAt { get; set; }

    public Organization Organization { get; set; } = null!;
}
