using System.Collections.Concurrent;
using System.Security.Cryptography;

namespace GospelPresenter.Shared.State;

public record PairingEntry(string DisplayId, DateTime CreatedAt);

public record PairingTokenEntry(string SessionId, DateTime CreatedAt);

public record ConnectedDisplay(string DisplayId, string Name);

public class RemoteDisplayState
{
    private static readonly TimeSpan CodeExpiration = TimeSpan.FromMinutes(10);
    private static readonly TimeSpan IdleTimeout = TimeSpan.FromHours(4);

    private readonly ConcurrentDictionary<string, PairingEntry> pairingCodes = new();
    private readonly ConcurrentDictionary<string, PairingTokenEntry> pairingTokens = new();
    private readonly ConcurrentDictionary<string, string> displayToSession = new();
    private readonly ConcurrentDictionary<string, string> displayToCode = new();
    private readonly ConcurrentDictionary<string, string> displayToName = new();
    private readonly ConcurrentDictionary<string, DateTime> displayPairedAt = new();
    private readonly ConcurrentDictionary<string, DateTime> displayLastActivity = new();
    private readonly ConcurrentDictionary<string, byte> onlineDisplays = new();

    public event Action<string>? DisplayPaired;
    public event Action<string>? DisplayUnpaired;
    public event Action<string>? DisplayCameOnline;
    public event Action<string>? DisplayWentOffline;

    public bool IsCodeValid(string code)
    {
        if (!pairingCodes.TryGetValue(code, out var entry))
            return false;

        return DateTime.UtcNow - entry.CreatedAt <= CodeExpiration;
    }

    public string GeneratePairingCode(string displayId, string? displayName = null)
    {
        // Remove any existing code for this display
        if (displayToCode.TryRemove(displayId, out var oldCode))
            pairingCodes.TryRemove(oldCode, out _);

        if (displayName is not null)
            displayToName[displayId] = displayName;

        CleanupExpiredCodes();
        CleanupIdleDisplays();

        string code;
        do
        {
            code = RandomNumberGenerator.GetInt32(1000, 9999).ToString();
        } while (!pairingCodes.TryAdd(code, new PairingEntry(displayId, DateTime.UtcNow)));

        displayToCode[displayId] = code;
        return code;
    }

    public string GeneratePairingToken(string sessionId)
    {
        CleanupExpiredTokens();

        var bytes = RandomNumberGenerator.GetBytes(32);
        var token = Convert.ToBase64String(bytes)
            .TrimEnd('=')
            .Replace('+', '-')
            .Replace('/', '_');

        pairingTokens[token] = new PairingTokenEntry(sessionId, DateTime.UtcNow);
        return token;
    }

    public void InvalidatePairingToken(string token)
    {
        pairingTokens.TryRemove(token, out _);
    }

    public bool ConsumePairingToken(string token, string displayId, string? displayName = null)
    {
        if (!pairingTokens.TryRemove(token, out var entry))
            return false;

        if (DateTime.UtcNow - entry.CreatedAt > CodeExpiration)
            return false;

        var now = DateTime.UtcNow;
        displayToSession[displayId] = entry.SessionId;
        displayPairedAt[displayId] = now;
        displayLastActivity[displayId] = now;
        if (displayName is not null)
            displayToName[displayId] = displayName;
        DisplayPaired?.Invoke(displayId);
        return true;
    }

    public bool PairDisplay(string code, string sessionId, string? name = null)
    {
        if (!pairingCodes.TryRemove(code, out var entry))
            return false;

        if (DateTime.UtcNow - entry.CreatedAt > CodeExpiration)
            return false;

        var now = DateTime.UtcNow;
        displayToSession[entry.DisplayId] = sessionId;
        displayPairedAt[entry.DisplayId] = now;
        displayLastActivity[entry.DisplayId] = now;
        displayToCode.TryRemove(entry.DisplayId, out _);
        if (name is not null)
            displayToName[entry.DisplayId] = name;
        DisplayPaired?.Invoke(entry.DisplayId);
        return true;
    }

    public void TouchDisplay(string displayId)
    {
        if (displayToSession.ContainsKey(displayId))
            displayLastActivity[displayId] = DateTime.UtcNow;

        CleanupIdleDisplays();
    }

    public string? GetSessionForDisplay(string displayId)
    {
        return displayToSession.GetValueOrDefault(displayId);
    }

