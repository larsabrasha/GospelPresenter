namespace GospelPresenter.Shared.Models;

public class Invite
{
    public string Id { get; set; } = Guid.NewGuid().ToString();
    public string Token { get; set; } = Guid.NewGuid().ToString();
    public string UserId { get; set; } = "";
    public User User { get; set; } = null!;
    public bool Used { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime ExpiresAt { get; set; } = DateTime.UtcNow.AddDays(7);

    public bool IsExpired => DateTime.UtcNow >= ExpiresAt;
}
