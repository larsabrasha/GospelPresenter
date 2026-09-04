namespace GospelPresenter.Shared.Sync;

/// <summary>
/// The doorbell's wire surface, such as it is: one path and one method name, server to device only.
/// Kept here for the same reason as <c>LiveSessionHubMethods</c> — SignalR resolves these as strings
/// at runtime, so a rename that missed one end would show up as a method that is simply never
/// called.
///
/// There is deliberately nothing in the other direction. A device has nothing to tell this hub: what
/// it has to push goes over HTTP, and a hub with no callable methods cannot be asked for anything by
/// a client that should not be asking.
/// </summary>
public static class OrganizationChangesHubMethods
{
    public const string Path = "/hubs/organization-changes";

    /// <summary>Server → device. No arguments: see <see cref="OrganizationChange"/>.</summary>
    public const string OrganizationChanged = nameof(OrganizationChanged);
}
