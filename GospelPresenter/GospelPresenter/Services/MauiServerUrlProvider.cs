using GospelPresenter.Shared.Services;

namespace GospelPresenter.Services;

/// <summary>
/// Points every link this app hands to another device at the server rather than at the in-app host
/// the Blazor UI is served from, which no other device can reach. Null when no server is configured
/// — the standalone development build, which has nothing to point anyone at.
/// </summary>
public class MauiServerUrlProvider(string? apiBaseUrl) : IServerUrlProvider
{
    public string? GetServerUrl() => string.IsNullOrWhiteSpace(apiBaseUrl) ? null : apiBaseUrl;
}
