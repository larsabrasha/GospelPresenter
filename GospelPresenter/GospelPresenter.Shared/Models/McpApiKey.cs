namespace GospelPresenter.Shared.Models;

public class McpApiKey
{
    public string Id { get; set; } = Guid.NewGuid().ToString();
    public string Key { get; set; } = GenerateKey();
    public string Name { get; set; } = "";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public string UserId { get; set; } = "";
    public User User { get; set; } = null!;

    public string OrganizationId { get; set; } = "";
    public Organization Organization { get; set; } = null!;

    private static string GenerateKey()
    {
        var bytes = new byte[32];
        using var rng = System.Security.Cryptography.RandomNumberGenerator.Create();
        rng.GetBytes(bytes);
        return $"gp_{Convert.ToBase64String(bytes).Replace("+", "").Replace("/", "").Replace("=", "")}";
    }
}
