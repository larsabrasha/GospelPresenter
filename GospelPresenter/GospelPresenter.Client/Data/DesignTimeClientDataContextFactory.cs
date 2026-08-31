using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace GospelPresenter.Client.Data;

/// <summary>
/// For `dotnet ef migrations add … --project GospelPresenter.Client` — never used at runtime.
/// </summary>
public class DesignTimeClientDataContextFactory : IDesignTimeDbContextFactory<ClientDataContext>
{
    public ClientDataContext CreateDbContext(string[] args)
    {
        var optionsBuilder = new DbContextOptionsBuilder<ClientDataContext>();
        optionsBuilder.UseSqlite("Data Source=gospelpresenter-design.db");
        return new ClientDataContext(optionsBuilder.Options);
    }
}
