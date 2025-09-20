using System.Text.Json;
using GospelPresenter.Shared.Utils;

namespace GospelPresenter.Services.Cache;

public static class FusionCacheJsonSerializerOptions
{
    public static JsonSerializerOptions Default
    {
        get
        {
            var options = ExtendedJsonSerializerOptions.GospelPresenterDefault;
            options.TypeInfoResolver = FusionCacheJsonContext.Default;
            return options;
        }
    }
}
