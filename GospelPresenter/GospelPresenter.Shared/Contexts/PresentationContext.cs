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
    public DbSet<CcliReportEntry> CcliReportEntries { get; set; }

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<User>(e =>
        {
            e.Property(u => u.Name).HasMaxLength(AppConstraints.NameMaxLength);
            e.Property(u => u.Email).HasMaxLength(AppConstraints.EmailMaxLength);
        });

        modelBuilder.Entity<Organization>(e =>
        {
            e.Property(o => o.Name).HasMaxLength(AppConstraints.NameMaxLength);
        });

        modelBuilder.Entity<Presentation>(e =>
        {
            e.Property(p => p.Name).HasMaxLength(AppConstraints.NameMaxLength);
            e.Property(p => p.Description).HasMaxLength(AppConstraints.DescriptionMaxLength);
            e.Property(p => p.EventLocation).HasMaxLength(AppConstraints.LocationMaxLength);
        });

        modelBuilder.Entity<PresentationItem>(e =>
        {
            e.Property(i => i.Title).HasMaxLength(AppConstraints.NameMaxLength);
        });

        modelBuilder.Entity<PresentationItemPart>(e =>
        {
            e.Property(p => p.Content).HasMaxLength(AppConstraints.PresentationItemPartContentMaxLength);
        });

        modelBuilder.Entity<DbSong>(e =>
        {
            e.Property(s => s.Name).HasMaxLength(AppConstraints.NameMaxLength);
            e.Property(s => s.Author).HasMaxLength(AppConstraints.SongAuthorMaxLength);
            e.Property(s => s.Publisher).HasMaxLength(AppConstraints.SongPublisherMaxLength);
            e.Property(s => s.Ccli).HasMaxLength(AppConstraints.SongCcliMaxLength);
        });

        modelBuilder.Entity<DbSongPart>(e =>
        {
            e.Property(p => p.Label).HasMaxLength(AppConstraints.SongPartLabelMaxLength);
            e.Property(p => p.Content).HasMaxLength(AppConstraints.SongPartContentMaxLength);
        });

        modelBuilder.Entity<DbSongVersion>(e =>
        {
            e.Property(v => v.Name).HasMaxLength(AppConstraints.NameMaxLength);
            e.Property(v => v.Author).HasMaxLength(AppConstraints.SongAuthorMaxLength);
            e.Property(v => v.PartsJson).HasMaxLength(AppConstraints.SongVersionPartsJsonMaxLength);
        });

        modelBuilder.Entity<OverlaySlide>(e =>
        {
            e.Property(o => o.Title).HasMaxLength(AppConstraints.OverlayTitleMaxLength);
            e.Property(o => o.Content).HasMaxLength(AppConstraints.OverlayContentMaxLength);
        });

        modelBuilder.Entity<OrganizationImage>(e =>
        {
            e.Property(i => i.FileName).HasMaxLength(AppConstraints.FileNameMaxLength);
        });

        modelBuilder.Entity<OrganizationAudio>(e =>
        {
            e.Property(a => a.FileName).HasMaxLength(AppConstraints.FileNameMaxLength);
        });

        modelBuilder.Entity<McpApiKey>(e =>
        {
            e.Property(k => k.Name).HasMaxLength(AppConstraints.NameMaxLength);
        });

        modelBuilder.Entity<UserSetting>(e =>
        {
            e.HasIndex(us => new { us.UserId, us.Key }).IsUnique();
            e.Property(us => us.Key).HasMaxLength(AppConstraints.SettingsKeyMaxLength);
            e.Property(us => us.Value).HasMaxLength(AppConstraints.SettingsValueMaxLength);
        });

        modelBuilder.Entity<OrganizationSetting>(e =>
        {
            e.HasIndex(os => new { os.OrganizationId, os.Key }).IsUnique();
            e.Property(os => os.Key).HasMaxLength(AppConstraints.SettingsKeyMaxLength);
            e.Property(os => os.Value).HasMaxLength(AppConstraints.SettingsValueMaxLength);
        });

        modelBuilder.Entity<CcliReportEntry>(e =>
        {
            e.HasIndex(c => new { c.OrganizationId, c.SongId, c.Date, c.PresentationId }).IsUnique();
            e.Property(c => c.SongName).HasMaxLength(AppConstraints.NameMaxLength);
            e.Property(c => c.CcliNumber).HasMaxLength(AppConstraints.SongCcliMaxLength);
            e.Property(c => c.PresentationName).HasMaxLength(AppConstraints.NameMaxLength);
        });

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
