namespace GospelPresenter.Shared.Models;

public class DbSongPart : ISyncTracked
{
    public string Id { get; set; } = Guid.NewGuid().ToString();
    public string? LabelId { get; set; }
    public DbSongPartLabel? Label { get; set; }
    public string Content { get; set; } = "";
    public int SortOrder { get; set; }
    public DateTimeOffset ModifiedAt { get; set; }

    public long Version { get; set; }

    public string SongId { get; set; } = "";
    public DbSong Song { get; set; } = null!;
}
