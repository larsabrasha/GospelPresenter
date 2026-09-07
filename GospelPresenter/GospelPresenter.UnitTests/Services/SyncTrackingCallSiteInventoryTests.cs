using System.Text.RegularExpressions;
using Shouldly;

namespace GospelPresenter.UnitTests.Services;

/// <summary>
/// Every ExecuteUpdateAsync / ExecuteDeleteAsync in the server-side code, by file and method, against
/// a list of the ones that have been looked at. SyncTrackingCallSiteTests pins the behaviour of the
/// call sites it knows about; it cannot see one it does not know about, and the audit found three
/// that had slipped past it that way. This test scans the source, so a new bypass of the change
/// tracker fails here until somebody adds it to the list — and, per CLAUDE.md, a pinning test.
///
/// The list is also required to be exact: an entry for a call site that no longer exists fails too,
/// so the inventory cannot quietly go stale in either direction.
/// </summary>
public class SyncTrackingCallSiteInventoryTests
{
    /// <summary>
    /// file::method — what each one does about sync tracking. "n/a" means the entity is not
    /// ISyncTracked and needs neither stamp nor tombstone.
    /// </summary>
    private static readonly Dictionary<string, string> Approved = new()
    {
        ["GospelPresenter.Shared/Services/BibleService.cs::DeleteBibleAsync"] = "tombstone in the same transaction; pinned",
        ["GospelPresenter.Shared/Services/BibleService.cs::ImportBibleAsync"] = "replace path stamps ModifiedAt",
        ["GospelPresenter.Shared/Services/CcliReportService.cs::SetReportedBatchAsync"] = "n/a: CcliReportEntry",
        ["GospelPresenter.Shared/Services/PresentationService.cs::BumpPresentationAsync"] = "stamps ModifiedAt; every caller announces after commit; pinned",
        ["GospelPresenter.Shared/Services/PresentationService.cs::PurgeAsync"] = "tombstones in the same transaction; pinned",
        ["GospelPresenter.Shared/Services/PresentationService.cs::RemoveItemAsync"] = "tombstones in the same transaction; pinned",
        ["GospelPresenter.Shared/Services/PresentationService.cs::RemoveItemsAsync"] = "tombstones in the same transaction; pinned",
        ["GospelPresenter.Shared/Services/PresentationService.cs::RenameItemAsync"] = "stamps ModifiedAt and bumps the root; pinned",
        ["GospelPresenter.Shared/Services/PresentationService.cs::RenamePresentationAsync"] = "stamps ModifiedAt; pinned",
        ["GospelPresenter.Shared/Services/PresentationService.cs::UpdateItemArrangementAsync"] = "stamps ModifiedAt and bumps the root; pinned",
        ["GospelPresenter.Shared/Services/PresentationService.cs::UpdatePresentationEventAsync"] = "stamps ModifiedAt; pinned",
        ["GospelPresenter.Shared/Services/PresentationService.cs::UpdatePresentationThemeAsync"] = "stamps ModifiedAt; pinned",
        ["GospelPresenter.Shared/Services/PresentationService.cs::UpdateTemplateScheduleAsync"] = "stamps ModifiedAt; pinned",
        ["GospelPresenter.Shared/Services/PresentationSlidesService.cs::AddSlidesAsync"] = "stamps ModifiedAt and announces; pinned",
        ["GospelPresenter.Shared/Services/RemoteDisplayService.cs::UpdateDisplayAsync"] = "stamps ModifiedAt and announces; pinned",
        ["GospelPresenter.Shared/Services/SongPartLabelService.cs::DeleteLabelAsync"] = "detaches parts with ModifiedAt stamped and bumps their songs; pinned",
        ["GospelPresenter.Shared/Services/UserService.cs::DeleteCalendarSubscriptionAsync"] = "n/a: CalendarSubscription",
        ["GospelPresenter.Shared/Services/UserService.cs::DeleteInviteAsync"] = "n/a: Invite",
        ["GospelPresenter.Shared/Services/UserService.cs::DeleteLoginAsync"] = "n/a: UserLogin",
        ["GospelPresenter.Shared/Services/UserService.cs::DeleteMcpApiKeyAsync"] = "n/a: McpApiKey",
        ["GospelPresenter.Shared/Services/UserService.cs::DeleteOrganizationAsync"] = "tombstones for every synced root before the cascade; tested in UserServiceTests",
        ["GospelPresenter.Shared/Services/UserService.cs::DeleteUserAsync"] = "tombstones for the user's settings before the cascade; tested in UserServiceTests",
        ["GospelPresenter.Shared/Services/UserService.cs::MarkInviteUsedAsync"] = "n/a: Invite",
        ["GospelPresenter.Shared/Services/UserService.cs::TouchCalendarSubscriptionAsync"] = "n/a: CalendarSubscription",
        ["GospelPresenter.Shared/Services/UserService.cs::UpdateEmailIfEmptyAsync"] = "n/a: User",
        ["GospelPresenter.Shared/Services/UserService.cs::UpdateOrganizationAsync"] = "n/a: Organization",
        ["GospelPresenter.Shared/Services/UserService.cs::UpdateOrganizationLogoAsync"] = "n/a: Organization",
        ["GospelPresenter.Shared/Services/UserService.cs::UpdateProfileImageAsync"] = "n/a: User",
        ["GospelPresenter.Shared/Services/UserService.cs::UpdateUserAsync"] = "n/a: User",
        ["GospelPresenter.Web/Auth/DeviceTokenAuthenticationHandler.cs::HandleAuthenticateAsync"] = "n/a: DeviceToken (LastUsedAt); explained at the call site",
        ["GospelPresenter.Web/Services/SyncMaintenanceBackgroundService.cs::ExecuteAsync"] = "the tombstone purge itself",
    };

