using System.ComponentModel;
using System.Text.Json;
using GospelPresenter.Shared.Services;
using ModelContextProtocol.Server;

namespace GospelPresenter.Web.Mcp;

[McpServerToolType]
public sealed class BibleTools(IBibleService bibleService, McpCallerContextAccessor mcp)
{
    private string OrgId => mcp.OrganizationId!;

    [McpServerTool(Name = "list_bibles"), Description("List all available Bible translations")]
    public string ListBibles()
    {
        return JsonSerializer.Serialize(bibleService.GetBibles(OrgId).Select(b => new
        {
            b.Id,
            b.Name
        }));
    }

    [McpServerTool(Name = "get_bible_books"), Description("List all books in a Bible translation")]
    public string GetBibleBooks(string bibleId)
    {
        var books = bibleService.GetBooks(OrgId, bibleId);
        return JsonSerializer.Serialize(books);
    }

    [McpServerTool(Name = "get_bible_chapters"), Description("Get the number of chapters in a Bible book")]
    public string GetBibleChapters(string bibleId, string bookId)
    {
        var chapters = bibleService.GetChapters(OrgId, bibleId, bookId);
        return JsonSerializer.Serialize(chapters);
    }

    [McpServerTool(Name = "get_bible_verses"), Description("Get all verses in a specific chapter")]
    public string GetBibleVerses(string bibleId, string bookId, int chapter)
    {
        var verses = bibleService.GetVerses(OrgId, bibleId, bookId, chapter);
        return JsonSerializer.Serialize(verses.Select(v => new
        {
            v.VerseNumber,
            v.Text
        }));
    }

    [McpServerTool(Name = "search_bible"), Description("Search for Bible verses matching a query")]
    public string SearchBible(string bibleId, string query)
    {
        var results = bibleService.Search(OrgId, bibleId, query).Take(50);
        return JsonSerializer.Serialize(results.Select(v => new
        {
            v.BookId,
            v.Chapter,
            v.VerseNumber,
            v.Text
        }));
    }
}
