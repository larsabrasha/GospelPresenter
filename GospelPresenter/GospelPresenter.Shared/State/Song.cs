namespace GospelPresenter.Shared.State;

public record SongPart(string? Label, string Content)
{
    public string? LabelColor => Label?.ToUpperInvariant() switch
    {
        null => null,
        var l when l.Contains("VERSE") || l.Contains("VERS") => "#6ba3e8",
        var l when l.Contains("CHORUS") || l.Contains("REFRÄNG") || l.Contains("REFRANG") => "#e8a06b",
        var l when l.Contains("BRIDGE") || l.Contains("BRYGGA") => "#a06be8",
        var l when l.Contains("PRE-CHORUS") || l.Contains("PRE CHORUS") => "#e86bb5",
        var l when l.Contains("TAG") || l.Contains("OUTRO") || l.Contains("ENDING") => "#6be8a0",
        var l when l.Contains("INTRO") => "#e8e86b",
        _ => "#a0a0a0"
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
