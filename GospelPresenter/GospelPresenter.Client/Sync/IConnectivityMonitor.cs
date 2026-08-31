namespace GospelPresenter.Client.Sync;

/// <summary>The MAUI Connectivity API, behind a seam the scheduler (and its tests) can use.</summary>
public interface IConnectivityMonitor
{
    bool IsOnline { get; }
    event Action? Changed;
}
