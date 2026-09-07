using System.Collections.Concurrent;

namespace GospelPresenter.Web.Security;

/// <summary>
/// Slows down guessing. Several anonymous endpoints are keyed on a secret in the URL — a watch
/// code, a calendar token, an MCP API key — and the only thing standing between them and
/// enumeration is the size of the key space. A plain request-rate limit is the wrong tool for them:
/// a congregation on one wifi network is hundreds of phones behind one address, all legitimately
/// asking for the same page at once. What they never do is fail. So this counts <em>failures</em>
/// per client address and, past a threshold in a window, answers that client 429 until the window
/// has passed. A client that only ever presents valid keys is never touched.
///
/// In memory, per process. Good enough for one web container; it is not a defence against a
/// distributed guesser, which the key sizes themselves have to be.
/// </summary>
public sealed class FailureThrottle(TimeProvider? timeProvider = null)
{
    public const int MaxFailures = 20;
    public static readonly TimeSpan Window = TimeSpan.FromMinutes(10);

    private readonly TimeProvider clock = timeProvider ?? TimeProvider.System;
    private readonly ConcurrentDictionary<string, Bucket> buckets = new();
    private long lastSweepTicks;

    public bool IsBlocked(string key)
    {
        if (!buckets.TryGetValue(key, out var bucket)) return false;
        if (clock.GetUtcNow() - bucket.WindowStart > Window) return false;
        return Volatile.Read(ref bucket.Failures) >= MaxFailures;
    }

    public void RecordFailure(string key)
    {
        var now = clock.GetUtcNow();
        SweepOccasionally(now);

        while (true)
        {
            var bucket = buckets.GetOrAdd(key, _ => new Bucket(now));
            if (now - bucket.WindowStart > Window)
            {
                // Stale: start a fresh window. If another thread got there first, loop and count
                // against theirs.
                if (buckets.TryUpdate(key, new Bucket(now) { Failures = 1 }, bucket)) return;
                continue;
            }
            Interlocked.Increment(ref bucket.Failures);
            return;
        }
    }

    /// <summary>The key a request is counted under: the client's address, as the proxy reported it.</summary>
    public static string KeyFor(HttpContext context) =>
        context.Connection.RemoteIpAddress?.ToString() ?? "unknown";

    private void SweepOccasionally(DateTimeOffset now)
    {
        var last = Volatile.Read(ref lastSweepTicks);
        if (now.UtcTicks - last < Window.Ticks) return;
        if (Interlocked.CompareExchange(ref lastSweepTicks, now.UtcTicks, last) != last) return;

        foreach (var (key, bucket) in buckets)
            if (now - bucket.WindowStart > Window)
                buckets.TryRemove(new KeyValuePair<string, Bucket>(key, bucket));
    }

    private sealed class Bucket(DateTimeOffset windowStart)
    {
        public readonly DateTimeOffset WindowStart = windowStart;
        public int Failures;
    }
}

/// <summary>
/// Applies <see cref="FailureThrottle"/> to an endpoint whose Not Found, Unauthorized or Forbidden
/// answer means "you guessed wrong": a blocked client is refused before the handler runs, and a
/// wrong guess is recorded after it.
/// </summary>
public sealed class GuessThrottleFilter(FailureThrottle throttle) : IEndpointFilter
{
    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        var key = FailureThrottle.KeyFor(context.HttpContext);
        if (throttle.IsBlocked(key))
            return Results.StatusCode(StatusCodes.Status429TooManyRequests);

        var result = await next(context);

        if (result is IStatusCodeHttpResult { StatusCode: 401 or 403 or 404 })
            throttle.RecordFailure(key);

        return result;
    }
}
