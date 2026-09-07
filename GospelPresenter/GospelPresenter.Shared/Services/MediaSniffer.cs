namespace GospelPresenter.Shared.Services;

/// <summary>
/// Reads a media type off the bytes themselves. A Content-Type header is whatever the sender said
/// it was, and a stored object is served back under the type it was stored with — so a type that
/// came from the request is a way to store HTML under an image key and have the app serve it from
/// its own origin. The web upload endpoints avoid that by decoding and re-encoding images; every
/// other path stores the bytes as they came, and derives the type here instead.
/// </summary>
public static class MediaSniffer
{
    /// <summary>The image type the bytes are, among the ones the app accepts, or null.</summary>
    public static string? DetectImageContentType(ReadOnlySpan<byte> data)
    {
        if (StartsWith(data, [0xFF, 0xD8, 0xFF])) return "image/jpeg";
        if (StartsWith(data, [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])) return "image/png";
        if (StartsWith(data, "GIF87a"u8) || StartsWith(data, "GIF89a"u8)) return "image/gif";
        if (StartsWith(data, "RIFF"u8) && data.Length >= 12 && data.Slice(8, 4).SequenceEqual("WEBP"u8)) return "image/webp";
        return null;
    }

    /// <summary>
    /// The audio type the bytes are, among the ones the app accepts, or null. Container formats are
    /// recognised by their leading bytes; MP3 by an ID3 tag or a raw frame sync.
    /// </summary>
    public static string? DetectAudioContentType(ReadOnlySpan<byte> data)
    {
        if (StartsWith(data, "ID3"u8)) return "audio/mpeg";
        if (data.Length >= 2 && data[0] == 0xFF && (data[1] & 0xE0) == 0xE0) return "audio/mpeg";
        if (StartsWith(data, "RIFF"u8) && data.Length >= 12 && data.Slice(8, 4).SequenceEqual("WAVE"u8)) return "audio/wav";
        if (StartsWith(data, "OggS"u8)) return "audio/ogg";
        if (data.Length >= 12 && data.Slice(4, 4).SequenceEqual("ftyp"u8)) return "audio/mp4";
        if (StartsWith(data, [0x1A, 0x45, 0xDF, 0xA3])) return "audio/webm";
        return null;
    }

    private static bool StartsWith(ReadOnlySpan<byte> data, ReadOnlySpan<byte> prefix) =>
        data.Length >= prefix.Length && data[..prefix.Length].SequenceEqual(prefix);
}
