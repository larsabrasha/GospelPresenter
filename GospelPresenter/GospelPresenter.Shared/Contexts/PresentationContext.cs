using GospelPresenter.Shared.Models;
using Microsoft.EntityFrameworkCore;

namespace GospelPresenter.Shared.Contexts;

public class PresentationContext(DbContextOptions<PresentationContext> options) : DbContext(options)
{
    public DbSet<Organization> Organizations { get; set; }
    public DbSet<User> Users { get; set; }
    public DbSet<UserLogin> UserLogins { get; set; }
    public DbSet<Invite> Invites { get; set; }
    public DbSet<Presentation> Presentations { get; set; }
    public DbSet<PresentationItem> PresentationItems { get; set; }
    public DbSet<PresentationItemPart> PresentationItemParts { get; set; }
    public DbSet<DbSong> Songs { get; set; }
    public DbSet<DbSongPart> SongParts { get; set; }
    public DbSet<DbSongVersion> SongVersions { get; set; }

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<User>()
            .Property(u => u.Role)
            .HasConversion<string>();

        modelBuilder.Entity<User>()
            .HasIndex(u => u.Email)
            .IsUnique();

        modelBuilder.Entity<UserLogin>()
            .HasIndex(ul => new { ul.Provider, ul.ProviderSubjectId })
            .IsUnique();

        modelBuilder.Entity<Invite>()
            .HasIndex(i => i.Token)
            .IsUnique();
    }
}
