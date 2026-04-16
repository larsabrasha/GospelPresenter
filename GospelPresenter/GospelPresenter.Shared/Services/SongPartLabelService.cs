using GospelPresenter.Shared.Contexts;
using GospelPresenter.Shared.Models;
using Microsoft.EntityFrameworkCore;

namespace GospelPresenter.Shared.Services;

public interface ISongPartLabelService
{
    Task<List<DbSongPartLabel>> GetLabelsAsync(string organizationId, CallerContext caller);
    Task<DbSongPartLabel> CreateLabelAsync(string organizationId, string text, string color, CallerContext caller);
    Task UpdateLabelAsync(string organizationId, string labelId, string text, string color, CallerContext caller);
    Task DeleteLabelAsync(string organizationId, string labelId, CallerContext caller);
    Task MoveLabelAsync(string organizationId, string labelId, int fromIndex, int toIndex, CallerContext caller);
    Task CreateDefaultLabelsAsync(string organizationId);
}

public class SongPartLabelService(
    IDbContextFactory<PresentationContext> dbContextFactory) : ISongPartLabelService
{
    public async Task<List<DbSongPartLabel>> GetLabelsAsync(string organizationId, CallerContext caller)
    {
        caller.RequirePermission(Permission.ViewSongs);
        caller.RequireOrganizationAccess(organizationId);

        await using var context = await dbContextFactory.CreateDbContextAsync();
        return await context.SongPartLabels
            .Where(l => l.OrganizationId == organizationId)
            .OrderBy(l => l.SortOrder)
            .ToListAsync();
    }

    public async Task<DbSongPartLabel> CreateLabelAsync(string organizationId, string text, string color, CallerContext caller)
    {
        caller.RequirePermission(Permission.ManageSongs);
        caller.RequireOrganizationAccess(organizationId);

        ValidationHelper.RequireMaxLength(text, AppConstraints.SongPartLabelTextMaxLength, "Text");
        ValidationHelper.RequireMaxLength(color, AppConstraints.SongPartLabelColorMaxLength, "Color");

        if (string.IsNullOrWhiteSpace(text))
            throw new ArgumentException("Label text cannot be empty.");

        await using var context = await dbContextFactory.CreateDbContextAsync();

        await ValidationHelper.RequireMaxCountAsync(
            context.SongPartLabels.Where(l => l.OrganizationId == organizationId),
            AppConstraints.MaxSongPartLabelsPerOrg, "labels");

        var exists = await context.SongPartLabels
            .AnyAsync(l => l.OrganizationId == organizationId && l.Text == text);
        if (exists)
            throw new InvalidOperationException($"A label with text \"{text}\" already exists.");

        var maxOrder = await context.SongPartLabels
            .Where(l => l.OrganizationId == organizationId)
            .MaxAsync(l => (int?)l.SortOrder) ?? -1;

        var label = new DbSongPartLabel
        {
            Text = text.Trim(),
            Color = color,
            SortOrder = maxOrder + 1,
            OrganizationId = organizationId
        };

        context.SongPartLabels.Add(label);
        await context.SaveChangesAsync();
        return label;
    }

    public async Task UpdateLabelAsync(string organizationId, string labelId, string text, string color, CallerContext caller)
    {
        caller.RequirePermission(Permission.ManageSongs);
        caller.RequireOrganizationAccess(organizationId);

        ValidationHelper.RequireMaxLength(text, AppConstraints.SongPartLabelTextMaxLength, "Text");
        ValidationHelper.RequireMaxLength(color, AppConstraints.SongPartLabelColorMaxLength, "Color");

        if (string.IsNullOrWhiteSpace(text))
            throw new ArgumentException("Label text cannot be empty.");

        await using var context = await dbContextFactory.CreateDbContextAsync();

        var label = await context.SongPartLabels
            .FirstOrDefaultAsync(l => l.Id == labelId && l.OrganizationId == organizationId);
        if (label is null) return;

        // Check uniqueness if text changed
        if (!string.Equals(label.Text, text, StringComparison.Ordinal))
        {
            var exists = await context.SongPartLabels
                .AnyAsync(l => l.OrganizationId == organizationId && l.Text == text && l.Id != labelId);
            if (exists)
                throw new InvalidOperationException($"A label with text \"{text}\" already exists.");
        }

        label.Text = text.Trim();
        label.Color = color;
        await context.SaveChangesAsync();
    }

    public async Task DeleteLabelAsync(string organizationId, string labelId, CallerContext caller)
    {
        caller.RequirePermission(Permission.ManageSongs);
        caller.RequireOrganizationAccess(organizationId);

        await using var context = await dbContextFactory.CreateDbContextAsync();

        var label = await context.SongPartLabels
            .FirstOrDefaultAsync(l => l.Id == labelId && l.OrganizationId == organizationId);
        if (label is null) return;

        context.SongPartLabels.Remove(label);
        await context.SaveChangesAsync();

        // Renumber remaining labels
        var remaining = await context.SongPartLabels
            .Where(l => l.OrganizationId == organizationId)
            .OrderBy(l => l.SortOrder)
            .ToListAsync();

        for (var i = 0; i < remaining.Count; i++)
            remaining[i].SortOrder = i;

        await context.SaveChangesAsync();
    }

    public async Task MoveLabelAsync(string organizationId, string labelId, int fromIndex, int toIndex, CallerContext caller)
    {
        caller.RequirePermission(Permission.ManageSongs);
        caller.RequireOrganizationAccess(organizationId);

        await using var context = await dbContextFactory.CreateDbContextAsync();

        var labels = await context.SongPartLabels
            .Where(l => l.OrganizationId == organizationId)
            .OrderBy(l => l.SortOrder)
            .ToListAsync();

        if (fromIndex < 0 || fromIndex >= labels.Count || toIndex < 0 || toIndex >= labels.Count || fromIndex == toIndex)
            return;

        var item = labels[fromIndex];
        if (item.Id != labelId) return;

        labels.RemoveAt(fromIndex);
        labels.Insert(toIndex, item);

        for (var i = 0; i < labels.Count; i++)
            labels[i].SortOrder = i;

        await context.SaveChangesAsync();
    }

    public async Task CreateDefaultLabelsAsync(string organizationId)
    {
        await using var context = await dbContextFactory.CreateDbContextAsync();

        var hasLabels = await context.SongPartLabels
            .AnyAsync(l => l.OrganizationId == organizationId);
        if (hasLabels) return;

        for (var i = 0; i < DefaultLabels.Length; i++)
        {
            var (text, color) = DefaultLabels[i];
            context.SongPartLabels.Add(new DbSongPartLabel
            {
                Text = text,
                Color = color,
                SortOrder = i,
                OrganizationId = organizationId
            });
        }

        await context.SaveChangesAsync();
    }

    private static readonly (string Text, string Color)[] DefaultLabels =
    [
        ("Verse", "#3478c7"),
        ("Verse 1", "#2e6ab8"),
        ("Verse 2", "#285da9"),
        ("Verse 3", "#22509a"),
        ("Verse 4", "#1c438b"),
        ("Verse 5", "#16367c"),
        ("Verse 6", "#10296d"),
        ("Chorus", "#c73448"),
        ("Chorus 1", "#b82e40"),
        ("Chorus 2", "#972738"),
        ("Chorus 3", "#7a2030"),
        ("Chorus 4", "#6b1c2a"),
        ("Bridge", "#7834c7"),
        ("Bridge 1", "#6b2eb8"),
        ("Bridge 2", "#5e28a9"),
        ("Bridge 3", "#4e2096"),
        ("PreChorus", "#c734a8"),
        ("Tag", "#c73434"),
        ("Intro", "#c7b834"),
        ("Ending", "#b8ad2e"),
        ("Outro", "#a9a228"),
        ("Interlude", "#34c734"),
        ("Vamp", "#34b834"),
        ("Turnaround", "#34a934"),
        ("Blank", "#1a1a1a"),
    ];
}
