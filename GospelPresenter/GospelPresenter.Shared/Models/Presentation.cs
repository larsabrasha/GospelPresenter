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

    /// <summary>
    /// Null means the presentation follows the organisation's default theme. A value is an override
    /// chosen for this presentation, and is copied when a presentation is created from a template.
    /// </summary>
    public string? ThemeId { get; set; }

    public string OrganizationId { get; set; } = string.Empty;
    public Organization Organization { get; set; } = null!;

    public List<PresentationItem> Items { get; set; } = [];
    public List<PresentationSlides> SlideDecks { get; set; } = [];
}
