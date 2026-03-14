namespace GospelPresenter.Shared.Models;

public class DbSongPart
{
    public string Id { get; set; } = Guid.NewGuid().ToString();
    public string? Label { get; set; }
    public string Content { get; set; } = "";
    public int SortOrder { get; set; }

    public string SongId { get; set; } = "";
    public DbSong Song { get; set; } = null!;
}
