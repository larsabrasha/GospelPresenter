using System.Text.Json;

namespace GospelPresenter.Shared.Models;

public record UploadResult(string Id, string FileName, string ContentType)
{
    public static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
}
