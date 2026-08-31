using System.ComponentModel.DataAnnotations;
using System.Security.Cryptography;

namespace GospelPresenter.Shared.Models;

/// <summary>
/// A long-lived credential for an installed app (the MAUI client). Issued once after an
/// interactive online login and stored on the device, it authenticates the sync API and the
/// media endpoints without a cookie session — the device may then stay offline indefinitely.
/// Unlike <see cref="McpApiKey"/>, whose callers are always machines acting as
/// <see cref="UserRole.User"/>, a device token acts as the user it belongs to with the role that
/// user has at the time of each request.
/// </summary>
public class DeviceToken
{
    public string Id { get; set; } = Guid.NewGuid().ToString();
    public string TokenHash { get; set; } = "";

    /// <summary>A device description the user can recognise when revoking, e.g. "MacBook Pro".</summary>
    public string Name { get; set; } = "";

    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? LastUsedAt { get; set; }

    /// <summary>
    /// The app version this device last presented, from the X-Client-Version header. Recorded so
    /// that raising the protocol floor is a decision made against a measured distribution of what
    /// is actually running, rather than against download counts — which say nothing about it.
    /// Null for a device that has not called since the header existed, or for a cookie session.
    ///
    /// Bounded because the value arrives in a request header and is therefore client-controlled:
    /// a semantic version with a prerelease suffix fits comfortably, and nothing legitimate does
    /// not. The handler truncates to the same length before writing.
    /// </summary>
    [MaxLength(MaxVersionLength)]
    public string? LastSeenVersion { get; set; }

    public const int MaxVersionLength = 32;

    /// <summary>The wire contract that version speaks. See <see cref="Sync.SyncProtocol"/>.</summary>
    public int? LastSeenProtocol { get; set; }

    /// <summary>Revoked tokens are kept for audit rather than deleted.</summary>
    public DateTimeOffset? RevokedAt { get; set; }

    public string UserId { get; set; } = "";
    public User User { get; set; } = null!;

    public string OrganizationId { get; set; } = "";
    public Organization Organization { get; set; } = null!;

    public const string Prefix = "gpdt_";

    public static string GenerateKey()
    {
        var bytes = new byte[32];
        using var rng = RandomNumberGenerator.Create();
        rng.GetBytes(bytes);
        return $"{Prefix}{Convert.ToBase64String(bytes).Replace("+", "").Replace("/", "").Replace("=", "")}";
    }

    public static string HashKey(string key)
    {
        var hash = SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(key));
        return Convert.ToHexStringLower(hash);
    }
}
