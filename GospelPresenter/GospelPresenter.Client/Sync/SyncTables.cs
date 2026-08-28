using GospelPresenter.Client.Data;
using GospelPresenter.Shared.Models;

namespace GospelPresenter.Client.Sync;

/// <summary>An aggregate root as the sync engine addresses it: by table name and row id.</summary>
public readonly record struct RootRef(string Table, string Id);

/// <summary>
/// The mapping between local table names (what the journal triggers record), the entity type names
/// the wire protocol uses (tombstones and delete pushes carry CLR type names), and how child tables
/// resolve to their aggregate root.
/// </summary>
public static class SyncTables
{
    /// <summary>Tables whose rows are pushed as their own unit — aggregate roots and flat rows.</summary>
    public static readonly HashSet<string> RootTables =
    [
        "Presentations", "Songs", "SongPartLabels", "OverlaySlides",
        "OrganizationImages", "OrganizationAudios", "OrganizationSettings", "UserSettings",
    ];

    private static readonly Dictionary<string, string> TableToEntityType = new()
    {
        ["Presentations"] = nameof(Presentation),
        ["PresentationItems"] = nameof(PresentationItem),
        ["PresentationItemParts"] = nameof(PresentationItemPart),
        ["PresentationSlides"] = nameof(PresentationSlides),
        ["Songs"] = nameof(DbSong),
        ["SongParts"] = nameof(DbSongPart),
        ["SongVersions"] = nameof(DbSongVersion),
        ["SongArrangements"] = nameof(DbSongArrangement),
        ["SongPartLabels"] = nameof(DbSongPartLabel),
        ["OverlaySlides"] = nameof(OverlaySlide),
        ["OrganizationImages"] = nameof(OrganizationImage),
        ["OrganizationAudios"] = nameof(OrganizationAudio),
        ["OrganizationSettings"] = nameof(OrganizationSetting),
        ["UserSettings"] = nameof(UserSetting),
        ["Themes"] = nameof(Theme),
        ["Bibles"] = nameof(DbBible),
    };

    private static readonly Dictionary<string, string> EntityTypeToTable =
        TableToEntityType.ToDictionary(kv => kv.Value, kv => kv.Key);

    public static string EntityTypeFor(string table) => TableToEntityType[table];

    /// <summary>Null for entity types outside the synced set (they are simply ignored).</summary>
    public static string? TableForEntityType(string entityType) => EntityTypeToTable.GetValueOrDefault(entityType);

    /// <summary>
    /// Resolves every journal row to the aggregate root it belongs to. Children carry their parent
    /// id from the trigger; presentation item parts resolve through their item — found among the
    /// journal rows when the item was touched (or deleted) in the same batch, otherwise looked up
    /// live via <paramref name="lookUpItemParents"/>.
    /// </summary>
    public static async Task<HashSet<RootRef>> ResolveRootsAsync(
        IReadOnlyList<SyncJournalEntry> entries,
        Func<IReadOnlyList<string>, Task<Dictionary<string, string>>> lookUpItemParents)
    {
        var itemParents = new Dictionary<string, string>();
        foreach (var entry in entries)
        {
            if (entry.EntityTable == "PresentationItems" && entry.ParentId is not null)
                itemParents[entry.RowId] = entry.ParentId;
        }

        var unresolvedItemIds = entries
            .Where(e => e.EntityTable == "PresentationItemParts" && e.ParentId is not null)
            .Select(e => e.ParentId!)
            .Where(id => !itemParents.ContainsKey(id))
            .Distinct()
            .ToList();
        if (unresolvedItemIds.Count > 0)
        {
            foreach (var (itemId, presentationId) in await lookUpItemParents(unresolvedItemIds))
                itemParents[itemId] = presentationId;
        }

        var roots = new HashSet<RootRef>();
        foreach (var entry in entries)
        {
            switch (entry.EntityTable)
            {
                case var table when RootTables.Contains(table):
                    roots.Add(new RootRef(table, entry.RowId));
                    break;
                case "SongParts" or "SongArrangements" when entry.ParentId is not null:
                    roots.Add(new RootRef("Songs", entry.ParentId));
                    break;
                case "PresentationItems" or "PresentationSlides" when entry.ParentId is not null:
                    roots.Add(new RootRef("Presentations", entry.ParentId));
                    break;
                case "PresentationItemParts" when entry.ParentId is not null
                                                  && itemParents.TryGetValue(entry.ParentId, out var presentationId):
                    roots.Add(new RootRef("Presentations", presentationId));
                    break;
            }
        }

        return roots;
    }
}
