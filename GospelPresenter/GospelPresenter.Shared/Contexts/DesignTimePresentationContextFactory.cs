using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace GospelPresenter.Shared.Contexts;

public class DesignTimePresentationContextFactory : IDesignTimeDbContextFactory<PresentationContext>
{
    public PresentationContext CreateDbContext(string[] args)
    {
        var optionsBuilder = new DbContextOptionsBuilder<PresentationContext>();
        optionsBuilder.UseNpgsql("Host=localhost;Database=gospel_presenter_design");
        return new PresentationContext(optionsBuilder.Options);
    }
}
