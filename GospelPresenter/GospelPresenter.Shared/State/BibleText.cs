namespace GospelPresenter.Shared.State;

public record BibleText(
    string Id,
    string Title,
    IList<string> Parts
);
