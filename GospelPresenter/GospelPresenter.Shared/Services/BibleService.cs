using System.IO.Compression;
using System.Text.Json;
using System.Xml.Linq;
using GospelPresenter.Shared.Contexts;
using GospelPresenter.Shared.Models;
using GospelPresenter.Shared.Utils;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace GospelPresenter.Shared.Services;

public record Bible(string Id, string Name, IReadOnlyList<Verse> Verses);

public record ImportBibleResult(string BibleName, int VerseCount, bool Replaced);

public interface IBibleService
{
    IReadOnlyList<Bible> GetBibles(string organizationId);
    IEnumerable<Verse> Search(string organizationId, string bibleId, string query);
    IReadOnlyList<string> GetBooks(string organizationId, string bibleId);
    IReadOnlyList<int> GetChapters(string organizationId, string bibleId, string bookId);
    IReadOnlyList<Verse> GetVerses(string organizationId, string bibleId, string bookId, int chapter);
    Task LoadBiblesAsync();
    Task<ImportBibleResult> ImportBibleAsync(Stream zipStream, string organizationId, CallerContext caller);
    Task DeleteBibleAsync(string bibleId, string organizationId, CallerContext caller);
}

public class BibleService(IDbContextFactory<PresentationContext> dbContextFactory, ILogger<BibleService> logger) : IBibleService
{
    private Dictionary<string, Dictionary<string, Bible>> cacheByOrg = new();

    private void UpdateOrgCache(string organizationId, Action<Dictionary<string, Bible>> mutator)
    {
        var newCache = new Dictionary<string, Dictionary<string, Bible>>(cacheByOrg);
        var orgCache = newCache.TryGetValue(organizationId, out var existing)
            ? new Dictionary<string, Bible>(existing)
            : new Dictionary<string, Bible>();
        mutator(orgCache);
        newCache[organizationId] = orgCache;
        Interlocked.Exchange(ref cacheByOrg, newCache);
    }

    public IReadOnlyList<Bible> GetBibles(string organizationId)
    {
        var snapshot = cacheByOrg;
        return snapshot.TryGetValue(organizationId, out var cache)
            ? cache.Values.ToList()
            : [];
    }

    public async Task LoadBiblesAsync()
    {
        await using var db = await dbContextFactory.CreateDbContextAsync();

        var dbBibles = await db.Bibles
            .AsNoTracking()
            .ToListAsync();

        var newCache = new Dictionary<string, Dictionary<string, Bible>>();
        foreach (var dbBible in dbBibles)
        {
            var verses = JsonSerializer.Deserialize<List<Verse>>(dbBible.VersesJson) ?? [];
            var bible = new Bible(dbBible.Abbreviation, dbBible.Name, verses);

            if (!newCache.TryGetValue(dbBible.OrganizationId, out var orgCache))
            {
                orgCache = new Dictionary<string, Bible>();
                newCache[dbBible.OrganizationId] = orgCache;
            }
            orgCache[bible.Id] = bible;

            logger.LogInformation("Loaded bible {Name} ({Id}) with {Count} verses for org {OrgId}",
                bible.Name, bible.Id, verses.Count, dbBible.OrganizationId);
        }

        Interlocked.Exchange(ref cacheByOrg, newCache);
    }

    public async Task<ImportBibleResult> ImportBibleAsync(Stream zipStream, string organizationId, CallerContext caller)
    {
        caller.RequirePermission(Permission.ManageBibles);
        caller.RequireOrganizationAccess(organizationId);

        var (abbreviation, name, verses) = ParseZip(zipStream);

        abbreviation = ValidationHelper.Truncate(abbreviation, AppConstraints.BibleAbbreviationMaxLength) ?? "UNKNOWN";
        name = ValidationHelper.Truncate(name, AppConstraints.NameMaxLength) ?? "Unknown Bible";

        await using var db = await dbContextFactory.CreateDbContextAsync();

        var existingId = await db.Bibles
            .Where(b => b.OrganizationId == organizationId && b.Abbreviation == abbreviation)
            .Select(b => b.Id)
            .FirstOrDefaultAsync();

        bool replaced = false;
        if (existingId is not null)
        {
            await db.Bibles
                .Where(b => b.Id == existingId)
                .ExecuteUpdateAsync(s => s
                    .SetProperty(b => b.Name, name)
                    .SetProperty(b => b.VersesJson, JsonSerializer.Serialize(verses))
                    .SetProperty(b => b.VerseCount, verses.Count));
            replaced = true;
        }
        else
        {
            await ValidationHelper.RequireMaxCountAsync(
                db.Bibles.Where(b => b.OrganizationId == organizationId),
                AppConstraints.MaxBiblesPerOrg, "Bibles");

            db.Bibles.Add(new DbBible
            {
                Name = name,
                Abbreviation = abbreviation,
                VersesJson = JsonSerializer.Serialize(verses),
                VerseCount = verses.Count,
                OrganizationId = organizationId
            });
            await db.SaveChangesAsync();
        }

        var bible = new Bible(abbreviation, name, verses);
        UpdateOrgCache(organizationId, orgCache => orgCache[bible.Id] = bible);

        logger.LogInformation("Imported bible {Name} ({Abbreviation}) with {Count} verses for org {OrgId}",
            name, abbreviation, verses.Count, organizationId);

        return new ImportBibleResult(name, verses.Count, replaced);
    }

