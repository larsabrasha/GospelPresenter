using GospelPresenter.Shared.Models;

namespace GospelPresenter.Shared.State;

public class Project
{
    public string Id { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public int? ScheduledDayOfWeek { get; set; }
    public TimeOnly? ScheduledTime { get; set; }
    public DateOnly? EventDate { get; set; }
    public TimeOnly? EventTime { get; set; }
    public string? EventLocation { get; set; }
    public string? Description { get; set; }

    /// <summary>Null means the presentation follows the organisation's default theme.</summary>
    public string? ThemeId { get; set; }

    public IList<ProjectItem> Items { get; set; } = [];
}

public class ProjectItem
{
    public string Id { get; set; } = string.Empty;
    public string? SourceId { get; set; }
    public ProjectItemType Type { get; set; }
    public string Title { get; set; } = string.Empty;
}

public enum ProjectItemType
{
    Song,
    BibleText,
    Image,
    Audio,
    Slides
}

public static class ProjectItemTypeExtensions
{
    /// <summary>
    /// The stored item type as the project model spells it. The two enums have always been the
    /// same set under two names; this is the one place that says so.
    /// </summary>
    public static ProjectItemType ToProjectItemType(this PresentationItemType type) => type switch
    {
        PresentationItemType.Song => ProjectItemType.Song,
        PresentationItemType.BibleText => ProjectItemType.BibleText,
        PresentationItemType.Image => ProjectItemType.Image,
        PresentationItemType.Audio => ProjectItemType.Audio,
        PresentationItemType.Slides => ProjectItemType.Slides,
        _ => ProjectItemType.Song
    };
}
