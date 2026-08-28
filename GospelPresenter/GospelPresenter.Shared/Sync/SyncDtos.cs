using System.Text.Json.Serialization;
using GospelPresenter.Shared.Models;

namespace GospelPresenter.Shared.Sync;

// The wire contract between the server's sync endpoints and the MAUI client. Rows are flat —
// one DTO per table row, ordered by (ModifiedAt, Id) — and the client applies them as idempotent
// upserts keyed by Id, so re-serving a row (the pull overlap window does this on purpose) is
// harmless. Tombstones arrive last; applying one cascades to children by foreign key and nulls
// dangling SET NULL references (DbSongPart.LabelId, Presentation.ThemeId), mirroring what the
// server database did without tombstoning each child.

public record SyncPullRequest(
    DateTimeOffset? Since,
    string? Cursor,
    int Take = SyncDefaults.MaxPullTake);

public record SyncPullResponse(
    DateTimeOffset ServerWatermark,
    bool RequiresFullResync,
    bool HasMore,
    string? NextCursor,
    SyncChanges Changes,
    List<SyncTombstoneDto> Tombstones);

public static class SyncDefaults
{
    public const int MaxPullTake = 500;

    /// <summary>
    /// The pull window is widened backwards by this much so rows committed around the previous
    /// watermark cannot fall between two pulls. Duplicates are harmless: the client upserts by Id.
    /// </summary>
    public static readonly TimeSpan PullOverlap = TimeSpan.FromSeconds(10);

    /// <summary>
    /// Clients whose watermark predates the tombstone purge horizon can no longer learn about
    /// every deletion incrementally and must full-resync. The margin keeps a watermark issued
    /// just before a purge run valid.
    /// </summary>
    public static readonly TimeSpan FullResyncHorizon = SyncTombstone.Retention - TimeSpan.FromDays(5);
}

public class SyncChanges
{
    public List<SyncSongPartLabelDto> SongPartLabels { get; set; } = [];
    public List<SyncSongDto> Songs { get; set; } = [];
    public List<SyncSongPartDto> SongParts { get; set; } = [];
    public List<SyncSongArrangementDto> SongArrangements { get; set; } = [];
    public List<SyncSongVersionDto> SongVersions { get; set; } = [];
    public List<SyncPresentationDto> Presentations { get; set; } = [];
    public List<SyncPresentationItemDto> PresentationItems { get; set; } = [];
    public List<SyncPresentationItemPartDto> PresentationItemParts { get; set; } = [];
    public List<SyncPresentationSlidesDto> PresentationSlides { get; set; } = [];
    public List<SyncThemeDto> Themes { get; set; } = [];
    public List<SyncOverlaySlideDto> OverlaySlides { get; set; } = [];
    public List<SyncOrganizationImageDto> OrganizationImages { get; set; } = [];
    public List<SyncOrganizationAudioDto> OrganizationAudios { get; set; } = [];
    public List<SyncOrganizationSettingDto> OrganizationSettings { get; set; } = [];
    public List<SyncUserSettingDto> UserSettings { get; set; } = [];
    public List<SyncBibleDto> Bibles { get; set; } = [];
}

public record SyncSongPartLabelDto(string Id, string Text, string Color, int SortOrder, DateTimeOffset ModifiedAt) : ISyncRow;

public record SyncSongDto(
    string Id, string Name, string? Author, string? Publisher, int? Year, string? Ccli,
    DateTime? DeletedAt, DateTimeOffset ModifiedAt) : ISyncRow;

public record SyncSongPartDto(string Id, string? LabelId, string Content, int SortOrder, string SongId, DateTimeOffset ModifiedAt) : ISyncRow;

public record SyncSongArrangementDto(string Id, string? Name, string PartIdsJson, string SongId, DateTimeOffset ModifiedAt) : ISyncRow;

public record SyncSongVersionDto(
    string Id, string SongId, DateTime CreatedAt, string Name, string? Author, string PartsJson,
    DateTimeOffset ModifiedAt) : ISyncRow;

public record SyncPresentationDto(
    string Id, string Name, DateTimeOffset CreatedAt, string CreatedBy,
    DateTimeOffset UpdatedAt, string UpdatedBy, bool IsTemplate, string? Description,
    DateTimeOffset? LastUsedAt, int UseCount, int? ScheduledDayOfWeek, TimeOnly? ScheduledTime,
    DateOnly? EventDate, TimeOnly? EventTime, string? EventLocation, string? ThemeId,
    DateTimeOffset ModifiedAt) : ISyncRow;

public record SyncPresentationItemDto(
    string Id, string? SourceId, PresentationItemType Type, string Title, string? ArrangementId,
    int SortOrder, string PresentationId, DateTimeOffset ModifiedAt) : ISyncRow;

public record SyncPresentationItemPartDto(
    string Id, string Content, int SortOrder, string PresentationItemId, DateTimeOffset ModifiedAt) : ISyncRow;

public record SyncPresentationSlidesDto(
    string Id, string FileName, int PageCount, DateTimeOffset CreatedAt, string PresentationId,
    DateTimeOffset ModifiedAt) : ISyncRow;

