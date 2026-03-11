using GospelPresenter.Shared.State;

namespace GospelPresenter.Shared.Services;

public class MockSongService : ISongService
{
    private readonly Dictionary<string, Song> songsById = new();
    private List<Song> songsSorted = [];

    public IReadOnlyList<Song> Songs => songsSorted;

    public Song? GetSongById(string id) => songsById.GetValueOrDefault(id);

    public IReadOnlyList<Song> Search(string query)
    {
        if (string.IsNullOrWhiteSpace(query))
            return songsSorted;

        var terms = query.ToLowerInvariant().Split(' ', StringSplitOptions.RemoveEmptyEntries);
        return songsSorted
            .Where(s => terms.All(t => s.Name.Contains(t, StringComparison.OrdinalIgnoreCase)))
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

    public Task<List<string>> FindDuplicateNamesAsync(IEnumerable<string> names, string organizationId) =>
        Task.FromResult(new List<string>());

    public Task<ImportResult> ImportProPresenterFilesAsync(IEnumerable<(string FileName, byte[] Data)> files, string organizationId, bool replaceExisting = false) =>
        Task.FromResult(new ImportResult(0, 0, 0));

    public Task DeleteSongAsync(string id)
    {
        songsById.Remove(id);
        songsSorted = songsById.Values.OrderBy(s => s.Name).ToList();
        return Task.CompletedTask;
    }

    public Task<List<TrashedSong>> GetTrashedSongsAsync() =>
        Task.FromResult(new List<TrashedSong>());

    public Task RestoreFromTrashAsync(string id) => Task.CompletedTask;

    public Task PermanentlyDeleteSongAsync(string id) => Task.CompletedTask;

    public Task EmptyTrashAsync() => Task.CompletedTask;

    public Task RestoreAllFromTrashAsync() => Task.CompletedTask;

    public Task UpdateSongAsync(string id, string name, string? author) => Task.CompletedTask;

    public Task UpdateSongPartAsync(string songId, int partIndex, string? label, string content) => Task.CompletedTask;

    public Task AddSongPartAsync(string songId, string? label, string content) => Task.CompletedTask;

    public Task DeleteSongPartAsync(string songId, int partIndex) => Task.CompletedTask;

    public Task MoveSongPartAsync(string songId, int fromIndex, int toIndex) => Task.CompletedTask;

    public Task<List<SongVersionSummary>> GetVersionsAsync(string songId) =>
        Task.FromResult(new List<SongVersionSummary>());

    public Task<SongVersionDetail?> GetVersionAsync(string versionId) =>
        Task.FromResult<SongVersionDetail?>(null);

    public Task RestoreVersionAsync(string songId, string versionId) => Task.CompletedTask;
}