    private static readonly string[] ScannedProjects = ["GospelPresenter.Shared", "GospelPresenter.Web"];

    private static readonly Regex CallSite = new(@"\bExecute(Update|Delete)Async\s*\(", RegexOptions.Compiled);

    // A member declaration line: an access modifier, then anything but the tokens that end a
    // statement, then the name and an opening parenthesis.
    private static readonly Regex MemberDeclaration = new(
        @"^\s*(?:public|private|protected|internal)[^=;{]*?\s([A-Za-z_][A-Za-z0-9_]*)\s*(?:<[^>]*>)?\s*\(",
        RegexOptions.Compiled);

    [Fact]
    public void EveryChangeTrackerBypass_IsOnTheApprovedList_AndTheListIsExact()
    {
        var found = Inventory().ToHashSet();
        var approved = Approved.Keys.ToHashSet();

        var unlisted = found.Except(approved).Order().ToList();
        var stale = approved.Except(found).Order().ToList();

        unlisted.ShouldBeEmpty(
            "new ExecuteUpdateAsync/ExecuteDeleteAsync call sites. Each bypasses the change tracker: an update " +
            "of an ISyncTracked entity must SetProperty ModifiedAt, a delete must AddTombstones in the same " +
            "transaction, and the aggregate root must be bumped (see CLAUDE.md, Offline sync tracking). " +
            "Add a pinning test in SyncTrackingCallSiteTests, then add the site here with what it does:\n  " +
            string.Join("\n  ", unlisted));
        stale.ShouldBeEmpty("listed call sites that no longer exist; remove them:\n  " + string.Join("\n  ", stale));
    }

    private static IEnumerable<string> Inventory()
    {
        var root = RepositoryRoot();
        foreach (var project in ScannedProjects)
        {
            var directory = Path.Combine(root, project);
            foreach (var file in Directory.EnumerateFiles(directory, "*.cs", SearchOption.AllDirectories))
            {
                var relative = Path.GetRelativePath(root, file).Replace('\\', '/');
                if (relative.Contains("/Migrations/") || relative.Contains("/bin/") || relative.Contains("/obj/"))
                    continue;

                var lines = File.ReadAllLines(file);
                for (var i = 0; i < lines.Length; i++)
                {
                    if (!CallSite.IsMatch(lines[i]) || lines[i].TrimStart().StartsWith("//"))
                        continue;
                    yield return $"{relative}::{EnclosingMember(lines, i)}";
                }
            }
        }
    }

    private static string EnclosingMember(string[] lines, int index)
    {
        for (var i = index; i >= 0; i--)
        {
            var trimmed = lines[i].TrimStart();
            if (trimmed.StartsWith("//") || trimmed.StartsWith("if") || trimmed.StartsWith("return") ||
                trimmed.StartsWith("var ") || trimmed.StartsWith("await") || trimmed.StartsWith("foreach"))
                continue;
            var match = MemberDeclaration.Match(lines[i]);
            if (match.Success) return match.Groups[1].Value;
        }
        return "?";
    }

    /// <summary>The directory holding GospelPresenter.sln, found from the test binary upwards.</summary>
    private static string RepositoryRoot()
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);
        while (directory is not null && !File.Exists(Path.Combine(directory.FullName, "GospelPresenter.sln")))
            directory = directory.Parent;
        return directory?.FullName ?? throw new InvalidOperationException("GospelPresenter.sln was not found above the test binary.");
    }
}
