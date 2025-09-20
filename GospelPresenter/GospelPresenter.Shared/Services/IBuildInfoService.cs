namespace GospelPresenter.Shared.Services;

public interface IBuildInfoService
{
    public Task<BuildInfo?> GetBuildInfoAsync();
}

public record BuildInfo(string Commit, string Version, string BuildNumber, string? Branch, string PackageName)
{
    public string? EnvironmentName
    {
        get
        {
            return PackageName switch
            {
                not null when PackageName.EndsWith(".test") => "Test",
                not null when PackageName.EndsWith(".beta") => "Beta",
                _ => null
            };
        }
    }
};
