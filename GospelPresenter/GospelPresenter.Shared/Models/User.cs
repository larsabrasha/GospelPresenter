namespace GospelPresenter.Shared.Models;

public class User
{
    public string Id { get; set; } = Guid.NewGuid().ToString();
    public string ExternalId { get; set; } = "";
    public string Name { get; set; } = "";

    public string OrganizationId { get; set; } = "";
    public Organization Organization { get; set; } = null!;
}
