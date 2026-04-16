namespace GospelPresenter.Shared.State;

public record SongPart(string Id, string? LabelId, string? Label, string? LabelColor, string Content);

public record SongArrangement(string Id, string? Name, IList<string> PartIds);

public record Song(
    string Id,
    string Name,
    string? Author,
    string? Publisher,
    int? Year,
    string? Ccli,
    IList<SongPart> Parts,
    IList<SongArrangement> Arrangements,
    string OrganizationId = ""
)
{
    public IList<SongPart> GetArrangedParts(string? arrangementId)
    {
        if (arrangementId is null) return Parts;
        var arrangement = Arrangements.FirstOrDefault(a => a.Id == arrangementId);
        if (arrangement is null) return Parts;
        var partsById = Parts.ToDictionary(p => p.Id);
        return arrangement.PartIds
            .Where(id => partsById.ContainsKey(id))
            .Select(id => partsById[id])
            .ToList();
    }
};

public record SongAddRequest(Song Song, string? ArrangementId);
