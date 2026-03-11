namespace GospelPresenter.Shared.Models;

public class DbSong
{
    public string Id { get; set; } = Guid.NewGuid().ToString();
    public string Name { get; set; } = "";
    public string? Author { get; set; }
    public string? Publisher { get; set; }
    public int? Year { get; set; }
    public string? Ccli { get; set; }

    public string OrganizationId { get; set; } = "";
    public Organization Organization { get; set; } = null!;

    public List<DbSongPart> Parts { get; set; } = [];
}
