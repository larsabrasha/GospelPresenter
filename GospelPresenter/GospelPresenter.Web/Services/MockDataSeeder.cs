using GospelPresenter.Shared.Contexts;
using GospelPresenter.Shared.Models;
using Microsoft.EntityFrameworkCore;

namespace GospelPresenter.Web.Services;

public static class MockDataSeeder
{
    public static async Task SeedAsync(PresentationContext db)
    {
        if (await db.Users.AnyAsync())
            return;

        var org = new Organization { Id = "mock-org", Name = "Mock" };
        db.Organizations.Add(org);

        var user = new User
        {
            Id = "mock-user",
            Name = "Mock User",
            Email = "mock@example.com",
            Role = UserRole.Admin,
            OrganizationId = org.Id,
            Logins =
            [
                new UserLogin { Provider = "mock", ProviderSubjectId = "mock" }
            ]
        };
        db.Users.Add(user);

        var now = DateTimeOffset.UtcNow;

        // Songs
        var song1 = new DbSong
        {
            Id = "song-1", Name = "Amazing Grace", Author = "John Newton", Year = 1779,
            OrganizationId = org.Id,
            Parts =
            [
                new DbSongPart { Content = "Amazing grace, how sweet the sound\nThat saved a wretch like me", SortOrder = 0 },
                new DbSongPart { Content = "Through many dangers, toils and snares\nI have already come", SortOrder = 1 }
            ]
        };
        var song2 = new DbSong
        {
            Id = "song-2", Name = "Härlig är jorden",
            OrganizationId = org.Id,
            Parts =
            [
                new DbSongPart { Content = "Härlig är jorden\nHärlig är Guds himmel\nSkön är själarnas pilgrimsgång", SortOrder = 0 },
                new DbSongPart { Content = "Tidevarv komma\nTidevarv försvinna\nSläkten följa släktens gång", SortOrder = 1 },
                new DbSongPart { Content = "Änglar den sjöngo\nFörst för markens herdar\nSkön är själarnas pilgrimsgång", SortOrder = 2 }
            ]
        };
        var song3 = new DbSong
        {
            Id = "song-3", Name = "Bred dina vida vingar", Author = "Lina Sandell", Year = 1865,
            OrganizationId = org.Id,
            Parts =
            [
                new DbSongPart { Content = "Bred dina vida vingar\nO Jesus, över mig\nOch låt mig stilla vila\nI skuggan utav dig", SortOrder = 0 },
                new DbSongPart { Content = "Jag är så trött av världen\nOch trött av mig själv\nMen du, o Herre, ger mig\nDin frid vid livets älv", SortOrder = 1 }
            ]
        };
        db.Songs.AddRange(song1, song2, song3);

        // Presentation
        var presentationId = Guid.NewGuid().ToString();
        var presentation = new Presentation
        {
            Id = presentationId,
            Name = "Söndagsgudstjänst",
            OrganizationId = org.Id,
            CreatedAt = now,
            CreatedBy = user.Id,
            UpdatedAt = now,
            UpdatedBy = user.Id,
            Items =
            [
                new PresentationItem
                {
                    SourceId = song1.Id, Type = PresentationItemType.Song, Title = "Amazing Grace", SortOrder = 0,
                    Parts =
                    [
                        new PresentationItemPart { Content = song1.Parts[0].Content, SortOrder = 0 },
                        new PresentationItemPart { Content = song1.Parts[1].Content, SortOrder = 1 }
                    ]
                },
                new PresentationItem
                {
                    Type = PresentationItemType.BibleText, Title = "Psalm 23:1-3", SortOrder = 1,
                    Parts =
                    [
                        new PresentationItemPart { Content = "Herren är min herde, mig skall intet fattas.\nHan låter mig vila på gröna ängar,\nhan för mig till vatten där jag finner ro.\nHan ger mig ny kraft.", SortOrder = 0 }
                    ]
                },
                new PresentationItem
                {
                    SourceId = song2.Id, Type = PresentationItemType.Song, Title = "Härlig är jorden", SortOrder = 2,
                    Parts =
                    [
                        new PresentationItemPart { Content = song2.Parts[0].Content, SortOrder = 0 },
                        new PresentationItemPart { Content = song2.Parts[1].Content, SortOrder = 1 },
                        new PresentationItemPart { Content = song2.Parts[2].Content, SortOrder = 2 }
                    ]
                },
                new PresentationItem
                {
                    SourceId = song3.Id, Type = PresentationItemType.Song, Title = "Bred dina vida vingar", SortOrder = 3,
                    Parts =
                    [
                        new PresentationItemPart { Content = song3.Parts[0].Content, SortOrder = 0 },
                        new PresentationItemPart { Content = song3.Parts[1].Content, SortOrder = 1 }
                    ]
                }
            ]
        };
        db.Presentations.Add(presentation);

        await db.SaveChangesAsync();
    }
}
