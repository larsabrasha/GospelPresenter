namespace GospelPresenter.Shared.Models;

/// <summary>
/// The one way to say "rows that are not in the trash", for every entity that has a trash.
///
/// Soft deletion is not enforced by a global query filter, for two reasons. The client's pull
/// applier upserts rows by id and would create a duplicate key for every row a filter hid from it,
/// and the sync pull has to deliver trashed rows so that every device shows the same trash — so
/// both would have to opt out again with IgnoreQueryFilters, and a forgotten opt-out there fails
/// silently in the direction of losing data. Filtering explicitly fails the other way: a forgotten
/// call shows a trashed row, which is visible the moment anyone looks.
///
/// One overload per entity rather than a generic constrained to an interface: EF Core translates a
/// property access on the concrete entity type without argument, and this way there is nothing to
/// verify about how it handles interface-typed member expressions.
///
/// Named rather than inlined so that <c>grep NotDeleted</c> lists every read path at once, and so
/// that a new one is a single call rather than a predicate to get right.
/// </summary>
public static class TrashQueries
{
    /// <summary>Excludes presentations (or templates) that are in the trash.</summary>
    public static IQueryable<Presentation> NotDeleted(this IQueryable<Presentation> source) =>
        source.Where(x => x.DeletedAt == null);

    /// <summary>Keeps only the presentations (or templates) that are in the trash.</summary>
    public static IQueryable<Presentation> OnlyDeleted(this IQueryable<Presentation> source) =>
        source.Where(x => x.DeletedAt != null);

    /// <summary>Excludes images that are in the trash.</summary>
    public static IQueryable<OrganizationImage> NotDeleted(this IQueryable<OrganizationImage> source) =>
        source.Where(x => x.DeletedAt == null);

    /// <summary>Keeps only the images that are in the trash.</summary>
    public static IQueryable<OrganizationImage> OnlyDeleted(this IQueryable<OrganizationImage> source) =>
        source.Where(x => x.DeletedAt != null);

    /// <summary>Excludes audio files that are in the trash.</summary>
    public static IQueryable<OrganizationAudio> NotDeleted(this IQueryable<OrganizationAudio> source) =>
        source.Where(x => x.DeletedAt == null);

    /// <summary>Keeps only the audio files that are in the trash.</summary>
    public static IQueryable<OrganizationAudio> OnlyDeleted(this IQueryable<OrganizationAudio> source) =>
        source.Where(x => x.DeletedAt != null);
}
