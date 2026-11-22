// A start page row's second line, as the Mac's and the web's. TEMPORARY(core): goes with Shell/Dates.cs.
using Xunit;

namespace GospelPresenter.Shell.Tests;

public sealed class DatesTests
{
    public DatesTests() => Texts.Language = "sv";

    static PresentationRow Row(string? date = null, string? time = null, string? location = null) =>
        new("p1", "Gudstjänst", date, time, location, null, null, null);

    [Fact]
    public void TodaysDateIsSaidAsIdag()
    {
        Assert.Equal("Idag", Dates.DateLabel("2026-11-22", "2026-11-22", withYear: false));
    }

    [Fact]
    public void TomorrowsDateIsSaidAsImorgon()
    {
        Assert.Equal("Imorgon", Dates.DateLabel("2026-11-23", "2026-11-22", withYear: false));
    }

    [Fact]
    public void ALaterDateIsTheDayAndDateWithoutTheYear()
    {
        Assert.Equal("fre 4 december", Dates.DateLabel("2026-12-04", "2026-11-22", withYear: false));
    }

    [Fact]
    public void ALaterDateHasItsYearWhenTheListAsks()
    {
        Assert.Equal("fre 4 december 2026", Dates.DateLabel("2026-12-04", "2026-11-22", withYear: true));
    }

    [Fact]
    public void TheSubtitleJoinsDateTimeAndPlace()
    {
        var subtitle = Row("2026-11-22", "11:00", "Kyrkan").Subtitle("2026-11-22", showDate: true, withYear: false);

        Assert.Equal("Idag · 11:00 · Kyrkan", subtitle);
    }

    [Fact]
    public void TheSubtitleLeavesOutTheDateWhenTheListShowsNone()
    {
        var subtitle = Row("2026-11-22", "11:00").Subtitle("2026-11-22", showDate: false, withYear: false);

        Assert.Equal("11:00", subtitle);
    }
}
