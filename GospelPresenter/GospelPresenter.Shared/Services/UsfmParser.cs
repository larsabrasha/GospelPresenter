using System.Text;
using USFMToolsSharp;
using USFMToolsSharp.Models.Markers;

namespace GospelPresenter.Shared.Services;

/// <summary>
/// Parses USFM files using USFMToolsSharp into the same BibleBook model used by UsxParser.
/// USFMToolsSharp can place markers outside CMarker when complex content (like \add blocks)
/// breaks the chapter nesting, so we traverse the entire document tree and track the current
/// chapter/verse by encountering CMarker and VMarker nodes at any depth.
/// </summary>
public static class UsfmParser
{
    private static readonly USFMParser Parser = new();

    public static BibleBook ParseBook(string usfmText)
    {
        var doc = Parser.ParseFromString(usfmText);

        var bookCode = doc.Contents.OfType<IDMarker>().FirstOrDefault()?.TextIdentifier?.Split(' ')[0] ?? "UNKNOWN";

        var chapters = new List<BibleChapter>();
        BibleChapter? currentChapter = null;
        BibleVerse? currentVerse = null;
        var buffer = new StringBuilder();

        Traverse(doc.Contents);
        FlushText();

        return new BibleBook(bookCode, chapters);

        void Traverse(List<Marker> markers)
        {
            foreach (var marker in markers)
            {
                switch (marker)
                {
                    case CMarker cm:
                        FlushText();
                        currentChapter = new BibleChapter(cm.Number);
                        chapters.Add(currentChapter);
                        currentVerse = null;
                        Traverse(cm.Contents);
                        break;

                    case VMarker vm when currentChapter is not null:
                        FlushText();
                        currentVerse = new BibleVerse(vm.StartingVerse);
                        currentChapter.AddVerse(currentVerse);
                        CollectText(vm.Contents, buffer);
                        break;

                    // Skip footnotes and cross-references
                    case FMarker:
                    case XMarker:
                        break;

                    // Skip headings and metadata
                    case SMarker or HMarker or MTMarker or TOC1Marker or TOC2Marker
                        or TOC3Marker or IDEMarker or REMMarker or RMarker:
                        break;

                    case TextBlock tb when currentVerse is not null:
                        UsxParser.AppendTrimmedText(tb.Text, buffer);
                        break;

                    default:
                        Traverse(marker.Contents);
                        break;
                }
            }
        }

        void FlushText()
        {
            if (currentVerse is null || buffer.Length <= 0) return;
            currentVerse.AppendText(buffer.ToString());
            buffer.Clear();
        }
    }

    private static void CollectText(List<Marker> markers, StringBuilder buffer)
    {
        foreach (var marker in markers)
        {
            switch (marker)
            {
                case TextBlock tb:
                    UsxParser.AppendTrimmedText(tb.Text, buffer);
                    break;

                case FMarker:
                case XMarker:
                    break;

                default:
                    CollectText(marker.Contents, buffer);
                    break;
            }
        }
    }

}
