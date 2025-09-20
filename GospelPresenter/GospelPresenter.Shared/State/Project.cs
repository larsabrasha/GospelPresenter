namespace GospelPresenter.Shared.State;

public class Project
{
    public string Id { get; set; }
    public string Name { get; set; }
    public IList<ProjectItem> Items { get; set; }
}

public class ProjectItem
{
    public string Id { get; set; }
    public ProjectItemType Type { get; set; }
    public string Title { get; set; }
}

public enum ProjectItemType
{
    Song
}
