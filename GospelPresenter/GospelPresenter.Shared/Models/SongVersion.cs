namespace GospelPresenter.Shared.Models;

public class DbSongVersion
{
    public string Id { get; set; } = Guid.NewGuid().ToString();
    public string SongId { get; set; } = "";
    public DbSong Song { get; set; } = null!;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    // JSON snapshot of the song state
    public string Name { get; set; } = "";
    public string? Author { get; set; }
    public string PartsJson { get; set; } = "[]";
}
