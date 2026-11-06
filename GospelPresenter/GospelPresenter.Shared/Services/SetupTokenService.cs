using System.Security.Cryptography;
using System.Text;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace GospelPresenter.Shared.Services;

/// <summary>
/// Guards /setup, which creates the first super admin on an empty database. Without a guard the first
/// visitor to a fresh public deployment would own it, so /setup always asks for a token. It is the
/// configured <c>Setup:Token</c> (or <c>SETUP_TOKEN</c>) when there is one; otherwise a random token
/// is generated per process and written once to the log at Warning level, the way Jupyter prints its
/// login token, so a self-hoster with shell access to the logs can still finish setup.
/// </summary>
public sealed class SetupTokenService
{
    public const string ConfigurationKey = "Setup:Token";
    public const string EnvironmentVariable = "SETUP_TOKEN";

    // Only hashes are compared, so the comparison is fixed-length and constant-time and a candidate's
    // length reveals nothing about the expected token's.
    private readonly byte[] expectedHash;
    private readonly string? generatedToken;
    private readonly ILogger<SetupTokenService> logger;
    private int announced;

    public SetupTokenService(string? configuredToken, ILogger<SetupTokenService> logger)
    {
        this.logger = logger;
        var token = configuredToken?.Trim();
        if (string.IsNullOrEmpty(token))
        {
            generatedToken = Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(32));
            token = generatedToken;
        }
        expectedHash = Hash(token);
    }

    public bool IsGenerated => generatedToken is not null;

    /// <summary>The configured token, if any: <c>Setup:Token</c> wins over <c>SETUP_TOKEN</c>.</summary>
    public static string? ReadConfiguredToken(IConfiguration configuration)
    {
        var token = configuration[ConfigurationKey];
        return string.IsNullOrWhiteSpace(token) ? configuration[EnvironmentVariable] : token;
    }

    public bool Verify(string? candidate)
    {
        if (string.IsNullOrWhiteSpace(candidate))
            return false;

        var matches = CryptographicOperations.FixedTimeEquals(Hash(candidate.Trim()), expectedHash);
        if (!matches)
            logger.LogWarning("Rejected a /setup attempt with an invalid setup token");
        return matches;
    }

    /// <summary>
    /// Tells the operator how to finish setup. Called whenever setup is seen to be pending; only the
    /// first call logs. A generated token is the one secret this app ever logs: it is useless once the
    /// first user exists, and the log is where an operator without a configured token can find it.
    /// </summary>
    public void AnnounceSetupPending()
    {
        if (Interlocked.Exchange(ref announced, 1) == 1)
            return;

        if (generatedToken is not null)
        {
            logger.LogWarning(
                "Setup is pending and no {ConfigurationKey} is configured. Open /setup and enter this one-time setup token to create the first administrator: {SetupToken}",
                ConfigurationKey, generatedToken);
        }
        else
        {
            logger.LogInformation("Setup is pending. Open /setup and enter the configured setup token to create the first administrator");
        }
    }

    private static byte[] Hash(string value) => SHA256.HashData(Encoding.UTF8.GetBytes(value));
}
