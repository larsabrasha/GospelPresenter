namespace GospelPresenter.Shared.Models;

public class CcliReportEntry
{
    public string Id { get; set; } = Guid.NewGuid().ToString();
    public string OrganizationId { get; set; } = "";
    public Organization Organization { get; set; } = null!;
    public string SongId { get; set; } = "";
    public string SongName { get; set; } = "";
    public string CcliNumber { get; set; } = "";
    public string? PresentationId { get; set; }
    public string PresentationName { get; set; } = "";
    public DateOnly Date { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public bool Reported { get; set; }
    public DateTime? ReportedAt { get; set; }
}
