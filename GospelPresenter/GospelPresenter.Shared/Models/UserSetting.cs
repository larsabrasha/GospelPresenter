namespace GospelPresenter.Shared.Models;

public class UserSetting
{
    public const string LastSelectedOrganizationId = "LastSelectedOrganizationId";

    public string Id { get; set; } = Guid.NewGuid().ToString();
    public string UserId { get; set; } = "";
    public User User { get; set; } = null!;
    public string Key { get; set; } = "";
    public string Value { get; set; } = "";
}
