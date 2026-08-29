using System.Net.NetworkInformation;
using GospelPresenter.Client.Sync;

namespace GospelPresenter.Desktop.Services;

/// <summary>
/// Whether the machine has a network, for the sync scheduler to wake on. This answers "is there an
/// interface up", not "can the server be reached" — a captive portal or a server that is down both
/// read as online here. That is the same guarantee MAUI's Connectivity API gives, and the sync
/// engine already has to treat a failed request as ordinary rather than exceptional, so the weaker
/// signal costs nothing: it is a hint about when to retry, not a promise.
/// </summary>
public class DesktopConnectivityMonitor : IConnectivityMonitor, IDisposable
{
    public DesktopConnectivityMonitor()
    {
        NetworkChange.NetworkAvailabilityChanged += OnAvailabilityChanged;
    }

    public bool IsOnline => NetworkInterface.GetIsNetworkAvailable();

    public event Action? Changed;

    private void OnAvailabilityChanged(object? sender, NetworkAvailabilityEventArgs e) => Changed?.Invoke();

    public void Dispose() => NetworkChange.NetworkAvailabilityChanged -= OnAvailabilityChanged;
}
