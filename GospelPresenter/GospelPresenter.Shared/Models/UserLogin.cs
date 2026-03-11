namespace GospelPresenter.Shared.Models;

public class UserLogin
{
    public string Id { get; set; } = Guid.NewGuid().ToString();
    public string Provider { get; set; } = "";
    public string ProviderSubjectId { get; set; } = "";

    public string UserId { get; set; } = "";
    public User User { get; set; } = null!;
}
