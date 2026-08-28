using GospelPresenter.Client.Sync;

namespace GospelPresenter.Services;

/// <summary>The sync scheduler's view of the device's network state.</summary>
public class MauiConnectivityMonitor : IConnectivityMonitor, IDisposable
{
    public MauiConnectivityMonitor()
    {
        Connectivity.Current.ConnectivityChanged += OnConnectivityChanged;
    }

    public bool IsOnline => Connectivity.Current.NetworkAccess == NetworkAccess.Internet;

    public event Action? Changed;

    private void OnConnectivityChanged(object? sender, ConnectivityChangedEventArgs e) => Changed?.Invoke();

    public void Dispose()
    {
        Connectivity.Current.ConnectivityChanged -= OnConnectivityChanged;
    }
}
