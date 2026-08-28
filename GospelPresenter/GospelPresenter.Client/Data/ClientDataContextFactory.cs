using GospelPresenter.Shared.Contexts;
using Microsoft.EntityFrameworkCore;

namespace GospelPresenter.Client.Data;

/// <summary>
/// Hands out the client context under both identities: the shared domain services ask for
/// <c>IDbContextFactory&lt;PresentationContext&gt;</c> and transparently get the local SQLite
/// context; the sync engine asks for <c>IDbContextFactory&lt;ClientDataContext&gt;</c> when it
/// needs the client-only tables.
/// </summary>
public class ClientDataContextFactory(DbContextOptions<ClientDataContext> options)
    : IDbContextFactory<PresentationContext>, IDbContextFactory<ClientDataContext>
{
    public ClientDataContext CreateDbContext() => new(options);

    PresentationContext IDbContextFactory<PresentationContext>.CreateDbContext() => CreateDbContext();
}
