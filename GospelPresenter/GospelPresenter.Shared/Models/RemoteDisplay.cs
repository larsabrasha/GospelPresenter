namespace GospelPresenter.Shared.Models;

/// <summary>
/// The kind of output a <see cref="RemoteDisplay"/> represents. A Screen is a single device
/// (TV, projector) that reports itself online and is paired to a session. A PublicQr output is
/// a channel that any number of anonymous visitors can watch by scanning a QR code.
/// </summary>
public enum OutputKind
{
    Screen = 0,
    PublicQr = 1
}

/// <summary>
/// Synced, because the row is what makes an output reachable. A device owns its own presentation
/// but not the address a visitor scans: <c>/watch/{code}</c> is served by the server and resolved
/// against the server's database. An output created on a desktop with no row up there answered 404.
/// </summary>
public class RemoteDisplay : ISyncTracked
{
    public string Id { get; set; } = Guid.NewGuid().ToString();
    public string OrganizationId { get; set; } = "";
    public string DisplayIdentifier { get; set; } = "";
    public string Name { get; set; } = "";
    public OutputKind Kind { get; set; } = OutputKind.Screen;
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset ModifiedAt { get; set; }
    public long Version { get; set; }

    public Organization Organization { get; set; } = null!;
}
