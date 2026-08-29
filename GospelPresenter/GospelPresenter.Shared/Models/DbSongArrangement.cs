namespace GospelPresenter.Shared.Models;

public class DbSongArrangement : ISyncTracked
{
    public string Id { get; set; } = Guid.NewGuid().ToString();
    public string? Name { get; set; }
    public string PartIdsJson { get; set; } = "[]";
    public DateTimeOffset ModifiedAt { get; set; }

    public long Version { get; set; }

    public string SongId { get; set; } = "";
    public DbSong Song { get; set; } = null!;
}
