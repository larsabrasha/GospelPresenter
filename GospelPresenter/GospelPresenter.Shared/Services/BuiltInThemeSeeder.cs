using GospelPresenter.Shared.Contexts;
using GospelPresenter.Shared.Models;
using Microsoft.EntityFrameworkCore;

namespace GospelPresenter.Shared.Services;

/// <summary>
/// Writes the themes from <see cref="BuiltInThemes"/> into the database. Idempotent, and called from
/// every path that can create a database: the migration service in production, the mock database
/// initializer in development, and the integration test fixture through the latter.
///
/// Built-in themes are live, so an existing row is overwritten with what the code says. Rows for
/// slugs no longer in the code are left alone — presentations may still point at them, and a theme
/// that vanished would leave those presentations falling back to Classic without warning.
/// </summary>
public static class BuiltInThemeSeeder
{
    public static async Task SeedAsync(PresentationContext context, CancellationToken cancellationToken = default)
    {
        var existing = await context.Themes
            .Where(t => t.OrganizationId == null)
            .ToDictionaryAsync(t => t.Id, cancellationToken);

        foreach (var builtIn in BuiltInThemes.All)
        {
            if (existing.TryGetValue(builtIn.Id, out var row))
            {
                row.SortOrder = builtIn.SortOrder;
                row.Definition = builtIn.Definition;
            }
            else
            {
                context.Themes.Add(new Theme
                {
                    Id = builtIn.Id,
                    OrganizationId = null,
                    Name = "",
                    SortOrder = builtIn.SortOrder,
                    Definition = builtIn.Definition
                });
            }
        }

        await context.SaveChangesAsync(cancellationToken);
    }
}
