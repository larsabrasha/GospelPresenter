using GospelPresenter.Shared.Contexts;
using GospelPresenter.Shared.Models;
using GospelPresenter.Shared.Services;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Shouldly;

namespace GospelPresenter.UnitTests.Services;

public class CalendarFeedServiceTests : IDisposable
{
    private readonly SqliteConnection connection;
    private readonly IDbContextFactory<PresentationContext> factory;
    private readonly CalendarFeedService service;
    private readonly Organization org;

    public CalendarFeedServiceTests()
    {
        connection = new SqliteConnection("DataSource=:memory:");
        connection.Open();

        var options = new DbContextOptionsBuilder<PresentationContext>()
            .UseSqlite(connection)
            .Options;
        factory = new TestDbContextFactory(options);
        service = new CalendarFeedService(factory);

        using var context = factory.CreateDbContext();
        context.Database.EnsureCreated();

        org = new Organization { Name = "Test Church" };
        context.Organizations.Add(org);
        context.SaveChanges();
    }

    public void Dispose() => connection.Dispose();

    [Fact]
    public async Task BuildIcsAsync_IncludesEventsWithinThirtyDayWindow()
    {
        // Arrange
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        AddPresentation("recent", "Recent", today.AddDays(-25), new TimeOnly(11, 0));
        AddPresentation("upcoming", "Upcoming", today.AddDays(7), new TimeOnly(18, 0));

        // Act
        var ics = await service.BuildIcsAsync(org.Id);

        // Assert
        ics.ShouldContain("SUMMARY:Recent");
        ics.ShouldContain("SUMMARY:Upcoming");
    }

    [Fact]
    public async Task BuildIcsAsync_ExcludesEventsOlderThanThirtyDays()
    {
        // Arrange
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        AddPresentation("ancient", "Ancient", today.AddDays(-31), new TimeOnly(11, 0));

        // Act
        var ics = await service.BuildIcsAsync(org.Id);

        // Assert
        ics.ShouldNotContain("SUMMARY:Ancient");
    }

    [Fact]
    public async Task BuildIcsAsync_ExcludesPresentationsWithoutEventDate()
    {
        // Arrange
        AddPresentation("undated", "Undated", null, null);

        // Act
        var ics = await service.BuildIcsAsync(org.Id);

        // Assert
        ics.ShouldNotContain("SUMMARY:Undated");
    }

    [Fact]
    public async Task BuildIcsAsync_ExcludesTemplates()
    {
        // Arrange
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        AddPresentation("template", "Template", today.AddDays(7), new TimeOnly(11, 0), isTemplate: true);

        // Act
        var ics = await service.BuildIcsAsync(org.Id);

        // Assert
        ics.ShouldNotContain("SUMMARY:Template");
    }

    [Fact]
    public async Task BuildIcsAsync_ExcludesEventsFromOtherOrganizations()
    {
        // Arrange
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var otherOrg = new Organization { Name = "Other" };
        await using (var context = factory.CreateDbContext())
        {
            context.Organizations.Add(otherOrg);
            context.SaveChanges();
        }
        AddPresentation("other", "OtherOrgEvent", today.AddDays(7), new TimeOnly(11, 0), organizationId: otherOrg.Id);

        // Act
        var ics = await service.BuildIcsAsync(org.Id);

        // Assert
        ics.ShouldNotContain("SUMMARY:OtherOrgEvent");
    }

    [Fact]
    public async Task BuildIcsAsync_TimedEventUsesFloatingDateTime()
    {
        // Arrange
        AddPresentation("timed", "Timed Event",
            new DateOnly(2099, 6, 15), new TimeOnly(14, 30));

        // Act
        var ics = await service.BuildIcsAsync(org.Id);

        // Assert — floating time has no Z suffix and no TZID
        ics.ShouldContain("DTSTART:20990615T143000");
        ics.ShouldContain("DTEND:20990615T153000");
    }

    [Fact]
    public async Task BuildIcsAsync_AllDayEventUsesValueDate()
    {
        // Arrange
        AddPresentation("allday", "All Day", new DateOnly(2099, 6, 15), eventTime: null);

        // Act
        var ics = await service.BuildIcsAsync(org.Id);

        // Assert
        ics.ShouldContain("DTSTART;VALUE=DATE:20990615");
        ics.ShouldContain("DTEND;VALUE=DATE:20990616");
    }

    [Fact]
    public async Task BuildIcsAsync_UsesStableUidPerPresentation()
    {
        // Arrange
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        AddPresentation("stable-id", "Stable", today.AddDays(7), new TimeOnly(11, 0));

        // Act
        var ics = await service.BuildIcsAsync(org.Id);

        // Assert
        ics.ShouldContain("UID:presentation-stable-id@gospelpresenter");
    }

    [Fact]
    public async Task BuildIcsAsync_IncludesOrganizationNameInCalName()
    {
        // Act
        var ics = await service.BuildIcsAsync(org.Id);

        // Assert
        ics.ShouldContain("X-WR-CALNAME:Gospel Presenter — Test Church");
    }

    [Fact]
    public async Task BuildIcsAsync_IncludesLocationAndDescription()
    {
        // Arrange
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        AddPresentation("with-meta", "Worship", today.AddDays(7), new TimeOnly(11, 0),
            location: "Main Hall", description: "Sunday service");

        // Act
        var ics = await service.BuildIcsAsync(org.Id);

        // Assert
        ics.ShouldContain("LOCATION:Main Hall");
        ics.ShouldContain("DESCRIPTION:Sunday service");
    }

    private void AddPresentation(string id, string name, DateOnly? eventDate, TimeOnly? eventTime,
        string? location = null, string? description = null, bool isTemplate = false, string? organizationId = null)
    {
        using var context = factory.CreateDbContext();
        context.Presentations.Add(new Presentation
        {
            Id = id,
            Name = name,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
            CreatedBy = "test",
            UpdatedBy = "test",
            EventDate = eventDate,
            EventTime = eventTime,
            EventLocation = location,
            Description = description,
            IsTemplate = isTemplate,
            OrganizationId = organizationId ?? org.Id
        });
        context.SaveChanges();
    }

    private class TestDbContextFactory(DbContextOptions<PresentationContext> options)
        : IDbContextFactory<PresentationContext>
    {
        public PresentationContext CreateDbContext() => new(options);
    }
}
