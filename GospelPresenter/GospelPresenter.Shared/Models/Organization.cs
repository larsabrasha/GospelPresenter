namespace GospelPresenter.Shared.Models;

public class Organization
{
    public string Id { get; set; } = Guid.NewGuid().ToString();
    public string Name { get; set; } = "";

    public List<User> Users { get; set; } = [];
    public List<Presentation> Presentations { get; set; } = [];
}
