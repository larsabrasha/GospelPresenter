namespace GospelPresenter.Shared.Components;

public enum InputVariant
{
    /// <summary>Filled pill on a neutral background. The form and dialog default.</summary>
    Filled,

    /// <summary>Outlined pill on the page background. What the search fields look like.</summary>
    Outlined,

    /// <summary>
    /// Outlined rectangle, for the fields that are not pills. No focus ring of its own —
    /// pass one through <c>Class</c>, since these fields do not agree on its colour.
    /// </summary>
    Box
}
