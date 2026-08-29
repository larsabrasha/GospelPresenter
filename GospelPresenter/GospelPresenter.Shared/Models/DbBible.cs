namespace GospelPresenter.Shared.Models;

public class DbBible : ISyncTracked
{
    public string Id { get; set; } = Guid.NewGuid().ToString();
    public string Name { get; set; } = "";
    public string Abbreviation { get; set; } = "";
    public string VersesJson { get; set; } = "[]";
    public int VerseCount { get; set; }
    public DateTimeOffset ModifiedAt { get; set; }

    public long Version { get; set; }

    public string OrganizationId { get; set; } = "";
    public Organization Organization { get; set; } = null!;
}
