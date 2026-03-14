using System.Xml.Linq;
using Microsoft.Extensions.Logging;

namespace GospelPresenter.Shared.Services;

public record Bible(string Id, string Name, IReadOnlyList<Verse> Verses);

public interface IBibleService
{
    IReadOnlyList<Bible> Bibles { get; }
    IEnumerable<Verse> Search(string bibleId, string query);
    IReadOnlyList<string> GetBooks(string bibleId);
    IReadOnlyList<int> GetChapters(string bibleId, string bookId);
    IReadOnlyList<Verse> GetVerses(string bibleId, string bookId, int chapter);
    void LoadBibles(string biblesPath);
}

public class BibleService(ILogger<BibleService> logger) : IBibleService
{
    private readonly Dictionary<string, Bible> bibles = new();

    public IReadOnlyList<Bible> Bibles => bibles.Values.ToList();

    public void LoadBibles(string biblesPath)
    {
        if (!Directory.Exists(biblesPath))
        {
            logger.LogWarning("Bibles path does not exist: {Path}", biblesPath);
            return;
        }

        foreach (var dir in Directory.GetDirectories(biblesPath))
        {
            var (id, name) = ReadBibleMetadata(dir);
            var usxFolder = FindUsxFolder(dir);

            if (usxFolder is null)
            {
                logger.LogWarning("No USX folder found in {Dir}", dir);
                continue;
            }

            var verses = Directory.GetFiles(usxFolder, "*.usx")
                .Select(UsxParser.ParseBook)
                .SelectMany(book => book.Chapters.SelectMany(chapter =>
                    chapter.Verses.Select(verse => new Verse(
                        book.Code,
                        chapter.Number,
                        verse.Number,
                        verse.Text))))
                .ToList();

            bibles[id] = new Bible(id, name, verses);
            logger.LogInformation("Loaded bible {Name} ({Id}) with {Count} verses", name, id, verses.Count);
        }
    }

    public IEnumerable<Verse> Search(string bibleId, string query)
    {
        return bibles.TryGetValue(bibleId, out var bible)
            ? VerseSearch.Search(bible.Verses, query)
            : [];
    }

    public IReadOnlyList<string> GetBooks(string bibleId)
    {
        return bibles.TryGetValue(bibleId, out var bible)
            ? bible.Verses.Select(v => v.BookId).Distinct().OrderBy(BibleBookNames.GetOrder).ToList()
            : [];
    }

    public IReadOnlyList<int> GetChapters(string bibleId, string bookId)
    {
        return bibles.TryGetValue(bibleId, out var bible)
            ? bible.Verses.Where(v => v.BookId == bookId).Select(v => v.Chapter).Distinct().OrderBy(c => c).ToList()
            : [];
    }

    public IReadOnlyList<Verse> GetVerses(string bibleId, string bookId, int chapter)
    {
        return bibles.TryGetValue(bibleId, out var bible)
            ? bible.Verses.Where(v => v.BookId == bookId && v.Chapter == chapter).OrderBy(v => v.VerseNumber).ToList()
            : [];
    }

    private static string? FindUsxFolder(string bibleDir)
    {
        // Prefer USX_1 (canonical books without deuterocanonical)
        var usx1 = Path.Combine(bibleDir, "USX_1");
        if (Directory.Exists(usx1))
            return usx1;

        var usx2 = Path.Combine(bibleDir, "USX_2");
        return Directory.Exists(usx2) ? usx2 : null;
    }

    private static (string Id, string Name) ReadBibleMetadata(string bibleDir)
    {
        var metadataPath = Path.Combine(bibleDir, "metadata.xml");
        var dirName = Path.GetFileName(bibleDir);

        if (!File.Exists(metadataPath))
            return (dirName, dirName);

        var doc = XDocument.Load(metadataPath);
        var ns = doc.Root?.Name.Namespace ?? XNamespace.None;
        var identification = doc.Root?.Element(ns + "identification");

        var name = identification?.Element(ns + "nameLocal")?.Value
                   ?? identification?.Element(ns + "name")?.Value
                   ?? dirName;

        var abbreviation = identification?.Element(ns + "abbreviationLocal")?.Value
                           ?? identification?.Element(ns + "abbreviation")?.Value
                           ?? dirName;

        return (abbreviation, name);
    }
}
