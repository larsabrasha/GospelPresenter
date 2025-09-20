using GospelPresenter.Shared.Services;

namespace GospelPresenter.Services;

public class BuildInfoService : IBuildInfoService
{
    public async Task<BuildInfo?> GetBuildInfoAsync()
    {
        var commit = await GetTextFromFileAsync("commit.txt");
        var branch = await GetTextFromFileAsync("branch.txt");

        return new BuildInfo(commit, AppInfo.VersionString, AppInfo.BuildString, branch, AppInfo.PackageName);
    }

    private static async Task<string> GetTextFromFileAsync(string filename)
    {
        await using var stream = await FileSystem.OpenAppPackageFileAsync(filename);
        using var reader = new StreamReader(stream);
        var text = await reader.ReadToEndAsync();

        return text.Trim();
    }
}
