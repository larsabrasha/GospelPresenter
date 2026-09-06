namespace GospelPresenter.Shared.Models;

public class OrganizationImage : ISyncTracked
{
    public string Id { get; set; } = Guid.NewGuid().ToString();
    public string FileName { get; set; } = "";
    public string ContentType { get; set; } = "image/jpeg";
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset ModifiedAt { get; set; }

    /// <summary>
    /// When the file was moved to the trash, or null while it is in the library. Soft deletion so a
    /// mis-click is recoverable: the bytes stay in object storage until the row is purged, which is
    /// also what keeps a presentation that already uses this file working while it sits in the
    /// trash. See <see cref="TrashQueries"/>.
    /// </summary>
    public DateTimeOffset? DeletedAt { get; set; }

    public long Version { get; set; }

    public string OrganizationId { get; set; } = "";
    public Organization Organization { get; set; } = null!;
}
