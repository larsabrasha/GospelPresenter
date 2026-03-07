namespace GospelPresenter.Shared.Models;

public class Presentation
{
    public string Id { get; set; }
    public string Name { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public string CreatedBy { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
    public string UpdatedBy { get; set; }

    public string OrganizationId { get; set; } = "";
    public Organization Organization { get; set; } = null!;

    public List<PresentationItem> Items { get; set; } = [];
}
