using System.Text.Json;
using System.Text.Json.Serialization;
using GospelPresenter.Shared.Models;
using GospelPresenter.Shared.State;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;
using Microsoft.EntityFrameworkCore.Metadata;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;

namespace GospelPresenter.Shared.Contexts;

public class PresentationContext : DbContext
{
    public PresentationContext(DbContextOptions<PresentationContext> options) : base(options)
    {
    }

    /// <summary>For subclasses — the MAUI client derives its local context from this one.</summary>
    protected PresentationContext(DbContextOptions options) : base(options)
    {
    }

    /// <summary>
    /// Enums are written as names so that adding a value later cannot renumber what is already stored.
    /// </summary>
    private static readonly JsonSerializerOptions ThemeJsonOptions = new()
    {
        Converters = { new JsonStringEnumConverter() }
    };

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
    public DbSet<RemoteDisplay> RemoteDisplays { get; set; }
    public DbSet<DbBible> Bibles { get; set; }
    public DbSet<DbSongPartLabel> SongPartLabels { get; set; }
    public DbSet<DbSongArrangement> SongArrangements { get; set; }
    public DbSet<PresentationSlides> PresentationSlides { get; set; }
    public DbSet<CalendarSubscription> CalendarSubscriptions { get; set; }
    public DbSet<Theme> Themes { get; set; }
    public DbSet<SyncTombstone> SyncTombstones { get; set; }
    public DbSet<DeviceToken> DeviceTokens { get; set; }

    public override int SaveChanges(bool acceptAllChangesOnSuccess)
    {
        ApplySyncTrackingAsync(useAsync: false, CancellationToken.None).GetAwaiter().GetResult();
        return base.SaveChanges(acceptAllChangesOnSuccess);
    }

    public override async Task<int> SaveChangesAsync(bool acceptAllChangesOnSuccess, CancellationToken cancellationToken = default)
    {
        await ApplySyncTrackingAsync(useAsync: true, cancellationToken);
        return await base.SaveChangesAsync(acceptAllChangesOnSuccess, cancellationToken);
    }

