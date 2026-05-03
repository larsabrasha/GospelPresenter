using System.Security.Cryptography;

namespace GospelPresenter.Shared.Models;

public class CalendarSubscription
{
    public const string TokenPrefix = "gpcal_";

    public string Id { get; set; } = Guid.NewGuid().ToString();
    public string TokenHash { get; set; } = "";
    public string Name { get; set; } = "";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? LastAccessedAt { get; set; }

    public string UserId { get; set; } = "";
    public User User { get; set; } = null!;

    public string OrganizationId { get; set; } = "";
    public Organization Organization { get; set; } = null!;

    public static string GenerateToken()
    {
        var bytes = new byte[32];
        using var rng = RandomNumberGenerator.Create();
        rng.GetBytes(bytes);
        var random = Convert.ToBase64String(bytes).Replace("+", "").Replace("/", "").Replace("=", "");
        return $"{TokenPrefix}{random}";
    }

    public static string HashToken(string token)
    {
        var hash = SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(token));
        return Convert.ToHexStringLower(hash);
    }
}
