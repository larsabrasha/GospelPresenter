namespace GospelPresenter.Shared.Services;

/// <summary>
/// What a toast is telling the reader. Only the icon differs — a toast is still short-lived and
/// non-interactive either way, and anything that needs a decision belongs in a dialog.
/// </summary>
public enum ToastKind
{
    /// <summary>Something the user asked for happened. The default, and almost every toast.</summary>
    Success,

    /// <summary>
    /// Something did not go as asked, but nothing is broken and there is nothing to decide. A green
    /// tick on one of these reads as the opposite of what it says.
    /// </summary>
    Warning
}

public class ToastService
{
    public event Action<string, ToastKind>? OnShow;

    public void Show(string message, ToastKind kind = ToastKind.Success)
    {
        OnShow?.Invoke(message, kind);
    }
}
