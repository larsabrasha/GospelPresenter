namespace GospelPresenter.Shared.Models;

public class Presentation : ISyncTracked
{
    public string Id { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public DateTimeOffset CreatedAt { get; set; }
    public string CreatedBy { get; set; } = string.Empty;
    public DateTimeOffset UpdatedAt { get; set; }
    public string UpdatedBy { get; set; } = string.Empty;
    public DateTimeOffset ModifiedAt { get; set; }

    public long Version { get; set; }

    public bool IsTemplate { get; set; }
    public string? Description { get; set; }

    /// <summary>
    /// When the presentation was moved to the trash, or null while it is in use. Soft deletion so a
    /// mis-click is recoverable: nothing in the aggregate is touched, and the slide files stay in
    /// object storage until the row is purged. Every read path filters this out with
    /// <c>NotDeleted()</c>; the trash is the one place that asks for the rows it hides.
    ///
    /// This is not a tombstone. It travels to clients as an ordinary column, the way
    /// <see cref="DbSong.DeletedAt"/> does, so every device shows the same trash. The tombstone is
    /// written when the row is purged for good.
    /// </summary>
    public DateTimeOffset? DeletedAt { get; set; }
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
