using System.Text;
using System.Text.RegularExpressions;
using GospelPresenter.Shared.State;

namespace GospelPresenter.Shared.Services;

/// <summary>
/// Parses ProPresenter 7 (.pro) files which use a protobuf-based binary format.
/// Extracts song title, metadata (author, publisher, CCLI), and slide text from RTF.
/// </summary>
public static partial class ProPresenterParser
{
    public static Song? ParseFile(string filePath)
    {
        try
        {
            var data = File.ReadAllBytes(filePath);
            return Parse(data, filePath);
        }
        catch
        {
            return null;
        }
    }

    private static Song? Parse(byte[] data, string filePath)
    {
        var title = "";
        string? author = null;
        string? publisher = null;
        int? ccli = null;
        var parts = new List<string>();

        // Parse top-level fields
        var pos = 0;
        while (pos < data.Length)
        {
            if (!TryDecodeVarint(data, ref pos, out var tagVal)) break;
            var field = (int)(tagVal >> 3);
            var wire = (int)(tagVal & 0x7);

            switch (wire)
            {
                case 0: // varint
                    TryDecodeVarint(data, ref pos, out _);
                    break;
                case 2: // length-delimited
                {
                    if (!TryDecodeVarint(data, ref pos, out var length)) goto done;
                    var len = (int)length;
                    if (pos + len > data.Length) goto done;
                    var chunk = data.AsSpan(pos, len);

                    if (field == 3)
                    {
                        title = Encoding.UTF8.GetString(chunk);
                    }
                    else if (field == 13)
                    {
                        // Slide — extract RTF text
                        var rtfs = new List<string>();
                        ExtractRtfStrings(chunk.ToArray(), rtfs);
                        foreach (var rtf in rtfs)
                        {
                            var plain = RtfToPlainText(rtf);
                            if (!string.IsNullOrWhiteSpace(plain))
                                parts.Add(plain);
                        }
                    }
                    else if (field == 14)
                    {
                        // Metadata
                        ParseMetadata(chunk.ToArray(), out author, out publisher, out ccli);
                    }

                    pos += len;
                    break;
                }
                case 5: // 32-bit
                    pos += 4;
                    break;
                case 1: // 64-bit
                    pos += 8;
                    break;
                default:
                    goto done;
            }
        }
        done:

        if (string.IsNullOrWhiteSpace(title))
            title = Path.GetFileNameWithoutExtension(filePath);

        if (parts.Count == 0) return null;

        var id = Guid.NewGuid().ToString();
        return new Song(id, title, author, publisher, null, ccli?.ToString(), parts);
    }

    private static void ParseMetadata(byte[] data, out string? author, out string? publisher, out int? ccli)
    {
        author = null;
        publisher = null;
        ccli = null;

        var pos = 0;
        while (pos < data.Length)
        {
            if (!TryDecodeVarint(data, ref pos, out var tagVal)) break;
            var field = (int)(tagVal >> 3);
            var wire = (int)(tagVal & 0x7);

            switch (wire)
            {
                case 0:
                {
                    TryDecodeVarint(data, ref pos, out var val);
                    if (field == 6) ccli = (int)val;
                    break;
                }
                case 2:
                {
                    if (!TryDecodeVarint(data, ref pos, out var length)) return;
                    var len = (int)length;
                    if (pos + len > data.Length) return;
                    try
                    {
                        var s = Encoding.UTF8.GetString(data, pos, len);
                        if (field == 1) author = string.IsNullOrWhiteSpace(s) ? null : s;
                        else if (field == 4) publisher = string.IsNullOrWhiteSpace(s) ? null : s;
                    }
                    catch { /* ignore */ }
                    pos += len;
                    break;
                }
                case 5:
                    pos += 4;
                    break;
                case 1:
                    pos += 8;
                    break;
                default:
                    return;
            }
        }
    }

    private static void ExtractRtfStrings(byte[] data, List<string> results)
    {
        var pos = 0;
        while (pos < data.Length)
        {
            if (!TryDecodeVarint(data, ref pos, out var tagVal)) break;
            var wire = (int)(tagVal & 0x7);

            switch (wire)
            {
                case 0:
                    TryDecodeVarint(data, ref pos, out _);
                    break;
                case 2:
                {
                    if (!TryDecodeVarint(data, ref pos, out var length)) return;
                    var len = (int)length;
                    if (pos + len > data.Length) return;
                    var chunk = data.AsSpan(pos, len).ToArray();
                    pos += len;

                    try
                    {
                        var s = Encoding.UTF8.GetString(chunk);
                        if (s.StartsWith("{\\rtf"))
                            results.Add(s);
                        else
                            ExtractRtfStrings(chunk, results);
                    }
                    catch
                    {
                        ExtractRtfStrings(chunk, results);
                    }
                    break;
                }
                case 5:
                    pos += 4;
                    break;
                case 1:
                    pos += 8;
                    break;
                default:
                    return;
            }
        }
    }

    private static string RtfToPlainText(string rtf)
    {
        // Decode \' hex escapes (Windows-1252)
        var text = HexEscapeRegex().Replace(rtf, m =>
        {
            var b = Convert.ToByte(m.Groups[1].Value, 16);
            return Encoding.GetEncoding(1252).GetString([b]);
        });

        // Find content after \pard line
        var lines = text.Split('\n');
        var sb = new StringBuilder();
        var foundPard = false;

        foreach (var line in lines)
        {
            if (line.Contains("\\pard"))
            {
                foundPard = true;
                continue;
            }
            if (foundPard)
                sb.AppendLine(line);
        }

        text = sb.ToString();

        // Remove RTF control words
        text = ControlWordRegex().Replace(text, "");

        // Remove braces
        text = text.Replace("{", "").Replace("}", "");

        // RTF line continuation (backslash at end of line)
        text = RtfNewlineRegex().Replace(text, "\n");

        return text.Trim();
    }

    private static bool TryDecodeVarint(byte[] data, ref int pos, out ulong result)
    {
        result = 0;
        var shift = 0;
        while (pos < data.Length)
        {
            var b = data[pos++];
            result |= (ulong)(b & 0x7f) << shift;
            if ((b & 0x80) == 0) return true;
            shift += 7;
            if (shift >= 64) break;
        }
        return false;
    }

    [GeneratedRegex(@"\\'([0-9a-fA-F]{2})")]
    private static partial Regex HexEscapeRegex();

    [GeneratedRegex(@"\\[a-z]+[0-9]*\s?")]
    private static partial Regex ControlWordRegex();

    [GeneratedRegex(@"\\\r?\n")]
    private static partial Regex RtfNewlineRegex();
}
