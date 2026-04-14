using System.Collections.Frozen;
using System.Text;
using System.Xml.Linq;

namespace GospelPresenter.Shared.Services;

/// <summary>
/// Parses USX 2.0 files (Unified Scripture XML) into a structured BibleBook model.
/// The USX format organizes text into chapters (<chapter>) and paragraphs (<para>),
/// where verse markers (<verse>) and text nodes are interleaved inside paragraphs.
/// </summary>
public static class UsxParser
{
    /// <summary>
    /// Paragraph styles that don't contain verse text, e.g. headings and metadata.
    /// All other styles (p, q1, q2, m, li1, ...) are assumed to contain verse content.
    /// </summary>
    private static readonly FrozenSet<string> NonContentStyles = ((string[])
    [
        // File metadata
        "ide",                  // Encoding identifier (e.g. UTF-8)
        "rem",                  // Remark/comment

        // Book headers
        "h",                    // Running header text
        "toc1", "toc2", "toc3", // Table of contents entries (long, short, abbreviation)
        "mt", "mt1", "mt2",     // Main title and subtitle

        // Section headings
        "s", "s1", "s2",       // Section headings (levels 1-2)
        "ms", "ms1", "ms2",    // Major section headings (levels 1-2)
        "mr",                   // Major section reference range
        "r",                    // Parallel passage reference
        "sp",                   // Speaker identification
        "cl",                   // Chapter label
        "cd",                   // Chapter description
    ]).ToFrozenSet();

    /// <summary>
    /// Parses a USX file and returns a BibleBook with chapters and verses.
    /// </summary>
    public static BibleBook ParseBook(string filePath)
    {
        var doc = XDocument.Load(filePath);
        return ParseBook(doc);
    }

    public static BibleBook ParseBook(XDocument doc)
    {
        // The book code (e.g. "MAT", "GEN") is an attribute on the <book> element
        var bookCode = doc.Root!.Element("book")?.Attribute("code")?.Value ?? "UNKNOWN";

        BibleChapter? currentChapter = null;
        BibleVerse? currentVerse = null;
        var verseBuffer = new StringBuilder();
        var chapters = new List<BibleChapter>();

        // Iterate over all top-level elements in the document (<chapter>, <para>, etc.)
        foreach (var element in doc.Root.Elements())
        {
            switch (element.Name.LocalName)
            {
                // <chapter number="1"/> marks the start of a new chapter
                case "chapter":
                {
                    // Save any buffered text to the previous verse before switching chapters
                    FlushText();

                    if (int.TryParse(element.Attribute("number")?.Value, out var cNum))
                    {
                        currentChapter = new BibleChapter(cNum);
                        chapters.Add(currentChapter);
                        currentVerse = null;
                    }
                    break;
                }

                // <para style="p"> contains verse markers and text.
                // Ignored if there's no active chapter (= metadata before the first chapter).
                case "para" when currentChapter is not null:
                {
                    // Skip headings and metadata paragraphs
                    if (NonContentStyles.Contains(element.Attribute("style")?.Value ?? ""))
                        continue;

                    // Each <para> can contain a mix of nodes:
                    //   <verse number="1"/>Text here<char style="qt">quote</char>more text
                    foreach (var node in element.Nodes())
                    {
                        switch (node)
                        {
                            // <verse number="3"/> marks the start of a new verse.
                            // Verse ranges like "3-4" are handled by taking the first number.
                            case XElement { Name.LocalName: "verse" } verseElem:
                                FlushText();
                                var vNumStr = verseElem.Attribute("number")?.Value?.Split('-')[0];
                                if (int.TryParse(vNumStr, out var vNum))
                                {
                                    currentVerse = new BibleVerse(vNum);
                                    currentChapter.AddVerse(currentVerse);
                                }
                                break;

                            // <note> elements are footnotes — exclude from verse text
                            case XElement { Name.LocalName: "note" }:
                                break;

                            // Other elements, e.g. <char style="qt"> (quotes) — extract text recursively
                            case XElement childElem:
                                AppendTextContent(childElem, verseBuffer);
                                break;

                            // Plain text directly inside the <para> element
                            case XText textNode:
                                AppendTrimmedText(textNode.Value, verseBuffer);
                                break;
                        }
                    }
                    break;
                }
            }
        }

        // Flush any remaining buffered text to the last verse
        FlushText();
        return new BibleBook(bookCode, chapters);

        // Flushes the text buffer into the active verse
        void FlushText()
        {
            if (currentVerse is null || verseBuffer.Length <= 0) return;
            currentVerse.AppendText(verseBuffer.ToString());
            verseBuffer.Clear();
        }
    }

    /// <summary>
    /// Recursively extracts text content from an element, skipping &lt;note&gt; elements (footnotes).
    /// Handles nested structures like &lt;char&gt;&lt;char&gt;text&lt;/char&gt;&lt;/char&gt;.
    /// </summary>
    private static void AppendTextContent(XElement element, StringBuilder buffer)
    {
        foreach (var node in element.Nodes())
        {
            switch (node)
            {
                case XElement { Name.LocalName: "note" }:
                    break;
                case XElement child:
                    AppendTextContent(child, buffer);
                    break;
                case XText textNode:
                    AppendTrimmedText(textNode.Value, buffer);
                    break;
            }
        }
    }

    private static void AppendTrimmedText(string value, StringBuilder buffer)
    {
        var text = value.Replace("\n", " ").Trim();
        if (text.Length > 0)
            buffer.Append(text).Append(' ');
    }
}

public record BibleBook(string Code, IReadOnlyList<BibleChapter> Chapters);

public class BibleChapter(int number)
{
    private readonly List<BibleVerse> verses = [];

    public int Number { get; } = number;
    public IReadOnlyList<BibleVerse> Verses => verses;

    internal void AddVerse(BibleVerse verse) => verses.Add(verse);
}

public class BibleVerse(int number)
{
    public int Number { get; } = number;
    public string Text { get; private set; } = string.Empty;

    internal void AppendText(string text)
    {
        Text = string.IsNullOrEmpty(Text) ? text.Trim() : $"{Text} {text.Trim()}";
    }
}
