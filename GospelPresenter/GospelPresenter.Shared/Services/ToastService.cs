namespace GospelPresenter.Shared.Services;

public class ToastService
{
    public event Action<string>? OnShow;

    public void Show(string message)
    {
        OnShow?.Invoke(message);
    }
}
