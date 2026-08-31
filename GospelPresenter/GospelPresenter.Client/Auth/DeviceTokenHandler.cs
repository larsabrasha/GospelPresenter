using System.Net.Http.Headers;
using GospelPresenter.Shared.Sync;

namespace GospelPresenter.Client.Auth;

/// <summary>
/// Adds the device token as a Bearer header on every API call the sync engine makes, and tells the
/// server what this installation is: its app version, for the admin device list, and the wire
/// contract it speaks, which the server's protocol floor is compared against.
///
/// Both ride here rather than in ClientSyncService because this handler already sits on every call
/// the sync HttpClient makes — pull, push, Bibles, CCLI and media alike — and the floor applies to
/// all of them. The version string is passed in rather than read here: this project has no MAUI
/// reference, the same reason ClientSyncService is handed the device name.
/// See adr/0002-app-distribution-and-updates.md (24)–(25).
/// </summary>
public class DeviceTokenHandler(DeviceAuthService auth, string appVersion) : DelegatingHandler
{
    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        if (auth.Token is { } token)
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);

        request.Headers.TryAddWithoutValidation(SyncProtocol.VersionHeader, appVersion);
        request.Headers.TryAddWithoutValidation(
            SyncProtocol.ProtocolHeader,
            SyncProtocol.Current.ToString());

        return base.SendAsync(request, cancellationToken);
    }
}
