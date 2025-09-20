using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Caching.Distributed;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using NeoSmart.Caching.Sqlite;

namespace GospelPresenter.Services.Cache;

public interface ISqliteCacheProxy : IDistributedCache
{
    void DeleteAndRecreateSqliteCache();
}

public class SqliteCacheProxy(
    IOptions<SqliteCacheOptions> options,
    ILogger<SqliteCacheProxy> logger
) : ISqliteCacheProxy
{
    private static string? cachePath;
    private SqliteCache sqliteCacheInstance = CreateSqliteCacheInstance(options);

    private static SqliteCache CreateSqliteCacheInstance(IOptions<SqliteCacheOptions> options)
    {
        cachePath = options.Value.CachePath;

        return new SqliteCache(new SqliteCacheOptions
        {
            CachePath = options.Value.CachePath,
            CleanupInterval = options.Value.CleanupInterval
        });
    }

    public byte[]? Get(string key)
    {
        return sqliteCacheInstance.Get(key);
    }

    public Task<byte[]?> GetAsync(string key, CancellationToken token = new CancellationToken())
    {
        return sqliteCacheInstance.GetAsync(key, token);
    }

    public void Set(string key, byte[] value, DistributedCacheEntryOptions options)
    {
        sqliteCacheInstance.Set(key, value, options);
    }

    public Task SetAsync(string key, byte[] value, DistributedCacheEntryOptions options,
        CancellationToken token = new CancellationToken())
    {
        return sqliteCacheInstance.SetAsync(key, value, options, token);
    }

    public void Refresh(string key)
    {
        sqliteCacheInstance.Refresh(key);
    }

    public Task RefreshAsync(string key, CancellationToken token = new CancellationToken())
    {
        return sqliteCacheInstance.RefreshAsync(key, token);
    }

    public void Remove(string key)
    {
        sqliteCacheInstance.Remove(key);
    }

    public Task RemoveAsync(string key, CancellationToken token = new CancellationToken())
    {
        return sqliteCacheInstance.RemoveAsync(key, token);
    }

    public void DeleteAndRecreateSqliteCache()
    {
        sqliteCacheInstance.Dispose(); // Will return all connections to the connection pool
        SqliteConnection.ClearAllPools(); // Empties the connection pool

        DeleteSqliteFiles();

        sqliteCacheInstance = CreateSqliteCacheInstance(options);
    }

    private void DeleteSqliteFiles()
    {
        try
        {
            var databaseDirectory = Path.GetDirectoryName(cachePath);
            var fileName = Path.GetFileName(cachePath);

            if (databaseDirectory is not null)
            {
                var filesToDelete = Directory.GetFiles(databaseDirectory, $"{fileName}*");

                foreach (var file in filesToDelete)
                {
                    if (File.Exists(file))
                    {
                        File.Delete(file);
                        logger.LogDebug("Successfully deleted: {File}", file);
                    }
                }
            }
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error deleting sqlite cache files");
        }
    }
}
