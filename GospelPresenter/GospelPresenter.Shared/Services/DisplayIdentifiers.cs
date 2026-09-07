using System.Security.Cryptography;

namespace GospelPresenter.Shared.Services;

/// <summary>
/// The public code in an output's watch URL. Shared between the service that mints one and the sync
/// engine, which has to mint a replacement when a device invented a code the server already issued.
/// </summary>
public static class DisplayIdentifiers
{
    // 31 unambiguous characters: a-z without i/l/o (they look like 1/0) plus 2-9.
    // Length 7 → 31^7 ≈ 27.5 billion combinations, which is short enough to type
    // and large enough that guessing IDs across organizations is impractical.
    // Note that nothing rate-limits /watch/{code}, so this count is the only thing
    // making enumeration impractical.
    private const string Alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
    private const int Length = 7;

    /// <summary>How many times a caller retries after a unique-index collision before giving up.</summary>
    public const int MaxRetries = 8;

    /// <summary>
    /// What a caller throws when <see cref="MaxRetries"/> codes in a row were all taken. Shared so
    /// the three retry loops — two in the service, one in the sync engine — cannot drift into
    /// telling three different stories about the same thing.
    /// </summary>
    public static InvalidOperationException Exhausted() =>
        new($"Failed to generate a unique display ID after {MaxRetries} attempts.");

    public static string Generate() => GenerateCode(Length);

    /// <summary>A code of the given length from the same alphabet; the pairing codes use this.</summary>
    public static string GenerateCode(int length)
    {
        Span<char> buffer = stackalloc char[length];
        for (var i = 0; i < length; i++)
            buffer[i] = Alphabet[RandomNumberGenerator.GetInt32(Alphabet.Length)];
        return new string(buffer);
    }

    /// <summary>Whether a character can occur in a code — used by the pairing inputs to filter typing.</summary>
    public static bool IsCodeCharacter(char c) => Alphabet.Contains(char.ToLowerInvariant(c));
}
