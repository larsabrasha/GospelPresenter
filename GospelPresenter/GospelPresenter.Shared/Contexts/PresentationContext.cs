using GospelPresenter.Shared.Models;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;

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
    public DbSet<OverlaySlide> OverlaySlides { get; set; }
    public DbSet<OrganizationImage> OrganizationImages { get; set; }
    public DbSet<OrganizationAudio> OrganizationAudios { get; set; }
    public DbSet<UserSetting> UserSettings { get; set; }
    public DbSet<McpApiKey> McpApiKeys { get; set; }
    public DbSet<OrganizationSetting> OrganizationSettings { get; set; }

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<UserSetting>()
            .HasIndex(us => new { us.UserId, us.Key })
            .IsUnique();

        modelBuilder.Entity<OrganizationSetting>()
            .HasIndex(os => new { os.OrganizationId, os.Key })
            .IsUnique();

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

        modelBuilder.Entity<McpApiKey>()
            .HasIndex(k => k.KeyHash)
            .IsUnique();

        // SQLite does not support DateTimeOffset in ORDER BY — store as ticks (long)
        if (Database.ProviderName == "Microsoft.EntityFrameworkCore.Sqlite")
        {
            var dateTimeOffsetConverter = new ValueConverter<DateTimeOffset, long>(
                v => v.ToUnixTimeMilliseconds(),
                v => DateTimeOffset.FromUnixTimeMilliseconds(v));

            var nullableDateTimeOffsetConverter = new ValueConverter<DateTimeOffset?, long?>(
                v => v.HasValue ? v.Value.ToUnixTimeMilliseconds() : null,
                v => v.HasValue ? DateTimeOffset.FromUnixTimeMilliseconds(v.Value) : null);

            var timeOnlyConverter = new ValueConverter<TimeOnly, long>(
                v => v.Ticks,
                v => new TimeOnly(v));

            var nullableTimeOnlyConverter = new ValueConverter<TimeOnly?, long?>(
                v => v.HasValue ? v.Value.Ticks : null,
                v => v.HasValue ? new TimeOnly(v.Value) : null);

            var dateOnlyConverter = new ValueConverter<DateOnly, long>(
                v => v.DayNumber,
                v => DateOnly.FromDayNumber((int)v));

            var nullableDateOnlyConverter = new ValueConverter<DateOnly?, long?>(
                v => v.HasValue ? v.Value.DayNumber : null,
                v => v.HasValue ? DateOnly.FromDayNumber((int)v.Value) : null);

            foreach (var entityType in modelBuilder.Model.GetEntityTypes())
            {
                foreach (var property in entityType.GetProperties())
                {
                    if (property.ClrType == typeof(DateTimeOffset))
                        property.SetValueConverter(dateTimeOffsetConverter);
                    else if (property.ClrType == typeof(DateTimeOffset?))
                        property.SetValueConverter(nullableDateTimeOffsetConverter);
                    else if (property.ClrType == typeof(TimeOnly))
                        property.SetValueConverter(timeOnlyConverter);
                    else if (property.ClrType == typeof(TimeOnly?))
                        property.SetValueConverter(nullableTimeOnlyConverter);
                    else if (property.ClrType == typeof(DateOnly))
                        property.SetValueConverter(dateOnlyConverter);
                    else if (property.ClrType == typeof(DateOnly?))
                        property.SetValueConverter(nullableDateOnlyConverter);
                }
            }
        }
    }
}
