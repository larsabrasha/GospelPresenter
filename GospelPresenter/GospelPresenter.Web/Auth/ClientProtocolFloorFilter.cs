using GospelPresenter.Shared.Sync;

namespace GospelPresenter.Web.Auth;

/// <summary>
/// Refuses sync calls from clients speaking a wire contract this server no longer serves, with
/// 426 Upgrade Required. See adr/0002-app-distribution-and-updates.md (25).
///
/// The alternative — promising indefinite backwards compatibility in a protocol still under
/// development — is a promise that gets broken as data corruption on a user's machine rather than
/// as an error message. Refusing the request is the loud failure.
///
/// A client with no <see cref="SyncProtocol.ProtocolHeader"/> at all passes: see
/// <see cref="SyncProtocol.Parse"/> for why.
/// </summary>
public class ClientProtocolFloorFilter(ILogger<ClientProtocolFloorFilter> logger) : IEndpointFilter
{
    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        var headers = context.HttpContext.Request.Headers;
        if (headers.TryGetValue(SyncProtocol.ProtocolHeader, out var raw))
        {
            var claimed = SyncProtocol.Parse(raw.FirstOrDefault());
            if (claimed < SyncProtocol.Minimum)
            {
                logger.LogInformation(
                    "Refused a sync call speaking protocol {Claimed}; this server serves {Minimum} and above",
                    claimed, SyncProtocol.Minimum);

                return Results.Json(
                    new
                    {
                        Error = "This version of the app is too old to sync with this server.",
                        ClientProtocol = claimed,
                        MinimumProtocol = SyncProtocol.Minimum,
                    },
                    statusCode: StatusCodes.Status426UpgradeRequired);
            }
        }

        return await next(context);
    }
}
