using System.Net.Http.Json;
using System.Text.Json;
using GospelPresenter.Shared.Configuration;

namespace GospelPresenter.MigrationService;

internal class GarageInitializer(ILogger<GarageInitializer> logger)
{
    private const int MaxRetries = 10;
    private static readonly TimeSpan RetryDelay = TimeSpan.FromSeconds(2);

    public async Task InitializeAsync(S3Options opts, CancellationToken ct)
    {
        using var http = new HttpClient { BaseAddress = new Uri(opts.AdminEndpoint) };
        http.DefaultRequestHeaders.Add("Authorization", $"Bearer {opts.AdminToken}");

        // Garage admin API may not be ready immediately after the container starts
        for (var attempt = 1; ; attempt++)
        {
            try
            {
                await ConfigureLayout(http, ct);
                break;
            }
            catch (Exception ex) when (attempt < MaxRetries && !ct.IsCancellationRequested)
            {
                logger.LogDebug(ex, "Garage not ready (attempt {Attempt}/{Max}), retrying in {Delay}s",
                    attempt, MaxRetries, RetryDelay.TotalSeconds);
                await Task.Delay(RetryDelay, ct);
            }
        }

        await ImportKey(http, opts, ct);
        var bucketId = await CreateBucket(http, opts, ct);
        await AllowKeyOnBucket(http, opts, bucketId, ct);

        logger.LogInformation("Garage initialized: bucket '{Bucket}' ready", opts.BucketName);
    }

    private async Task ConfigureLayout(HttpClient http, CancellationToken ct)
    {
        var statusResponse = await http.GetAsync("/v2/GetClusterStatus", ct);
        statusResponse.EnsureSuccessStatusCode();
        var status = await statusResponse.Content.ReadFromJsonAsync<JsonElement>(ct);

        var layoutVersion = status.GetProperty("layoutVersion").GetInt64();
        if (layoutVersion != 0) return;

        // Find our node ID from the nodes list
        var nodes = status.GetProperty("nodes");
        string? nodeId = null;
        foreach (var node in nodes.EnumerateArray())
        {
            if (node.GetProperty("isUp").GetBoolean())
            {
                nodeId = node.GetProperty("id").GetString();
                break;
            }
        }

        if (nodeId is null)
            throw new InvalidOperationException("No online Garage node found");

        logger.LogInformation("Configuring Garage node layout for node {NodeId}", nodeId);

        var layoutBody = new
        {
            roles = new[] { new { id = nodeId, zone = "dc1", capacity = 1073741824L, tags = Array.Empty<string>() } }
        };
        var layoutResponse = await http.PostAsJsonAsync("/v2/UpdateClusterLayout", layoutBody, ct);
        layoutResponse.EnsureSuccessStatusCode();

        var applyBody = new { version = 1 };
        var applyResponse = await http.PostAsJsonAsync("/v2/ApplyClusterLayout", applyBody, ct);
        applyResponse.EnsureSuccessStatusCode();

        logger.LogInformation("Garage node layout configured");
    }

    private async Task ImportKey(HttpClient http, S3Options opts, CancellationToken ct)
    {
        logger.LogDebug("Ensuring Garage API key exists");

        // Check if the key already exists
        var check = await http.GetAsync($"/v2/GetKeyInfo?id={opts.AccessKey}", ct);
        if (check.IsSuccessStatusCode)
        {
            logger.LogDebug("Garage API key already exists");
            return;
        }

        var body = new { accessKeyId = opts.AccessKey, secretAccessKey = opts.SecretKey, name = "gospelpresenter" };
        var response = await http.PostAsJsonAsync("/v2/ImportKey", body, ct);
        response.EnsureSuccessStatusCode();
    }

    private async Task<string> CreateBucket(HttpClient http, S3Options opts, CancellationToken ct)
    {
        logger.LogDebug("Ensuring Garage bucket '{Bucket}' exists", opts.BucketName);

        // Check if the bucket already exists
        var check = await http.GetAsync($"/v2/GetBucketInfo?globalAlias={opts.BucketName}", ct);
        if (check.IsSuccessStatusCode)
        {
            var existing = await check.Content.ReadFromJsonAsync<JsonElement>(ct);
            var existingId = existing.GetProperty("id").GetString()!;
            logger.LogDebug("Garage bucket '{Bucket}' already exists with id {Id}", opts.BucketName, existingId);
            return existingId;
        }

        var body = new { globalAlias = opts.BucketName };
        var response = await http.PostAsJsonAsync("/v2/CreateBucket", body, ct);
        response.EnsureSuccessStatusCode();
        var result = await response.Content.ReadFromJsonAsync<JsonElement>(ct);
        return result.GetProperty("id").GetString()!;
    }

    private async Task AllowKeyOnBucket(HttpClient http, S3Options opts, string bucketId, CancellationToken ct)
    {
        var body = new
        {
            bucketId,
            accessKeyId = opts.AccessKey,
            permissions = new { read = true, write = true, owner = true }
        };
        var response = await http.PostAsJsonAsync("/v2/AllowBucketKey", body, ct);
        response.EnsureSuccessStatusCode();
    }
}
