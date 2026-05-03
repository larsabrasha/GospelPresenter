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