    /// <summary>
    /// Stamps <see cref="ISyncTracked.ModifiedAt"/> on every tracked insert and update, and writes a
    /// <see cref="SyncTombstone"/> for every tracked delete of a synced entity, in the same save.
    /// Living in the context itself (rather than an interceptor registered in options) means no host —
    /// web, migration service, tests, or the MAUI app — can accidentally drop it when configuring the
    /// factory. <c>ExecuteUpdateAsync</c>/<c>ExecuteDeleteAsync</c> bypass the change tracker entirely;
    /// those call sites stamp and tombstone explicitly.
    /// </summary>
    private async ValueTask ApplySyncTrackingAsync(bool useAsync, CancellationToken cancellationToken)
    {
        if (SuppressSyncTracking)
            return;

        // Truncated to milliseconds so the in-memory value after a save equals what every provider
        // stores (SQLite keeps ms, Postgres µs). Sync conflict detection compares these values for
        // equality across pull, push and push-response, so they must round-trip exactly.
        var now = DateTimeOffset.FromUnixTimeMilliseconds(DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
        var entries = ChangeTracker.Entries().ToList();

        // On Postgres the version is the database's business — a trigger bumps it on every write,
        // including the ExecuteUpdateAsync calls that never reach this method. SQLite has no such
        // trigger, so the same guarantee is kept here for the hosts that run on it: the client, and
        // the integration suite that exercises server code against a file database.
        //
        // Deliberately a fallback rather than the mechanism. Doing it here on Postgres too would put
        // the version back in the hands of every call site, which is the arrangement that failed.
        var bumpVersion = Database.ProviderName == "Microsoft.EntityFrameworkCore.Sqlite";

        foreach (var entry in entries)
        {
            if (entry.Entity is ISyncTracked tracked &&
                entry.State is EntityState.Added or EntityState.Modified)
            {
                tracked.ModifiedAt = now;
                if (bumpVersion)
                    tracked.Version++;
            }
        }

        var deleted = entries
            .Where(e => e.State == EntityState.Deleted && e.Entity is ISyncTracked)
            .ToList();
        if (deleted.Count == 0)
            return;

        // Children of an aggregate deleted in the same save get no tombstone of their own: applying
        // the parent's tombstone cascades on the client, mirroring the database's FK cascades here.
        var deletedIds = deleted
            .GroupBy(e => e.Entity.GetType())
            .ToDictionary(g => g.Key, g => g.Select(e => (string)e.Property("Id").CurrentValue!).ToHashSet());

        bool IsDeleted<T>(string id) =>
            deletedIds.TryGetValue(typeof(T), out var ids) && ids.Contains(id);

        async ValueTask<string?> FirstOrDefaultAsync(IQueryable<string> query) =>
            useAsync ? await query.FirstOrDefaultAsync(cancellationToken) : query.FirstOrDefault();

        foreach (var entry in deleted)
        {
            string? organizationId = null;
            string? userId = null;

            switch (entry.Entity)
            {
                case Presentation p:
                    organizationId = p.OrganizationId;
                    break;
                case DbSong s:
                    organizationId = s.OrganizationId;
                    break;
                case DbSongPartLabel l:
                    organizationId = l.OrganizationId;
                    break;
                case OverlaySlide o:
                    organizationId = o.OrganizationId;
                    break;
                case OrganizationImage i:
                    organizationId = i.OrganizationId;
                    break;
                case OrganizationAudio a:
                    organizationId = a.OrganizationId;
                    break;
                case OrganizationSetting os:
                    organizationId = os.OrganizationId;
                    break;
                case DbBible b:
                    organizationId = b.OrganizationId;
                    break;
                case RemoteDisplay d:
                    organizationId = d.OrganizationId;
                    break;
                case Theme t:
                    // Null for built-in themes: their tombstones are global, served to every client.
                    organizationId = t.OrganizationId;
                    break;
                case UserSetting us:
                    userId = us.UserId;
                    break;

                // Child rows deleted on their own resolve their organisation through the parent.
                // A null lookup means the parent is gone too, so its tombstone covers this row.
                case PresentationItem item:
                    if (IsDeleted<Presentation>(item.PresentationId)) continue;
                    organizationId = await FirstOrDefaultAsync(
                        Presentations.Where(x => x.Id == item.PresentationId).Select(x => x.OrganizationId));
                    if (organizationId is null) continue;
                    break;
                case PresentationItemPart part:
                    if (IsDeleted<PresentationItem>(part.PresentationItemId)) continue;
                    organizationId = await FirstOrDefaultAsync(
                        PresentationItems.Where(x => x.Id == part.PresentationItemId)
                            .Select(x => x.Presentation.OrganizationId));
                    if (organizationId is null) continue;
                    break;
                case PresentationSlides slides:
                    if (IsDeleted<Presentation>(slides.PresentationId)) continue;
                    organizationId = await FirstOrDefaultAsync(
                        Presentations.Where(x => x.Id == slides.PresentationId).Select(x => x.OrganizationId));
                    if (organizationId is null) continue;
                    break;
                case DbSongPart songPart:
                    if (IsDeleted<DbSong>(songPart.SongId)) continue;
                    organizationId = await FirstOrDefaultAsync(
                        Songs.Where(x => x.Id == songPart.SongId).Select(x => x.OrganizationId));
                    if (organizationId is null) continue;
                    break;
                case DbSongVersion version:
                    if (IsDeleted<DbSong>(version.SongId)) continue;
                    organizationId = await FirstOrDefaultAsync(
                        Songs.Where(x => x.Id == version.SongId).Select(x => x.OrganizationId));
                    if (organizationId is null) continue;
                    break;
                case DbSongArrangement arrangement:
                    if (IsDeleted<DbSong>(arrangement.SongId)) continue;
                    organizationId = await FirstOrDefaultAsync(
                        Songs.Where(x => x.Id == arrangement.SongId).Select(x => x.OrganizationId));
                    if (organizationId is null) continue;
                    break;
                default:
                    continue;
            }

            SyncTombstones.Add(new SyncTombstone
            {
                EntityType = entry.Entity.GetType().Name,
                EntityId = (string)entry.Property("Id").CurrentValue!,
                OrganizationId = organizationId,
                UserId = userId,
                DeletedAt = now,
            });
        }
    }

    /// <summary>
    /// When true, saves neither stamp <see cref="ISyncTracked.ModifiedAt"/> nor write tombstones.
    /// The MAUI client's pull applier overrides this while writing server rows locally: those rows
    /// must keep the server's ModifiedAt, and deleting on a tombstone must not mint a new one.
    /// </summary>
    protected virtual bool SuppressSyncTracking => false;

    /// <summary>
    /// Tombstones for rows removed with <c>ExecuteDeleteAsync</c>, which never reach the change
    /// tracker. Call inside the same transaction as the delete, then save.
    /// </summary>
    public void AddTombstones(string entityType, IEnumerable<string> entityIds, string? organizationId, string? userId = null)
    {
        var now = DateTimeOffset.UtcNow;
        foreach (var entityId in entityIds)
        {
            SyncTombstones.Add(new SyncTombstone
            {
                EntityType = entityType,
                EntityId = entityId,
                OrganizationId = organizationId,
                UserId = userId,
                DeletedAt = now,
            });
        }
    }

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
            // Serves the sync pull query: changed rows for one organisation since a watermark.
            e.HasIndex(p => new { p.OrganizationId, p.ModifiedAt });
            e.Property(p => p.Name).HasMaxLength(AppConstraints.NameMaxLength);
            e.Property(p => p.Description).HasMaxLength(AppConstraints.DescriptionMaxLength);
            e.Property(p => p.EventLocation).HasMaxLength(AppConstraints.LocationMaxLength);

            // No navigation property: the theme is resolved through IThemeService, which caches the
            // built-in definitions, rather than joined into every presentation query. Deleting an
            // organisation's theme drops its presentations back to the organisation default.
            e.HasOne<Theme>()
                .WithMany()
                .HasForeignKey(p => p.ThemeId)
                .OnDelete(DeleteBehavior.SetNull);
        });

        modelBuilder.Entity<Theme>(e =>
        {
            e.Property(t => t.Name).HasMaxLength(AppConstraints.NameMaxLength);
            e.HasIndex(t => t.OrganizationId);
            e.HasOne(t => t.Organization)
                .WithMany()
                .HasForeignKey(t => t.OrganizationId)
                .OnDelete(DeleteBehavior.Cascade);

            // The definition is a nested tree that is never queried in SQL, so it is stored as JSON in
            // one column while staying plain C# in the model. A converter rather than OwnsOne().ToJson()
            // because the latter requires every nested type to be mapped by hand, which would mean
            // touching this file for each property the theme editor adds later.
            var definition = e.Property(t => t.Definition)
                .HasConversion(
                    v => JsonSerializer.Serialize(v, ThemeJsonOptions),
                    v => JsonSerializer.Deserialize<SlideTheme>(v, ThemeJsonOptions) ?? new SlideTheme(),
                    new ValueComparer<SlideTheme>(
                        (a, b) => a == b,
                        v => v.GetHashCode()));

            if (Database.ProviderName == "Npgsql.EntityFrameworkCore.PostgreSQL")
                definition.HasColumnType("jsonb");
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
            // Serves the sync pull query: changed rows for one organisation since a watermark.
            e.HasIndex(s => new { s.OrganizationId, s.ModifiedAt });
            e.Property(s => s.Name).HasMaxLength(AppConstraints.NameMaxLength);
            e.Property(s => s.Author).HasMaxLength(AppConstraints.SongAuthorMaxLength);
            e.Property(s => s.Publisher).HasMaxLength(AppConstraints.SongPublisherMaxLength);
            e.Property(s => s.Ccli).HasMaxLength(AppConstraints.SongCcliMaxLength);
        });

        modelBuilder.Entity<DbSongPart>(e =>
        {
            e.Property(p => p.Content).HasMaxLength(AppConstraints.SongPartContentMaxLength);
            e.HasOne(p => p.Label).WithMany().HasForeignKey(p => p.LabelId).OnDelete(DeleteBehavior.SetNull);
        });

        modelBuilder.Entity<DbSongPartLabel>(e =>
        {
            e.Property(l => l.Text).HasMaxLength(AppConstraints.SongPartLabelTextMaxLength);
            e.Property(l => l.Color).HasMaxLength(AppConstraints.SongPartLabelColorMaxLength);
            e.HasIndex(l => new { l.OrganizationId, l.Text }).IsUnique();
        });

        modelBuilder.Entity<DbSongArrangement>(e =>
        {
            e.Property(a => a.Name).HasMaxLength(AppConstraints.SongArrangementNameMaxLength);
            e.Property(a => a.PartIdsJson).HasMaxLength(AppConstraints.SongArrangementPartIdsJsonMaxLength);
            e.HasOne(a => a.Song).WithMany(s => s.Arrangements).HasForeignKey(a => a.SongId).OnDelete(DeleteBehavior.Cascade);
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

        modelBuilder.Entity<PresentationSlides>(e =>
        {
            e.Property(s => s.FileName).HasMaxLength(AppConstraints.FileNameMaxLength);
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

        modelBuilder.Entity<RemoteDisplay>(e =>
        {
            e.HasIndex(d => d.DisplayIdentifier).IsUnique();
            e.HasIndex(d => d.OrganizationId);
            e.HasIndex(d => new { d.OrganizationId, d.Kind });
            e.Property(d => d.DisplayIdentifier).HasMaxLength(AppConstraints.NameMaxLength);
            e.Property(d => d.Name).HasMaxLength(AppConstraints.NameMaxLength);
        });

        modelBuilder.Entity<DbBible>(e =>
        {
            e.Property(b => b.Name).HasMaxLength(AppConstraints.NameMaxLength);
            e.Property(b => b.Abbreviation).HasMaxLength(AppConstraints.BibleAbbreviationMaxLength);
            e.HasIndex(b => new { b.OrganizationId, b.Abbreviation }).IsUnique();
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

        modelBuilder.Entity<DeviceToken>(e =>
        {
            e.Property(t => t.Name).HasMaxLength(AppConstraints.NameMaxLength);
            e.HasIndex(t => t.TokenHash).IsUnique();
            e.HasOne(t => t.User).WithMany().HasForeignKey(t => t.UserId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne(t => t.Organization).WithMany().HasForeignKey(t => t.OrganizationId).OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<SyncTombstone>(e =>
        {
            e.Property(t => t.EntityType).HasMaxLength(64);
            e.HasIndex(t => new { t.OrganizationId, t.DeletedAt });
            e.HasIndex(t => new { t.UserId, t.DeletedAt });
        });

        modelBuilder.Entity<CalendarSubscription>(e =>
        {
            e.Property(s => s.Name).HasMaxLength(AppConstraints.NameMaxLength);
            e.HasIndex(s => s.TokenHash).IsUnique();
            e.HasIndex(s => new { s.UserId, s.OrganizationId });
            e.HasOne(s => s.User).WithMany().HasForeignKey(s => s.UserId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne(s => s.Organization).WithMany().HasForeignKey(s => s.OrganizationId).OnDelete(DeleteBehavior.Cascade);
        });

        // ModifiedAt is stored to the millisecond, and the database is what enforces it.
        //
        // The client keeps this column as a Unix millisecond integer (the converter below), while
        // Postgres would otherwise keep microseconds. Push conflict detection compares the two for
        // exact equality, so a value that cannot survive the round trip is a conflict that never
        // resolves: measured on real data, 12 of 16 presentations carried microsecond stamps and 9
        // of 13 client bases could never match, each one guaranteed to produce an "(offline
        // changes)" copy on the next edit from the device.
        //
        // Declared on the column rather than fixed at the call sites on purpose. SaveChanges already
        // truncated (see ApplySyncTrackingAsync); what leaked were the ExecuteUpdateAsync sites,
        // which stamp DateTimeOffset.UtcNow directly and bypass the change tracker entirely. Any
        // rule of the form "remember to truncate here too" would be one more thing to forget, and
        // this one had already been forgotten eleven times. A column that cannot hold microseconds
        // cannot be written wrong — by MSBuild-generated SQL, by raw SQL, or by anything else.
        var isPostgres = Database.ProviderName == "Npgsql.EntityFrameworkCore.PostgreSQL";

        foreach (var entityType in modelBuilder.Model.GetEntityTypes()
                     .Where(t => t.ClrType.IsAssignableTo(typeof(ISyncTracked))))
        {
            entityType.GetProperty(nameof(ISyncTracked.ModifiedAt)).SetPrecision(3);

            // On the server the version belongs to the database: a trigger bumps it on every write,
            // and EF reads the new value back so a push response can hand the client its new base.
            //
            // Not on the client. There the column is an ordinary field the pull applier writes with
            // whatever the server sent — the client must never invent a version, and telling EF the
            // store generates one would stop it from being able to store the server's.
            if (isPostgres)
                entityType.GetProperty(nameof(ISyncTracked.Version)).ValueGenerated = ValueGenerated.OnAddOrUpdate;
        }

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
