namespace GospelPresenter.Shared.State;

public record SongPart(string? Label, string Content)
{
    public string? LabelColor => Label?.ToUpperInvariant() switch
    {
        null => null,
        var l when l.Contains("VERSE") || l.Contains("VERS") => "#0284c7",
        var l when l.Contains("CHORUS") || l.Contains("REFRÄNG") || l.Contains("REFRANG") => "#e85d04",
        var l when l.Contains("BRIDGE") || l.Contains("BRYGGA") => "#7c3aed",
        var l when l.Contains("PRE-CHORUS") || l.Contains("PRE CHORUS") => "#db2777",
        var l when l.Contains("TAG") || l.Contains("OUTRO") || l.Contains("ENDING") => "#059669",
        var l when l.Contains("INTRO") => "#ca8a04",
        _ => "#6b7280"
    };
}

public record Song(
    string Id,
    string Name,
    string? Author,
    string? Publisher,
    int? Year,
    string? Ccli,
    IList<SongPart> Parts
);
