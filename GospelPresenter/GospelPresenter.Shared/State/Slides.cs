using System.Text.Json;

namespace GospelPresenter.Shared.State;

public record SlidesState(string Id, string SlidesId, List<string> Urls);

public record SlidesAddResult(string PresentationItemId, string SlidesId, string FileName, int PageCount)
{
    public static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
}
