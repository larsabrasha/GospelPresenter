using System.ComponentModel;
using System.Text.Json;
using GospelPresenter.Shared.Services;
using ModelContextProtocol.Server;

namespace GospelPresenter.Web.Mcp;

[McpServerToolType]
public sealed class SongTools(ISongService songService, McpCallerContextAccessor mcp)
{
    private CallerContext Caller => mcp.Caller!;
    private string OrgId => mcp.OrganizationId!;

    [McpServerTool(Name = "search_songs"), Description("Search songs by name or lyrics")]
    public string SearchSongs(string query)
    {
        var results = songService.SearchByOrganization(query, OrgId, Caller);
        return JsonSerializer.Serialize(results.Select(s => new
        {
            s.Id,
            s.Name,
            s.Author,
            Parts = s.Parts.Select(p => new { p.Label, p.Content })
        }));
    }

    [McpServerTool(Name = "list_songs"), Description("List all songs in the organization")]
    public string ListSongs()
    {
        var songs = songService.GetSongsByOrganization(OrgId, Caller);
        return JsonSerializer.Serialize(songs.Select(s => new
        {
            s.Id,
            s.Name,
            s.Author,
            PartCount = s.Parts.Count
        }));
    }

    [McpServerTool(Name = "get_song"), Description("Get a song by ID, including all parts/lyrics")]
    public string GetSong(string songId)
    {
        var song = songService.GetSongById(songId, OrgId, Caller);
        if (song is null)
            return JsonSerializer.Serialize(new { error = "Song not found" });

        return JsonSerializer.Serialize(new
        {
            song.Id,
            song.Name,
            song.Author,
            song.Publisher,
            song.Year,
            song.Ccli,
            Parts = song.Parts.Select(p => new { p.Label, p.Content })
        });
    }
}