    public void UnpairDisplay(string displayId)
    {
        displayToSession.TryRemove(displayId, out _);
        displayLastActivity.TryRemove(displayId, out _);
        if (displayToCode.TryRemove(displayId, out var code))
            pairingCodes.TryRemove(code, out _);
        DisplayUnpaired?.Invoke(displayId);
    }

    public int GetConnectedDisplayCount(string sessionId)
    {
        return displayToSession.Values.Count(s => s == sessionId);
    }

    public List<ConnectedDisplay> GetConnectedDisplays(string sessionId)
    {
        return displayToSession
            .Where(kvp => kvp.Value == sessionId)
            .Select(kvp => new ConnectedDisplay(kvp.Key, displayToName.GetValueOrDefault(kvp.Key) ?? kvp.Key[..6]))
            .OrderBy(d => displayPairedAt.GetValueOrDefault(d.DisplayId))
            .ToList();
    }

    public string GetDisplayName(string displayId)
    {
        return displayToName.GetValueOrDefault(displayId) ?? displayId[..6];
    }

    public void EnableDisplay(string displayId, string sessionId, string? displayName = null)
    {
        var now = DateTime.UtcNow;
        displayToSession[displayId] = sessionId;
        displayPairedAt[displayId] = now;
        displayLastActivity[displayId] = now;
        if (displayName is not null)
            displayToName[displayId] = displayName;
        DisplayPaired?.Invoke(displayId);
    }

    public void DisableDisplay(string displayId, string sessionId)
    {
        // Only the owning session may disable the binding. Prevents a stale UI in
        // session B from accidentally removing a binding that just moved to session A.
        if (!displayToSession.TryGetValue(displayId, out var owner) || owner != sessionId)
            return;

        if (displayToSession.TryRemove(displayId, out _))
        {
            displayPairedAt.TryRemove(displayId, out _);
            displayLastActivity.TryRemove(displayId, out _);
            DisplayUnpaired?.Invoke(displayId);
        }
    }

    public bool IsDisplayConnected(string displayId)
    {
        return displayToSession.ContainsKey(displayId);
    }

    public bool IsDisplayConnectedToSession(string displayId, string sessionId)
    {
        return displayToSession.TryGetValue(displayId, out var owner) && owner == sessionId;
    }

    public bool IsDisplayOnline(string displayId)
    {
        return onlineDisplays.ContainsKey(displayId);
    }

    public void RegisterDisplayOnline(string displayId)
    {
        onlineDisplays[displayId] = 0;
        DisplayCameOnline?.Invoke(displayId);
    }

    public void UnregisterDisplayOnline(string displayId)
    {
        if (onlineDisplays.TryRemove(displayId, out _))
        {
            // A physically offline display has no calling session — this is a
            // legitimate force-removal that bypasses the ownership check.
            if (displayToSession.TryRemove(displayId, out _))
            {
                displayPairedAt.TryRemove(displayId, out _);
                displayLastActivity.TryRemove(displayId, out _);
                DisplayUnpaired?.Invoke(displayId);
            }
            DisplayWentOffline?.Invoke(displayId);
        }
    }


    public void DisconnectDisplay(string displayId)
    {
        if (displayToSession.TryRemove(displayId, out _))
        {
            displayToName.TryRemove(displayId, out _);
            displayPairedAt.TryRemove(displayId, out _);
            displayLastActivity.TryRemove(displayId, out _);
            DisplayUnpaired?.Invoke(displayId);
        }
    }

    public void CleanupIdleDisplays()
    {
        var now = DateTime.UtcNow;
        foreach (var (displayId, lastActivity) in displayLastActivity)
        {
            if (now - lastActivity > IdleTimeout && displayToSession.ContainsKey(displayId))
                DisconnectDisplay(displayId);
        }
    }

    private void CleanupExpiredCodes()
    {
        var now = DateTime.UtcNow;
        foreach (var (code, entry) in pairingCodes)
        {
            if (now - entry.CreatedAt > CodeExpiration)
            {
                pairingCodes.TryRemove(code, out _);
                displayToCode.TryRemove(entry.DisplayId, out _);
            }
        }
    }

    private void CleanupExpiredTokens()
    {
        var now = DateTime.UtcNow;
        foreach (var (token, entry) in pairingTokens)
        {
            if (now - entry.CreatedAt > CodeExpiration)
                pairingTokens.TryRemove(token, out _);
        }
    }
}
