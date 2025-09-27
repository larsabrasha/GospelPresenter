namespace GospelPresenter.Shared.State;

public record Song(
    string Id,
    string Name,
    string? Author,
    string? Publisher,
    int? Year,
    string? Ccli,
    IList<string> Parts
);
