using System.ComponentModel;
using System.Text.Json;
using GospelPresenter.Shared.Models;
using GospelPresenter.Shared.Services;
using GospelPresenter.Shared.State;
using ModelContextProtocol.Server;

namespace GospelPresenter.Web.Mcp;

[McpServerToolType]
public sealed class PresentationTools(
    IPresentationService presentationService,
    ISongService songService,
    IBibleService bibleService,
    IBibleTextService bibleTextService,
    McpCallerContextAccessor mcp,
    SharedAppState sharedAppState)
{
    private CallerContext Caller => mcp.Caller!;
    private string OrgId => mcp.OrganizationId!;

    [McpServerTool(Name = "list_presentations"), Description("List all presentations in the organization")]
    public async Task<string> ListPresentations()
    {
        var presentations = await presentationService.GetRecentPresentationSummariesAsync(OrgId, Caller);
        return JsonSerializer.Serialize(presentations.Select(p => new
        {
            p.Id,
            p.Name,
            Date = p.Date.ToString("yyyy-MM-dd")
        }));
    }

    [McpServerTool(Name = "get_presentation"), Description("Get a presentation by ID, including all items and their parts")]
    public async Task<string> GetPresentation(string presentationId)
    {
        var presentation = await presentationService.GetPresentationByIdAsync(presentationId, OrgId, Caller);
        if (presentation is null)
            return JsonSerializer.Serialize(new { error = "Presentation not found" });

        return JsonSerializer.Serialize(new
        {
            presentation.Id,
            presentation.Name,
            CreatedAt = presentation.CreatedAt.ToString("yyyy-MM-dd"),
            Items = presentation.Items.OrderBy(i => i.SortOrder).Select(i => new
            {
                i.Id,
                i.Title,
                Type = i.Type.ToString(),
                Parts = i.Parts.OrderBy(p => p.SortOrder).Select(p => new { p.Id, p.Content })
            })
        });
    }

    [McpServerTool(Name = "create_presentation"), Description("Create a new presentation. Optionally provide a templateId to create from a template (use list_templates to find available templates).")]
    public async Task<string> CreatePresentation(string name, string? templateId = null)
    {
        Presentation presentation;
        if (templateId is not null)
        {
            presentation = await presentationService.CreatePresentationFromTemplateAsync(templateId, name, OrgId, mcp.UserId!, Caller);
        }
        else
        {
            presentation = await presentationService.CreatePresentationAsync(name, OrgId, mcp.UserId!, Caller);
        }
        return JsonSerializer.Serialize(new { presentation.Id, presentation.Name });
    }

    [McpServerTool(Name = "list_templates"), Description("List all available presentation templates in the organization")]
    public async Task<string> ListTemplates()
    {
        var templates = await presentationService.GetRecentTemplateSummariesAsync(OrgId, Caller);
        return JsonSerializer.Serialize(templates.Select(t => new
        {
            t.Id,
            t.Name,
            Date = t.Date.ToString("yyyy-MM-dd")
        }));
    }

    [McpServerTool(Name = "add_song_to_presentation"), Description("Add a song to a presentation by song ID")]
    public async Task<string> AddSongToPresentation(string presentationId, string songId)
    {
        var song = songService.GetSongById(songId, OrgId, Caller);
        if (song is null)
            return JsonSerializer.Serialize(new { error = "Song not found" });

        var item = new PresentationItem
        {
            SourceId = song.Id,
            Type = PresentationItemType.Song,
            Title = song.Name,
            Parts = song.Parts.Select((p, i) => new PresentationItemPart
            {
                Content = p.Content,
                SortOrder = i
            }).ToList()
        };

        await presentationService.AddItemAsync(OrgId, presentationId, item, Caller);
        sharedAppState.NotifyPresentationChanged(presentationId);
        return JsonSerializer.Serialize(new { success = true, itemId = item.Id, title = song.Name });
    }

    [McpServerTool(Name = "add_bible_text_to_presentation"), Description("Add Bible verses to a presentation. Specify book, chapter, and verse range.")]
    public async Task<string> AddBibleTextToPresentation(
        string presentationId,
        string bibleId,
        string bookId,
        int chapter,
        int verseStart,
        int verseEnd)
    {
        var allVerses = bibleService.GetVerses(OrgId, bibleId, bookId, chapter);
        var selectedVerses = allVerses
            .Where(v => v.VerseNumber >= verseStart && v.VerseNumber <= verseEnd)
            .ToList();

        if (selectedVerses.Count == 0)
            return JsonSerializer.Serialize(new { error = "No verses found for the specified range" });

        var bibleText = bibleTextService.Create(selectedVerses);
        var title = $"{bookId} {chapter}:{verseStart}-{verseEnd}";

        var item = new PresentationItem
        {
            SourceId = bibleText.Id,
            Type = PresentationItemType.BibleText,
            Title = title,
            Parts = bibleText.Parts.Select((p, i) => new PresentationItemPart
            {
                Content = p,
                SortOrder = i
            }).ToList()
        };

        await presentationService.AddItemAsync(OrgId, presentationId, item, Caller);
        sharedAppState.NotifyPresentationChanged(presentationId);
        return JsonSerializer.Serialize(new { success = true, itemId = item.Id, title });
    }

    [McpServerTool(Name = "rename_presentation"), Description("Rename a presentation")]
    public async Task<string> RenamePresentation(string presentationId, string name)
    {
        await presentationService.RenamePresentationAsync(OrgId, presentationId, name, Caller);
        sharedAppState.NotifyPresentationChanged(presentationId);
        return JsonSerializer.Serialize(new { success = true });
    }

    [McpServerTool(Name = "reorder_items"), Description("Reorder the items in a presentation. Provide all item IDs in the desired order.")]
    public async Task<string> ReorderItems(string presentationId, List<string> itemIds)
    {
        await presentationService.ReorderItemsAsync(OrgId, presentationId, itemIds, Caller);
        sharedAppState.NotifyPresentationChanged(presentationId);
        return JsonSerializer.Serialize(new { success = true });
    }

    [McpServerTool(Name = "rename_item"), Description("Rename an item in a presentation")]
    public async Task<string> RenameItem(string presentationId, string itemId, string title)
    {
        await presentationService.RenameItemAsync(OrgId, presentationId, itemId, title, Caller);
        sharedAppState.NotifyPresentationChanged(presentationId);
        return JsonSerializer.Serialize(new { success = true });
    }

    [McpServerTool(Name = "remove_item"), Description("Remove an item from a presentation")]
    public async Task<string> RemoveItem(string presentationId, string itemId)
    {
        await presentationService.RemoveItemAsync(OrgId, presentationId, itemId, Caller);
        sharedAppState.NotifyPresentationChanged(presentationId);
        return JsonSerializer.Serialize(new { success = true });
    }

    [McpServerTool(Name = "update_item_arrangement"), Description("Set or clear the song arrangement for an item. Pass null arrangementId to clear.")]
    public async Task<string> UpdateItemArrangement(string presentationId, string itemId, string? arrangementId = null)
    {
        await presentationService.UpdateItemArrangementAsync(OrgId, presentationId, itemId, arrangementId, Caller);
        sharedAppState.NotifyPresentationChanged(presentationId);
        return JsonSerializer.Serialize(new { success = true });
    }

    [McpServerTool(Name = "reorder_item_parts"), Description("Reorder the parts within a presentation item. Provide all part IDs in the desired order.")]
    public async Task<string> ReorderItemParts(string presentationId, string itemId, List<string> partIds)
    {
        await presentationService.ReorderItemPartsAsync(OrgId, presentationId, itemId, partIds, Caller);
        sharedAppState.NotifyPresentationChanged(presentationId);
        return JsonSerializer.Serialize(new { success = true });
    }

    [McpServerTool(Name = "remove_item_part"), Description("Remove a part from a presentation item")]
    public async Task<string> RemoveItemPart(string presentationId, string itemId, string partId)
    {
        await presentationService.RemoveItemPartAsync(OrgId, presentationId, itemId, partId, Caller);
        sharedAppState.NotifyPresentationChanged(presentationId);
        return JsonSerializer.Serialize(new { success = true });
    }

    [McpServerTool(Name = "update_presentation_event"), Description("Update event metadata on a presentation. date format: yyyy-MM-dd. time format: HH:mm. Pass null to clear a field.")]
    public async Task<string> UpdatePresentationEvent(
        string presentationId,
        string? date = null,
        string? time = null,
        string? location = null,
        string? description = null)
    {
        DateOnly? eventDate = string.IsNullOrWhiteSpace(date) ? null : DateOnly.Parse(date);
        TimeOnly? eventTime = string.IsNullOrWhiteSpace(time) ? null : TimeOnly.Parse(time);
        await presentationService.UpdatePresentationEventAsync(OrgId, presentationId, eventDate, eventTime, location, description, Caller);
        sharedAppState.NotifyPresentationChanged(presentationId);
        return JsonSerializer.Serialize(new { success = true });
    }
}
