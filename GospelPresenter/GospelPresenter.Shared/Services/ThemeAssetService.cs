using System.Reflection;
using System.Security.Cryptography;

namespace GospelPresenter.Shared.Services;

public interface IThemeAssetService
{
    /// <summary>The bytes shipped with the application for a built-in theme asset, or null if unknown.</summary>
    byte[]? ReadAsset(string assetPath);

    string? ComputeContentHash(string assetPath);
}

/// <summary>
/// Reads the built-in themes' background art. The files are embedded in this assembly rather than served
/// as static web assets so that every host can reach them the same way: the web app, the migration
/// service that uploads them to object storage, the screenshot tool and the tests. Object storage is the
/// delivery path; this is the source of truth.
/// </summary>
public class ThemeAssetService : IThemeAssetService
{
    private const string ResourcePrefix = "GospelPresenter.Shared.Themes.";

    public byte[]? ReadAsset(string assetPath)
    {
        var assembly = typeof(ThemeAssetService).Assembly;
        using var stream = assembly.GetManifestResourceStream(ResourceName(assetPath));
        if (stream is null) return null;

        using var buffer = new MemoryStream();
        stream.CopyTo(buffer);
        return buffer.ToArray();
    }

    public string? ComputeContentHash(string assetPath)
    {
        var bytes = ReadAsset(assetPath);
        return bytes is null ? null : Convert.ToHexString(SHA256.HashData(bytes))[..16].ToLowerInvariant();
    }

    /// <summary>
    /// Embedded resource names replace directory separators with dots, so "aurora/background" becomes
    /// "…Themes.aurora.background.webp".
    /// </summary>
    private static string ResourceName(string assetPath) =>
        ResourcePrefix + assetPath.Replace('/', '.') + ".webp";

    /// <summary>
    /// Recovers the asset path from a request URL such as "aurora/background-full-7bcf41fdc25328d2.webp".
    /// The variant and hash exist to make the URL immutable; the file that answers it is the same one.
    /// </summary>
    public static string? AssetPathFromRequest(string slug, string fileName)
    {
        if (slug.Contains('/') || slug.Contains('.') || fileName.Contains('/')) return null;

        var name = Path.GetFileNameWithoutExtension(fileName);
        var stem = name.Split('-')[0];

        return string.IsNullOrEmpty(stem) ? null : $"{slug}/{stem}";
    }
}
