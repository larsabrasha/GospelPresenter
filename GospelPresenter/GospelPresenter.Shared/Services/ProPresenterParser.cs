using System.Text;
using System.Text.RegularExpressions;
using GospelPresenter.Shared.Proto;
using GospelPresenter.Shared.State;
using Google.Protobuf;

namespace GospelPresenter.Shared.Services;

/// <summary>
/// Parses ProPresenter 7 (.pro) files using the protobuf schema.
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
        var presentation = Presentation.Parser.ParseFrom(data);

        var title = presentation.Name;
        if (string.IsNullOrWhiteSpace(title))
            title = Path.GetFileNameWithoutExtension(filePath);

        string? author = null;
        string? publisher = null;
        int? ccli = null;

        if (presentation.Ccli is { } ccliData)
        {
            author = string.IsNullOrWhiteSpace(ccliData.Author) ? null : ccliData.Author;
            publisher = string.IsNullOrWhiteSpace(ccliData.Publisher) ? null : ccliData.Publisher;
            if (ccliData.SongNumber != 0) ccli = (int)ccliData.SongNumber;
        }

        var parts = new List<string>();
        foreach (var cue in presentation.Cues)
        {
            foreach (var action in cue.Actions)
            {
                var slide = action.Slide?.Presentation?.BaseSlide;
                if (slide is null) continue;

                foreach (var element in slide.Elements)
                {
                    var rtfData = element.Element_?.Text?.RtfData;
                    if (rtfData is null || rtfData.IsEmpty) continue;

                    var rtf = Encoding.UTF8.GetString(rtfData.Span);
                    if (!rtf.StartsWith("{\\rtf")) continue;

                    var plain = RtfToPlainText(rtf);
                    if (!string.IsNullOrWhiteSpace(plain))
                        parts.Add(plain);
                }
            }
        }

        if (parts.Count == 0) return null;

        var id = Path.GetFileNameWithoutExtension(filePath);
        return new Song(id, title, author, publisher, null, ccli?.ToString(), parts);
    }

    private static readonly Encoding Windows1252 = InitWindows1252();

    private static Encoding InitWindows1252()
    {
        Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);
        return Encoding.GetEncoding(1252);
    }

    private static string RtfToPlainText(string rtf)
    {
        // Decode \' hex escapes (Windows-1252)
        var text = HexEscapeRegex().Replace(rtf, m =>
        {
            var b = Convert.ToByte(m.Groups[1].Value, 16);
            return Windows1252.GetString([b]);
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

    [GeneratedRegex(@"\\'([0-9a-fA-F]{2})")]
    private static partial Regex HexEscapeRegex();

    [GeneratedRegex(@"\\[a-z]+[0-9]*\s?")]
    private static partial Regex ControlWordRegex();

    [GeneratedRegex(@"\\\r?\n")]
    private static partial Regex RtfNewlineRegex();
}
