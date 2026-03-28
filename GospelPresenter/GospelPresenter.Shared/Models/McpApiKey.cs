using System.Security.Cryptography;

namespace GospelPresenter.Shared.Models;

public class McpApiKey
{
    public string Id { get; set; } = Guid.NewGuid().ToString();
    public string KeyHash { get; set; } = "";
    public string Name { get; set; } = "";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public string UserId { get; set; } = "";
    public User User { get; set; } = null!;

    public string OrganizationId { get; set; } = "";
    public Organization Organization { get; set; } = null!;

    public static string GenerateKey()
    {
        var bytes = new byte[32];
        using var rng = RandomNumberGenerator.Create();
        rng.GetBytes(bytes);
        return $"gp_{Convert.ToBase64String(bytes).Replace("+", "").Replace("/", "").Replace("=", "")}";
    }

    public static string HashKey(string key)
    {
        var hash = SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(key));
        return Convert.ToHexStringLower(hash);
    }
}
