namespace GospelPresenter.Shared.Models;

public class Presentation
{
    public string Id { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public DateTimeOffset CreatedAt { get; set; }
    public string CreatedBy { get; set; } = string.Empty;
    public DateTimeOffset UpdatedAt { get; set; }
    public string UpdatedBy { get; set; } = string.Empty;

    public bool IsTemplate { get; set; }
    public string? Description { get; set; }
    public DateTimeOffset? LastUsedAt { get; set; }
    public int UseCount { get; set; }

    public int? ScheduledDayOfWeek { get; set; }
    public TimeOnly? ScheduledTime { get; set; }

    public DateOnly? EventDate { get; set; }
    public TimeOnly? EventTime { get; set; }
    public string? EventLocation { get; set; }

    public string OrganizationId { get; set; } = string.Empty;
    public Organization Organization { get; set; } = null!;

    public List<PresentationItem> Items { get; set; } = [];
}
