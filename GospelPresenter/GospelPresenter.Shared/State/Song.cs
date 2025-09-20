namespace GospelPresenter.Shared.State;

public record Song(
    string Id,
    string Name,
    IList<string> Parts
);
