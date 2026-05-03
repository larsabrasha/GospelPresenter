using System.Text;
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
    Task<string> BuildIcsAsync(string organizationId, string? baseUrl, CancellationToken cancellationToken = default);
}

public class CalendarFeedService(IDbContextFactory<PresentationContext> dbContextFactory) : ICalendarFeedService
{
    private const int LookbackDays = 30;
    private const int DefaultDurationHours = 1;

    public async Task<string> BuildIcsAsync(string organizationId, string? baseUrl, CancellationToken cancellationToken = default)
    {
        var lookbackThreshold = DateOnly.FromDateTime(DateTime.UtcNow.AddDays(-LookbackDays));

        await using var context = await dbContextFactory.CreateDbContextAsync(cancellationToken);

        var organization = await context.Organizations
            .AsNoTracking()
            .FirstOrDefaultAsync(o => o.Id == organizationId, cancellationToken);

        var presentations = await context.Presentations
            .AsNoTracking()
            .Include(p => p.Items.OrderBy(i => i.SortOrder))
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

        var trimmedBaseUrl = baseUrl?.TrimEnd('/');

        foreach (var presentation in presentations)
        {
            calendar.Events.Add(BuildEvent(presentation, trimmedBaseUrl));
        }

        var serializer = new CalendarSerializer();
        return serializer.SerializeToString(calendar);
    }

    private static CalendarEvent BuildEvent(Presentation presentation, string? baseUrl)
    {
        var eventDate = presentation.EventDate!.Value;
        var calEvent = new CalendarEvent
        {
            Uid = $"presentation-{presentation.Id}@gospelpresenter",
            Summary = presentation.Name,
            DtStamp = new CalDateTime(DateTime.UtcNow, "UTC"),
            LastModified = new CalDateTime(presentation.UpdatedAt.UtcDateTime, "UTC"),
        };

        if (!string.IsNullOrWhiteSpace(presentation.EventLocation))
            calEvent.Location = presentation.EventLocation;

        var description = BuildDescription(presentation, baseUrl);
        if (description.Length > 0)
            calEvent.Description = description;

        if (baseUrl is not null && Uri.TryCreate($"{baseUrl}/presentations/{presentation.Id}", UriKind.Absolute, out var uri))
            calEvent.Url = uri;

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

    private static string BuildDescription(Presentation presentation, string? baseUrl)
    {
        var sb = new StringBuilder();

        if (!string.IsNullOrWhiteSpace(presentation.Description))
        {
            sb.Append(presentation.Description.Trim());
            sb.Append('\n');
            sb.Append('\n');
        }

        foreach (var item in presentation.Items)
        {
            sb.Append(IconFor(item.Type));
            sb.Append(' ');
            sb.Append(string.IsNullOrWhiteSpace(item.Title) ? FallbackTitleFor(item.Type) : item.Title);
            sb.Append('\n');
        }

        if (baseUrl is not null)
        {
            if (sb.Length > 0) sb.Append('\n');
            sb.Append($"{baseUrl}/presentations/{presentation.Id}");
        }

        return sb.ToString().TrimEnd('\n');
    }

    private static string IconFor(PresentationItemType type) => type switch
    {
        PresentationItemType.Song => "🎵",
        PresentationItemType.BibleText => "📖",
        PresentationItemType.Image => "🖼️",
        PresentationItemType.Audio => "🔊",
        PresentationItemType.Slides => "📊",
        _ => "•"
    };

    private static string FallbackTitleFor(PresentationItemType type) => type switch
    {
        PresentationItemType.Song => "Sång",
        PresentationItemType.BibleText => "Bibeltext",
        PresentationItemType.Image => "Bild",
        PresentationItemType.Audio => "Ljud",
        PresentationItemType.Slides => "Slides",
        _ => type.ToString()
    };
}
