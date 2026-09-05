namespace GospelPresenter.Shared.Services;

/// <summary>
/// One person with the app open, however many tabs they have.
/// </summary>
/// <param name="Tabs">
/// How many of their browser tabs are open on it. Shown rather than collapsed away because it is
/// the difference between one person and one person who has left the app open on three machines.
/// </param>
/// <param name="Since">When the oldest of those tabs connected.</param>
/// <param name="IsConnected">
/// False while every one of their tabs is out of touch. A dropped connection is kept for a few
/// minutes before the server gives up on it, so this is "their laptop just closed the lid", not
/// "they left" — and saying so is more honest than making the row vanish and reappear.
/// </param>
public record ConnectedUser(
    string UserId,
    string Name,
    string? OrganizationId,
    string Role,
    int Tabs,
    DateTimeOffset Since,
    bool IsConnected);

/// <summary>
/// Who is actually in the app right now.
///
/// There is no server-side record of a login to read: a signed-in user is a cookie, and a cookie
/// says nothing about whether anyone still has the page open. What can be observed is the Blazor
/// circuit — the live connection behind every interactive page — so that is what this counts, and
/// what the view built on it must be read as: people with the app open, not people who have ever
/// signed in.
///
/// Registered by the web host only. A device app is one person on one machine and knows that
/// without being told.
/// </summary>
public interface IConnectedUserDirectory
{
    /// <summary>Everyone with at least one circuit, most recently arrived last.</summary>
    IReadOnlyList<ConnectedUser> All();

    /// <summary>Raised when someone arrives, leaves, or drops off.</summary>
    event Action? Changed;
}
