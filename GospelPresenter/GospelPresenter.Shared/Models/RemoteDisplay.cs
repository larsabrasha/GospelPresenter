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

public class RemoteDisplay
{
    public string Id { get; set; } = Guid.NewGuid().ToString();
    public string OrganizationId { get; set; } = "";
    public string DisplayIdentifier { get; set; } = "";
    public string Name { get; set; } = "";
    public OutputKind Kind { get; set; } = OutputKind.Screen;
    public DateTimeOffset CreatedAt { get; set; }

    public Organization Organization { get; set; } = null!;
}
