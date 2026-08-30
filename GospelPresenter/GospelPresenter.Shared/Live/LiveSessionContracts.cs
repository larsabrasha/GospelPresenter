namespace GospelPresenter.Shared.Live;

/// <summary>
/// Everything a mirrored session is, as its owner describes it — a logical selection and nothing
/// rendered. The server rebuilds the slide from its own copy of the presentation, because the
/// rendered form differs between the two hosts: image URLs on the owner's machine point at its own
/// local media server, which no phone and no visitor can reach.
///
/// Absolute rather than incremental, so a message that arrives twice, out of order, or after a
/// reconnection lands the session in the same place as one that arrives once.
/// </summary>
/// <param name="ItemId">Null before anything has been selected — the presentation is live but blank.</param>
/// <param name="BlackScreen">The operator has blacked out the output. Separate from having no selection.</param>
public record MirroredSessionState(
    string PresentationId,
    string? PresentationName,
    bool RemoteControlEnabled,
    bool BlackScreen,
    string? ItemId,
    int? PartIndex,
    string? OverlayId);

/// <summary>
/// What a controller asks a mirrored session to show. The same shape as the state it will echo
/// back, minus everything the controller has no business deciding.
/// </summary>
public record MirroredSessionCommand(
    string? ItemId,
    int? PartIndex,
    bool BlackScreen,
    string? OverlayId);

/// <summary>
/// The names both ends address each other by. Kept here so a rename cannot silently break the
/// pairing — SignalR resolves these as strings at runtime, and a typo would only show up as a
/// method that is never called.
/// </summary>
public static class LiveSessionHubMethods
{
    public const string Path = "/hubs/live-session";

    // Owner → server
    public const string ReportState = nameof(ReportState);
    public const string EndSession = nameof(EndSession);

    // Server → owner
    public const string ApplyCommand = nameof(ApplyCommand);
}
