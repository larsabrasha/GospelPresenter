using System.ComponentModel.DataAnnotations.Schema;

namespace GospelPresenter.Shared.Models;

public class OverlaySlide : ISyncTracked
{
    public string Id { get; set; } = Guid.NewGuid().ToString();
    public string Title { get; set; } = "";
    public string? Content { get; set; }
    public bool HasImage { get; set; }
    public int SortOrder { get; set; }
    public DateTimeOffset ModifiedAt { get; set; }

    public long Version { get; set; }

    [NotMapped]
    public byte[]? ImageData { get; set; }

    [NotMapped]
    public string? ImageContentType { get; set; }

    public string OrganizationId { get; set; } = "";
    public Organization Organization { get; set; } = null!;
}
