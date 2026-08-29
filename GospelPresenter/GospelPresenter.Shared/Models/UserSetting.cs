namespace GospelPresenter.Shared.Models;

public class UserSetting : ISyncTracked
{
    public const string LastSelectedOrganizationId = "LastSelectedOrganizationId";
    public const string PreferredLanguage = "PreferredLanguage";

    public string Id { get; set; } = Guid.NewGuid().ToString();
    public string UserId { get; set; } = "";
    public User User { get; set; } = null!;
    public string Key { get; set; } = "";
    public string Value { get; set; } = "";
    public DateTimeOffset ModifiedAt { get; set; }

    public long Version { get; set; }
}
