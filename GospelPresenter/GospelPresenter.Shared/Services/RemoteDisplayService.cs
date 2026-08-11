using System.Security.Cryptography;
using GospelPresenter.Shared.Contexts;
using GospelPresenter.Shared.Models;
using Microsoft.EntityFrameworkCore;

namespace GospelPresenter.Shared.Services;

public interface IRemoteDisplayService
{
    Task<List<RemoteDisplay>> GetDisplaysAsync(string organizationId, CallerContext caller);

    Task<RemoteDisplay> AddDisplayAsync(string organizationId, string name, CallerContext caller,
        OutputKind kind = OutputKind.Screen);

    Task RemoveDisplayAsync(string organizationId, string id, CallerContext caller);
    Task UpdateDisplayAsync(string organizationId, string id, string name, CallerContext caller);

    /// <summary>
    /// Replaces the public identifier of an output. Used when a public QR code has been shared
    /// somewhere it does not belong — the only remedy available, since printed signs cannot be
    /// recalled. Returns the new identifier, or null if the output does not exist.
    /// </summary>
    Task<string?> RegenerateIdentifierAsync(string organizationId, string id, CallerContext caller);

    /// <summary>
    /// Resolves a public output by its identifier without any permission check. Used by the
    /// anonymous watch endpoints, which only ever get the identifier from the visitor's URL.
    /// </summary>
    Task<RemoteDisplay?> FindPublicOutputAsync(string displayIdentifier);
}

public class RemoteDisplayService(
    IDbContextFactory<PresentationContext> dbContextFactory) : IRemoteDisplayService
{
    // 30 unambiguous lowercase chars: skip i/l/o (look like 1/0) and 0/1.
    // Length 7 → 30^7 ≈ 22 billion combinations, which is short enough to type
    // and large enough that guessing IDs across organizations is impractical.
    private const string IdAlphabet = "abcdefghjkmnpqrstuvwxyz23456789";
    private const int IdLength = 7;
    private const int MaxIdRetries = 8;

    public async Task<List<RemoteDisplay>> GetDisplaysAsync(string organizationId, CallerContext caller)
    {
        caller.RequirePermission(Permission.ViewPresentations);
        caller.RequireOrganizationAccess(organizationId);

        await using var context = await dbContextFactory.CreateDbContextAsync();
        return await context.RemoteDisplays
            .Where(d => d.OrganizationId == organizationId)
            .OrderBy(d => d.CreatedAt)
            .ToListAsync();
    }

    public async Task<RemoteDisplay> AddDisplayAsync(string organizationId, string name, CallerContext caller,
        OutputKind kind = OutputKind.Screen)
    {
        caller.RequirePermission(Permission.ManageRemoteDisplays);
        caller.RequireOrganizationAccess(organizationId);

        await using var context = await dbContextFactory.CreateDbContextAsync();

        for (var attempt = 0; attempt < MaxIdRetries; attempt++)
        {
            var display = new RemoteDisplay
            {
                OrganizationId = organizationId,
                DisplayIdentifier = GenerateDisplayId(),
                Name = name,
                Kind = kind,
                CreatedAt = DateTimeOffset.UtcNow
            };

            context.RemoteDisplays.Add(display);
            try
            {
                await context.SaveChangesAsync();
                return display;
            }
            catch (DbUpdateException) when (attempt < MaxIdRetries - 1)
            {
                // Unique-index collision on DisplayIdentifier — discard the entry and retry.
                context.RemoteDisplays.Remove(display);
            }
        }

        throw new InvalidOperationException("Failed to generate a unique display ID after multiple attempts.");
    }

    private static string GenerateDisplayId()
    {
        Span<char> buffer = stackalloc char[IdLength];
        for (var i = 0; i < IdLength; i++)
            buffer[i] = IdAlphabet[RandomNumberGenerator.GetInt32(IdAlphabet.Length)];
        return new string(buffer);
    }

    public async Task RemoveDisplayAsync(string organizationId, string id, CallerContext caller)
    {
        caller.RequirePermission(Permission.ManageRemoteDisplays);
        caller.RequireOrganizationAccess(organizationId);

        await using var context = await dbContextFactory.CreateDbContextAsync();
        await context.RemoteDisplays
            .Where(d => d.Id == id && d.OrganizationId == organizationId)
            .ExecuteDeleteAsync();
    }

    public async Task UpdateDisplayAsync(string organizationId, string id, string name, CallerContext caller)
    {
        caller.RequirePermission(Permission.ManageRemoteDisplays);
        caller.RequireOrganizationAccess(organizationId);

        await using var context = await dbContextFactory.CreateDbContextAsync();
        await context.RemoteDisplays
            .Where(d => d.Id == id && d.OrganizationId == organizationId)
            .ExecuteUpdateAsync(s => s.SetProperty(d => d.Name, name));
    }

    public async Task<string?> RegenerateIdentifierAsync(string organizationId, string id, CallerContext caller)
    {
        caller.RequirePermission(Permission.ManageRemoteDisplays);
        caller.RequireOrganizationAccess(organizationId);

        await using var context = await dbContextFactory.CreateDbContextAsync();

        var display = await context.RemoteDisplays
            .FirstOrDefaultAsync(d => d.Id == id && d.OrganizationId == organizationId);
        if (display is null)
            return null;

        for (var attempt = 0; attempt < MaxIdRetries; attempt++)
        {
            display.DisplayIdentifier = GenerateDisplayId();
            try
            {
                await context.SaveChangesAsync();
                return display.DisplayIdentifier;
            }
            catch (DbUpdateException) when (attempt < MaxIdRetries - 1)
            {
                // Unique-index collision on DisplayIdentifier — try another identifier.
            }
        }

        throw new InvalidOperationException("Failed to generate a unique display ID after multiple attempts.");
    }

    public async Task<RemoteDisplay?> FindPublicOutputAsync(string displayIdentifier)
    {
        await using var context = await dbContextFactory.CreateDbContextAsync();
        return await context.RemoteDisplays
            .Include(d => d.Organization)
            .FirstOrDefaultAsync(d =>
                d.DisplayIdentifier == displayIdentifier && d.Kind == OutputKind.PublicQr);
    }
}
