using System.Text.Json.Serialization;
using ZiggyCreatures.Caching.Fusion.Internals.Distributed;

namespace GospelPresenter.Services.Cache;

// This is needed to make the FusionCacheDistributedEntry<T> serializable
// by System.Text.Json after AOT trimming. Only the typed versions that
// are declared will be generated and remain after trimming.
[JsonSourceGenerationOptions(WriteIndented = false, GenerationMode = JsonSourceGenerationMode.Metadata)]
[JsonSerializable(typeof(FusionCacheDistributedEntry<HttpResponseCacheItem>))]
[JsonSerializable(typeof(FusionCacheDistributedEntry<string>))]
[JsonSerializable(typeof(FusionCacheDistributedEntry<long>))]
[JsonSerializable(typeof(FusionCacheDistributedEntry<List<string>>))]
public partial class FusionCacheJsonContext : JsonSerializerContext;
