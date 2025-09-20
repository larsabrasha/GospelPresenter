using GospelPresenter.Services.Cache;
using Microsoft.Extensions.Caching.Distributed;
using NeoSmart.Caching.Sqlite;
using Serilog;
using ZiggyCreatures.Caching.Fusion;
using ZiggyCreatures.Caching.Fusion.Serialization.SystemTextJson;

#if IOS || MACCATALYST
using Foundation;
#endif

namespace GospelPresenter.Configuration;

public static class CacheServiceCollectionExtensions
{
    public static IServiceCollection AddCache(this IServiceCollection services)
    {
        var fusionCacheDirectory = Path.Combine(FileSystem.AppDataDirectory, "FusionCache");
        var fusionCacheFile = Path.Combine(fusionCacheDirectory, "Cache.db");
        
        if (!Directory.Exists(fusionCacheDirectory))
        {
            Directory.CreateDirectory(fusionCacheDirectory);
        }

#if IOS || MACCATALYST
        ExcludeFolderFromBackup(fusionCacheDirectory);
#endif
        
        SQLitePCL.Batteries_V2.Init();
        services.AddOptions();
        services.Configure((Action<SqliteCacheOptions>)(options =>
        {
            options.CachePath = fusionCacheFile;
            options.CleanupInterval = null; // Making sure no expired data is evicted, as we always want to return old data as a fallback
        }));
        services.AddSingleton<ISqliteCacheProxy, SqliteCacheProxy>();
        services.AddSingleton<IDistributedCache, ISqliteCacheProxy>(serviceProvider => serviceProvider.GetRequiredService<ISqliteCacheProxy>());
        
        services.AddFusionCache()
            .WithSerializer(new FusionCacheSystemTextJsonSerializer(FusionCacheJsonSerializerOptions.Default))
            .WithDistributedCache(sp => sp.GetRequiredService<IDistributedCache>());
        services.AddSingleton<ITileDataCacheService, TileDataCacheService>();
        
        return services;
    }
    
#if IOS || MACCATALYST
    private static void ExcludeFolderFromBackup(string folderPath)
    {
        var url = new NSUrl(folderPath, true);
        
        var resourceValues = url.GetResourceValues([new NSString(NSUrl.IsExcludedFromBackupKey)], out var readError);
        if (readError is not null)
        {
            Log.Error("Error reading resource values of folder {Folder}. {ErrorMessage}",
                folderPath,
                readError.ToString()
            );
            return;
        }

        var isExcludedFromBackup = resourceValues.ValueForKey(NSUrl.IsExcludedFromBackupKey);
        if ((isExcludedFromBackup as NSNumber)?.BoolValue == true)
        {
            return;
        }
        
        url.SetResource(NSUrl.IsExcludedFromBackupKey, NSNumber.FromBoolean(true), out var setError);
        if (setError is not null)
        {
            Log.Error("Error setting resource values on folder {Folder}. {ErrorMessage}",
                folderPath,
                setError.ToString()
            );
        }
    }
#endif
}
