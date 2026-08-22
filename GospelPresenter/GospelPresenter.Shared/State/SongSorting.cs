namespace GospelPresenter.Shared.State;

/// <summary>
/// What /admin/songs can sort by. DbSong carries no CreatedAt or UpdatedAt, so "recently added" is
/// not on the list — see adr/0002-admin-list-pages.md for why we are not adding one.
/// </summary>
public enum SongSortOrder
{
    NameAsc,
    NameDesc,
    Author,
    Year
}

public static class SongSorting
{
    /// <summary>
    /// Orders songs for display. Author and Year are optional on a song, and a blank field says
    /// nothing about where the song belongs — so missing values sink to the bottom instead of
    /// clustering at the top and pushing the songs the user was looking for off the first screen.
    /// Name breaks every tie, so the order is stable rather than dependent on load order.
    /// </summary>
    public static IReadOnlyList<Song> Sort(this IEnumerable<Song> songs, SongSortOrder order) => order switch
    {
        SongSortOrder.NameDesc => songs
            .OrderByDescending(s => s.Name, StringComparer.CurrentCultureIgnoreCase)
            .ToList(),

        SongSortOrder.Author => songs
            .OrderBy(s => string.IsNullOrWhiteSpace(s.Author))
            .ThenBy(s => s.Author, StringComparer.CurrentCultureIgnoreCase)
            .ThenBy(s => s.Name, StringComparer.CurrentCultureIgnoreCase)
            .ToList(),

        SongSortOrder.Year => songs
            .OrderBy(s => s.Year is null)
            .ThenByDescending(s => s.Year)
            .ThenBy(s => s.Name, StringComparer.CurrentCultureIgnoreCase)
            .ToList(),

        _ => songs
            .OrderBy(s => s.Name, StringComparer.CurrentCultureIgnoreCase)
            .ToList()
    };
}
