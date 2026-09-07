using GospelPresenter.Shared.Contexts;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Diagnostics.HealthChecks;

namespace GospelPresenter.Web.Health;

/// <summary>
/// Readiness means the database answers. Before this, /health/ready filtered every check out and
/// returned Healthy unconditionally — a probe that a dead database could not fail.
/// </summary>
public sealed class DatabaseHealthCheck(IDbContextFactory<PresentationContext> contextFactory) : IHealthCheck
{
    public const string ReadyTag = "ready";

    public async Task<HealthCheckResult> CheckHealthAsync(HealthCheckContext context, CancellationToken cancellationToken = default)
    {
        try
        {
            await using var db = await contextFactory.CreateDbContextAsync(cancellationToken);
            return await db.Database.CanConnectAsync(cancellationToken)
                ? HealthCheckResult.Healthy()
                : HealthCheckResult.Unhealthy("The database did not accept a connection.");
        }
        catch (Exception e) when (e is not OperationCanceledException)
        {
            return HealthCheckResult.Unhealthy("The database is unreachable.", e);
        }
    }
}