    public async Task DeleteBibleAsync(string abbreviation, string organizationId, CallerContext caller)
    {
        caller.RequirePermission(Permission.ManageBibles);
        caller.RequireOrganizationAccess(organizationId);

        await using var db = await dbContextFactory.CreateDbContextAsync();
        var deleted = await db.Bibles
            .Where(b => b.Abbreviation == abbreviation && b.OrganizationId == organizationId)
            .ExecuteDeleteAsync();

        if (deleted == 0) return;

        UpdateOrgCache(organizationId, orgCache => orgCache.Remove(abbreviation));

        logger.LogInformation("Deleted bible ({Abbreviation}) from org {OrgId}", abbreviation, organizationId);
    }

    public IEnumerable<Verse> Search(string organizationId, string bibleId, string query)
    {
        return FindBible(organizationId, bibleId) is { } bible
            ? VerseSearch.Search(bible.Verses, query)
            : [];
    }

    public IReadOnlyList<string> GetBooks(string organizationId, string bibleId)
    {
        return FindBible(organizationId, bibleId) is { } bible
            ? bible.Verses.Select(v => v.BookId).Distinct().OrderBy(BibleBookNames.GetOrder).ToList()
            : [];
    }

    public IReadOnlyList<int> GetChapters(string organizationId, string bibleId, string bookId)
    {
        return FindBible(organizationId, bibleId) is { } bible
            ? bible.Verses.Where(v => v.BookId == bookId).Select(v => v.Chapter).Distinct().OrderBy(c => c).ToList()
            : [];
    }

    public IReadOnlyList<Verse> GetVerses(string organizationId, string bibleId, string bookId, int chapter)
    {
        return FindBible(organizationId, bibleId) is { } bible
            ? bible.Verses.Where(v => v.BookId == bookId && v.Chapter == chapter).OrderBy(v => v.VerseNumber).ToList()
            : [];
    }

    private Bible? FindBible(string organizationId, string bibleId)
    {
        var snapshot = cacheByOrg;
        return snapshot.TryGetValue(organizationId, out var orgCache)
            ? orgCache.GetValueOrDefault(bibleId)
            : null;
    }

    private static (string Abbreviation, string Name, List<Verse> Verses) ParseZip(Stream zipStream)
    {
        using var archive = new ZipArchive(zipStream, ZipArchiveMode.Read);

        var prefix = FindRootPrefix(archive);

        var (abbreviation, name) = ReadBibleMetadata(archive, prefix);
        var usxPrefix = FindUsxPrefix(archive, prefix);

        if (usxPrefix is null)
            throw new InvalidOperationException("No USX folder found in the zip file.");

        var verses = archive.Entries
            .Where(e => e.FullName.StartsWith(usxPrefix, StringComparison.OrdinalIgnoreCase)
                        && e.Name.EndsWith(".usx", StringComparison.OrdinalIgnoreCase)
                        && e.Length > 0)
            .Select(e =>
            {
                using var stream = e.Open();
                var doc = XDocument.Load(stream);
                return UsxParser.ParseBook(doc);
            })
            .SelectMany(book => book.Chapters.SelectMany(chapter =>
                chapter.Verses.Select(verse => new Verse(
                    book.Code,
                    chapter.Number,
                    verse.Number,
                    verse.Text))))
            .ToList();

        return (abbreviation, name, verses);
    }

    private static string FindRootPrefix(ZipArchive archive)
    {
        var metadataEntry = archive.Entries.FirstOrDefault(e =>
            e.Name.Equals("metadata.xml", StringComparison.OrdinalIgnoreCase));

        if (metadataEntry is null)
            return "";

        var dir = Path.GetDirectoryName(metadataEntry.FullName)?.Replace('\\', '/') ?? "";
        return dir.Length > 0 ? dir + "/" : "";
    }

    private static (string Abbreviation, string Name) ReadBibleMetadata(ZipArchive archive, string prefix)
    {
        var metadataEntry = archive.GetEntry(prefix + "metadata.xml");
        if (metadataEntry is null)
            return ("unknown", "Unknown Bible");

        using var stream = metadataEntry.Open();
        var doc = XDocument.Load(stream);
        var ns = doc.Root?.Name.Namespace ?? XNamespace.None;
        var identification = doc.Root?.Element(ns + "identification");

        var name = identification?.Element(ns + "nameLocal")?.Value
                   ?? identification?.Element(ns + "name")?.Value
                   ?? "Unknown Bible";

        var abbreviation = identification?.Element(ns + "abbreviationLocal")?.Value
                           ?? identification?.Element(ns + "abbreviation")?.Value
                           ?? "UNKNOWN";

        return (abbreviation, name);
    }

    private static string? FindUsxPrefix(ZipArchive archive, string prefix)
    {
        var usx1 = prefix + "USX_1/";
        if (archive.Entries.Any(e => e.FullName.StartsWith(usx1, StringComparison.OrdinalIgnoreCase)))
            return usx1;

        var usx2 = prefix + "USX_2/";
        return archive.Entries.Any(e => e.FullName.StartsWith(usx2, StringComparison.OrdinalIgnoreCase))
            ? usx2
            : null;
    }
}
