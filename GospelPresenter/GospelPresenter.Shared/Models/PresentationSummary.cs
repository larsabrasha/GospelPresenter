namespace GospelPresenter.Shared.Models;

public record PresentationSummary(
    string Id,
    string Name,
    DateTimeOffset Date,
    int? ScheduledDayOfWeek = null,
    TimeOnly? ScheduledTime = null,
    string? Location = null,
    DateOnly? EventDate = null,
    TimeOnly? EventTime = null
);
