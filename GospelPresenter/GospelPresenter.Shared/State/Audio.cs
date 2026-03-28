namespace GospelPresenter.Shared.State;

public record Audio(
    string Id,
    List<AudioPart> Parts
);

public record AudioPart(
    string PartId,
    string AudioId,
    string FileName,
    string Url
);
