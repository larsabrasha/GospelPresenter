using System.Text.Json;

namespace GospelPresenter.Shared.Utils;

public static class ExtendedJsonSerializerOptions
{
    public static JsonSerializerOptions GospelPresenterDefault
    {
        get
        {
            var options = new JsonSerializerOptions
            {
                PropertyNameCaseInsensitive = true,
                RespectNullableAnnotations = true
            };
            return options;
        }
    }
}
