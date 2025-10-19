using GospelPresenter.Shared.Models;
using Microsoft.EntityFrameworkCore;

namespace GospelPresenter.Shared.Contexts;

public class PresentationContext(DbContextOptions<PresentationContext> options) : DbContext(options)
{
    public DbSet<Presentation> Presentations { get; set; }
}