/// <summary>
/// The definition travels as the same JSON the column stores (enums as names), so both sides
/// deserialize with the shared SlideTheme converter options. OrganizationId is carried because
/// built-in themes (null) sync to every client alongside the organisation's own.
/// </summary>
public record SyncThemeDto(
    string Id, string? OrganizationId, string Name, int SortOrder, string DefinitionJson,
    DateTimeOffset ModifiedAt) : ISyncRow;

public record SyncOverlaySlideDto(
    string Id, string Title, string? Content, bool HasImage, int SortOrder, DateTimeOffset ModifiedAt) : ISyncRow;

public record SyncOrganizationImageDto(
    string Id, string FileName, string ContentType, DateTimeOffset CreatedAt, DateTimeOffset ModifiedAt) : ISyncRow;

public record SyncOrganizationAudioDto(
    string Id, string FileName, string ContentType, DateTimeOffset CreatedAt, DateTimeOffset ModifiedAt) : ISyncRow;

public record SyncOrganizationSettingDto(string Id, string Key, string Value, DateTimeOffset ModifiedAt) : ISyncRow;

public record SyncUserSettingDto(string Id, string Key, string Value, DateTimeOffset ModifiedAt) : ISyncRow;

/// <summary>Metadata only — the multi-megabyte VersesJson is downloaded separately, per pinned translation.</summary>
public record SyncBibleDto(
    string Id, string Name, string Abbreviation, int VerseCount, DateTimeOffset ModifiedAt) : ISyncRow;

public record SyncTombstoneDto(string EntityType, string EntityId, DateTimeOffset DeletedAt);

/// <summary>What keyset paging needs from every row DTO: identity and the sync watermark column.</summary>
public interface ISyncRow
{
    string Id { get; }
    DateTimeOffset ModifiedAt { get; }
}

// --- Push ---
//
// Pull is flat, push is aggregate-shaped for songs and presentations: the agreed conflict policies
// operate on whole aggregates ("server wins, the losing presentation becomes a copy"), so the
// server needs the client's complete picture of the aggregate, not a row diff. BaseModifiedAt is
// the server ModifiedAt of the aggregate root as the client last pulled it — null means the client
// created the row offline. The server compares it with the current root: equal applies, different
// runs the conflict policy. Child rows are never compared individually.

public class SyncPushRequest
{
    /// <summary>Shown in conflict logging; not used for auth.</summary>
    public string? DeviceName { get; set; }

    public List<SyncRowPush<SyncSongPartLabelDto>> SongPartLabels { get; set; } = [];
    public List<SyncSongPush> Songs { get; set; } = [];
    public List<SyncRowPush<SyncOrganizationImageDto>> OrganizationImages { get; set; } = [];
    public List<SyncRowPush<SyncOrganizationAudioDto>> OrganizationAudios { get; set; } = [];
    public List<SyncRowPush<SyncOverlaySlideDto>> OverlaySlides { get; set; } = [];
    public List<SyncPresentationPush> Presentations { get; set; } = [];
    public List<SyncRowPush<SyncOrganizationSettingDto>> OrganizationSettings { get; set; } = [];
    public List<SyncRowPush<SyncUserSettingDto>> UserSettings { get; set; } = [];
    public List<SyncDeletePush> Deletes { get; set; } = [];
}

public record SyncRowPush<TRow>(TRow Row, DateTimeOffset? BaseModifiedAt) where TRow : ISyncRow;

public record SyncSongPush(
    SyncSongDto Song,
    List<SyncSongPartDto> Parts,
    List<SyncSongArrangementDto> Arrangements,
    DateTimeOffset? BaseModifiedAt);

public record SyncPresentationPush(
    SyncPresentationDto Presentation,
    List<SyncPresentationItemDto> Items,
    List<SyncPresentationItemPartDto> Parts,
    List<SyncPresentationSlidesDto> SlideDecks,
    DateTimeOffset? BaseModifiedAt);

public record SyncDeletePush(string EntityType, string Id, DateTimeOffset? BaseModifiedAt);

public record SyncPushResponse(List<SyncPushResult> Results);

/// <summary>
/// NewId: for CopiedAsNew the server-side copy, for Remapped the surviving server row.
/// NewModifiedAt: on Applied (and Remapped) upserts, the row's server ModifiedAt after the save —
/// the client stores it as the row's new conflict base, so edits made while the push was in flight
/// push cleanly instead of reporting a false conflict.
/// </summary>
public record SyncPushResult(
    string EntityType,
    string Id,
    SyncPushOutcome Outcome,
    string? NewId = null,
    string? Warning = null,
    DateTimeOffset? NewModifiedAt = null);

[JsonConverter(typeof(JsonStringEnumConverter<SyncPushOutcome>))]
public enum SyncPushOutcome
{
    /// <summary>The client's version was applied as-is.</summary>
    Applied,

    /// <summary>The server's version stands; for songs the pushed state went into version history.</summary>
    ServerWins,

    /// <summary>The server's presentation stands and the pushed one was saved as a new copy (NewId).</summary>
    CopiedAsNew,

    /// <summary>The pushed row collided with an existing equivalent (same label text, same setting key); references should point at NewId.</summary>
    Remapped,

    /// <summary>The push of this aggregate failed validation and was rolled back; see Warning.</summary>
    Failed,
}
