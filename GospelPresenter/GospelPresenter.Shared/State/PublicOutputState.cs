using System.Collections.Concurrent;
using System.Threading.Channels;

namespace GospelPresenter.Shared.State;

/// <summary>
/// What a public output pushes to its viewers. Slide carries a rendered HTML fragment;
/// Idle means there is nothing to show (no presentation broadcasting, or a black screen).
/// </summary>
public enum PublicOutputEventType
{
    Slide,
    Idle
}

public record PublicOutputEvent(PublicOutputEventType Type, string? Html = null)
{
    public static readonly PublicOutputEvent Idle = new(PublicOutputEventType.Idle);

    public static PublicOutputEvent Slide(string html) => new(PublicOutputEventType.Slide, html);
}

/// <summary>
/// Tracks the anonymous visitors currently watching each public output and carries events to them.
///
/// A viewer is identified by an id the browser keeps in sessionStorage, so an EventSource
/// reconnect or a page reload replaces the existing entry instead of counting twice, and the
/// viewer disappears when the tab is closed.
/// </summary>
public class PublicOutputState
{
    private static readonly TimeSpan ViewerTimeout = TimeSpan.FromMinutes(2);
    private static readonly TimeSpan CountNotifyInterval = TimeSpan.FromSeconds(2);

    private sealed class Viewer
    {
        public required Channel<PublicOutputEvent> Events { get; init; }
        public DateTime LastSeen { get; set; }
    }

    private readonly ConcurrentDictionary<string, ConcurrentDictionary<string, Viewer>> viewers = new();
    private readonly ConcurrentDictionary<string, DateTime> lastNotified = new();
    private readonly ConcurrentDictionary<string, Timer> pendingNotifications = new();
    private readonly int maxViewersPerOutput;

    public PublicOutputState(int maxViewersPerOutput = 500)
    {
        this.maxViewersPerOutput = maxViewersPerOutput;
    }

    /// <summary>Raised with the output code when its viewer count has changed. Throttled.</summary>
    public event Action<string>? ViewerCountChanged;

    public int MaxViewersPerOutput => maxViewersPerOutput;

    /// <summary>
    /// Registers a viewer and returns the channel to read events from. Returns false when the
    /// output is at its viewer cap — a safety valve for the server, not a policy for operators.
    /// A viewer id that is already registered always succeeds, so reconnects are never rejected.
    /// </summary>
    public bool TryAddViewer(string code, string viewerId, out ChannelReader<PublicOutputEvent> reader)
    {
        CleanupStaleViewers();

        var outputViewers = viewers.GetOrAdd(code, _ => new ConcurrentDictionary<string, Viewer>());

        var isExisting = outputViewers.ContainsKey(viewerId);
        if (!isExisting && outputViewers.Count >= maxViewersPerOutput)
        {
            reader = Channel.CreateBounded<PublicOutputEvent>(1).Reader;
            return false;
        }

        // Capacity 1 with DropOldest: only the latest state matters, so a viewer whose
        // connection stalls gets the current slide rather than a backlog of stale ones.
        var viewer = new Viewer
        {
            Events = Channel.CreateBounded<PublicOutputEvent>(
                new BoundedChannelOptions(1) { FullMode = BoundedChannelFullMode.DropOldest }),
            LastSeen = DateTime.UtcNow
        };

        if (outputViewers.TryGetValue(viewerId, out var previous))
            previous.Events.Writer.TryComplete();

        outputViewers[viewerId] = viewer;
        reader = viewer.Events.Reader;

        if (!isExisting)
            NotifyViewerCountChanged(code);

        return true;
    }

    public void RemoveViewer(string code, string viewerId)
    {
        if (!viewers.TryGetValue(code, out var outputViewers))
            return;

        if (!outputViewers.TryRemove(viewerId, out var viewer))
            return;

        viewer.Events.Writer.TryComplete();

        if (outputViewers.IsEmpty)
            viewers.TryRemove(code, out _);

        NotifyViewerCountChanged(code);
    }

    /// <summary>Removes every viewer of an output, e.g. when its identifier is regenerated.</summary>
    public void RemoveAllViewers(string code)
    {
        if (!viewers.TryRemove(code, out var outputViewers))
            return;

        foreach (var viewer in outputViewers.Values)
            viewer.Events.Writer.TryComplete();

        NotifyViewerCountChanged(code);
    }

    public int GetViewerCount(string code) =>
        viewers.TryGetValue(code, out var outputViewers) ? outputViewers.Count : 0;

    /// <summary>The output codes that currently have at least one viewer.</summary>
    public IReadOnlyCollection<string> GetCodesWithViewers() => viewers.Keys.ToList();

    public void Publish(string code, PublicOutputEvent evt)
    {
        if (!viewers.TryGetValue(code, out var outputViewers))
            return;

        foreach (var viewer in outputViewers.Values)
            viewer.Events.Writer.TryWrite(evt);
    }

    /// <summary>Records that a viewer's connection is still writable, from the periodic ping.</summary>
    public void TouchViewer(string code, string viewerId)
    {
        if (viewers.TryGetValue(code, out var outputViewers) &&
            outputViewers.TryGetValue(viewerId, out var viewer))
        {
            viewer.LastSeen = DateTime.UtcNow;
        }
    }

    public void CleanupStaleViewers()
    {
        var now = DateTime.UtcNow;
        foreach (var (code, outputViewers) in viewers)
        {
            foreach (var (viewerId, viewer) in outputViewers)
            {
                if (now - viewer.LastSeen > ViewerTimeout)
                    RemoveViewer(code, viewerId);
            }
        }
    }

    private void NotifyViewerCountChanged(string code)
    {
        var now = DateTime.UtcNow;
        var elapsed = now - lastNotified.GetValueOrDefault(code);

        if (elapsed >= CountNotifyInterval)
        {
            lastNotified[code] = now;
            ViewerCountChanged?.Invoke(code);
            return;
        }

        // Notified recently. Schedule a single trailing signal so the final count is never lost,
        // without emitting one signal per viewer while a congregation scans the code at once.
        if (pendingNotifications.ContainsKey(code))
            return;

        var timer = new Timer(_ =>
        {
            if (pendingNotifications.TryRemove(code, out var pending))
                pending.Dispose();
            lastNotified[code] = DateTime.UtcNow;
            ViewerCountChanged?.Invoke(code);
        }, null, CountNotifyInterval - elapsed, Timeout.InfiniteTimeSpan);

        if (!pendingNotifications.TryAdd(code, timer))
            timer.Dispose();
    }
}
