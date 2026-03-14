using GospelPresenter.Shared.State;

namespace GospelPresenter.Shared.Services;

public class MockSongService : ISongService
{
    private readonly Dictionary<string, Song> songsById = new();
    private List<Song> songsSorted = [];

    public IReadOnlyList<Song> GetSongsByOrganization(string organizationId, CallerContext caller)
    {
        caller.RequireOrganizationAccess(organizationId);
        return songsSorted.Where(s => s.OrganizationId == organizationId).ToList();
    }

    public Song? GetSongById(string id, string organizationId, CallerContext caller)
    {
        caller.RequireOrganizationAccess(organizationId);
        var song = songsById.GetValueOrDefault(id);
        return song?.OrganizationId == organizationId ? song : null;
    }

    public IReadOnlyList<Song> SearchByOrganization(string query, string organizationId, CallerContext caller)
    {
        caller.RequireOrganizationAccess(organizationId);
        if (string.IsNullOrWhiteSpace(query))
            return GetSongsByOrganization(organizationId, caller);

        var terms = query.ToLowerInvariant().Split(' ', StringSplitOptions.RemoveEmptyEntries);
        return songsSorted
            .Where(s => s.OrganizationId == organizationId && terms.All(t => s.Name.Contains(t, StringComparison.OrdinalIgnoreCase)))
            .ToList();
    }

    public Task LoadSongsAsync()
    {
        var sample = new Song("1", "Amazing Grace", "John Newton", null, 1779, null,
        [
            new SongPart("Vers 1", "Amazing grace, how sweet the sound\nThat saved a wretch like me"),
            new SongPart("Vers 2", "Through many dangers, toils and snares\nI have already come")
        ]);

        songsById[sample.Id] = sample;
        songsSorted = songsById.Values.OrderBy(s => s.Name).ToList();
        return Task.CompletedTask;
    }

    public Task<List<string>> FindDuplicateNamesAsync(IEnumerable<string> names, string organizationId, CallerContext caller)
    {
        caller.RequireOrganizationAccess(organizationId);
        return Task.FromResult(new List<string>());
    }

    public Task<ImportResult> ImportProPresenterFilesAsync(IEnumerable<(string FileName, byte[] Data)> files, string organizationId, CallerContext caller, bool replaceExisting = false)
    {
        caller.RequireOrganizationAccess(organizationId);
        return Task.FromResult(new ImportResult(0, 0, 0));
    }

    public Task DeleteSongAsync(string id, string organizationId, CallerContext caller)
    {
        caller.RequireOrganizationAccess(organizationId);
        songsById.Remove(id);
        songsSorted = songsById.Values.OrderBy(s => s.Name).ToList();
        return Task.CompletedTask;
    }

    public Task<List<TrashedSong>> GetTrashedSongsAsync(string organizationId, CallerContext caller)
    {
        caller.RequireOrganizationAccess(organizationId);
        return Task.FromResult(new List<TrashedSong>());
    }

    public Task RestoreFromTrashAsync(string id, string organizationId, CallerContext caller)
    {
        caller.RequireOrganizationAccess(organizationId);
        return Task.CompletedTask;
    }

    public Task PermanentlyDeleteSongAsync(string id, string organizationId, CallerContext caller)
    {
        caller.RequireOrganizationAccess(organizationId);
        return Task.CompletedTask;
    }

    public Task EmptyTrashAsync(string organizationId, CallerContext caller)
    {
        caller.RequireOrganizationAccess(organizationId);
        return Task.CompletedTask;
    }

    public Task RestoreAllFromTrashAsync(string organizationId, CallerContext caller)
    {
        caller.RequireOrganizationAccess(organizationId);
        return Task.CompletedTask;
    }

    public Task UpdateSongAsync(string id, string organizationId, string name, string? author, string? publisher, int? year, string? ccli, CallerContext caller)
    {
        caller.RequireOrganizationAccess(organizationId);
        return Task.CompletedTask;
    }

    public Task UpdateSongPartAsync(string songId, string organizationId, int partIndex, string? label, string content, CallerContext caller)
    {
        caller.RequireOrganizationAccess(organizationId);
        return Task.CompletedTask;
    }

    public Task AddSongPartAsync(string songId, string organizationId, string? label, string content, CallerContext caller)
    {
        caller.RequireOrganizationAccess(organizationId);
        return Task.CompletedTask;
    }

    public Task DeleteSongPartAsync(string songId, string organizationId, int partIndex, CallerContext caller)
    {
        caller.RequireOrganizationAccess(organizationId);
        return Task.CompletedTask;
    }

    public Task MoveSongPartAsync(string songId, string organizationId, int fromIndex, int toIndex, CallerContext caller)
    {
        caller.RequireOrganizationAccess(organizationId);
        return Task.CompletedTask;
    }

    public Task<List<SongVersionSummary>> GetVersionsAsync(string songId, string organizationId, CallerContext caller)
    {
        caller.RequireOrganizationAccess(organizationId);
        return Task.FromResult(new List<SongVersionSummary>());
    }

    public Task<SongVersionDetail?> GetVersionAsync(string versionId, string organizationId, CallerContext caller)
    {
        caller.RequireOrganizationAccess(organizationId);
        return Task.FromResult<SongVersionDetail?>(null);
    }

    public Task RestoreVersionAsync(string songId, string organizationId, string versionId, CallerContext caller)
    {
        caller.RequireOrganizationAccess(organizationId);
        return Task.CompletedTask;
    }

    public Task<Song> CreateSongAsync(string name, string? author, string? publisher, int? year, string? ccli, List<SongPart> parts, string organizationId, CallerContext caller)
    {
        caller.RequireOrganizationAccess(organizationId);
        var song = new Song(Guid.NewGuid().ToString(), name, author, publisher, year, ccli, parts.ToList<SongPart>());
        songsById[song.Id] = song;
        songsSorted = songsById.Values.OrderBy(s => s.Name).ToList();
        return Task.FromResult(song);
    }
}
