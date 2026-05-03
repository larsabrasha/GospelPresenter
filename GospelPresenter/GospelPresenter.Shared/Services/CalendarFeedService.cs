using GospelPresenter.Shared.Contexts;
using GospelPresenter.Shared.Models;
using Ical.Net;
using Ical.Net.CalendarComponents;
using Ical.Net.DataTypes;
using Ical.Net.Serialization;
using Microsoft.EntityFrameworkCore;

namespace GospelPresenter.Shared.Services;

public interface ICalendarFeedService
{
    Task<string> BuildIcsAsync(string organizationId, CancellationToken cancellationToken = default);
}

public class CalendarFeedService(IDbContextFactory<PresentationContext> dbContextFactory) : ICalendarFeedService
{
    private const int LookbackDays = 30;
    private const int DefaultDurationHours = 1;

    public async Task<string> BuildIcsAsync(string organizationId, CancellationToken cancellationToken = default)
    {
        var lookbackThreshold = DateOnly.FromDateTime(DateTime.UtcNow.AddDays(-LookbackDays));

        await using var context = await dbContextFactory.CreateDbContextAsync(cancellationToken);

        var organization = await context.Organizations
            .AsNoTracking()
            .FirstOrDefaultAsync(o => o.Id == organizationId, cancellationToken);

        var presentations = await context.Presentations
            .AsNoTracking()
            .Where(p => p.OrganizationId == organizationId
                        && !p.IsTemplate
                        && p.EventDate != null
                        && p.EventDate >= lookbackThreshold)
            .OrderBy(p => p.EventDate)
            .ThenBy(p => p.EventTime)
            .ToListAsync(cancellationToken);

        var calendar = new Calendar();
        calendar.AddProperty("X-WR-CALNAME",
            organization is null ? "Gospel Presenter" : $"Gospel Presenter — {organization.Name}");
        calendar.AddProperty("X-WR-CALDESC", "Kommande presentationer");

        foreach (var presentation in presentations)
        {
            calendar.Events.Add(BuildEvent(presentation));
        }

        var serializer = new CalendarSerializer();
        return serializer.SerializeToString(calendar);
    }

    private static CalendarEvent BuildEvent(Presentation presentation)
    {
        var eventDate = presentation.EventDate!.Value;
        var calEvent = new CalendarEvent
        {
            Uid = $"presentation-{presentation.Id}@gospelpresenter",
            Summary = presentation.Name,
            DtStamp = new CalDateTime(DateTime.UtcNow, "UTC"),
            LastModified = new CalDateTime(presentation.UpdatedAt.UtcDateTime, "UTC"),
        };

        if (!string.IsNullOrWhiteSpace(presentation.Description))
            calEvent.Description = presentation.Description;
        if (!string.IsNullOrWhiteSpace(presentation.EventLocation))
            calEvent.Location = presentation.EventLocation;

        if (presentation.EventTime is { } eventTime)
        {
            // Floating local time — same wall-clock in any timezone
            var startDateTime = new DateTime(
                eventDate.Year, eventDate.Month, eventDate.Day,
                eventTime.Hour, eventTime.Minute, eventTime.Second,
                DateTimeKind.Unspecified);
            var start = new CalDateTime(startDateTime);
            calEvent.Start = start;
            calEvent.End = start.AddHours(DefaultDurationHours);
        }
        else
        {
            // All-day event
            var start = new CalDateTime(eventDate.Year, eventDate.Month, eventDate.Day);
            calEvent.Start = start;
            calEvent.End = start.AddDays(1);
        }

        return calEvent;
    }
}
