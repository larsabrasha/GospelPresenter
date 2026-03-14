namespace GospelPresenter.Shared.Models;

public class User
{
    public string Id { get; set; } = Guid.NewGuid().ToString();
    public string Name { get; set; } = "";
    public string Email { get; set; } = "";
    public string? ProfileImage { get; set; }
    public string? ProfileImageSmall { get; set; }
    public bool ProfileImageRemoved { get; set; }
    public UserRole Role { get; set; } = UserRole.User;

    public string? OrganizationId { get; set; }
    public Organization? Organization { get; set; }

    public List<UserLogin> Logins { get; set; } = [];
}
