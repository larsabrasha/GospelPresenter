namespace GospelPresenter.Shared.Components;

/// <summary>A key forwarded from the browser by <c>KeyFilter</c>, with its modifiers.</summary>
public readonly record struct FilteredKey(string Key, bool Shift, bool Ctrl, bool Meta);
