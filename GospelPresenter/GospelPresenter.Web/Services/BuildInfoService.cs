using System.Text.Json;
using GospelPresenter.Shared.Services;

namespace GospelPresenter.Web.Services;

public class BuildInfoService(IWebHostEnvironment webHostEnvironment) : IBuildInfoService
{
    private readonly JsonSerializerOptions jsonSerializerOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    };

    public async Task<BuildInfo?> GetBuildInfoAsync()
    {
        var path = Path.Combine(webHostEnvironment.WebRootPath, "version.json");

        if (!File.Exists(path)) return null;

        var json = await File.ReadAllTextAsync(path);
        var buildInfo = JsonSerializer.Deserialize<BuildInfo>(json, jsonSerializerOptions);

        if (buildInfo is not null)
        {
            return buildInfo with { PackageName = "com.gospelpresenter.web.test" };
        }

        return buildInfo;
    }
}
