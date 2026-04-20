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

        var now = DateTimeOffset.UtcNow;

        SeedSwedish(db, now);
        SeedEnglish(db, now);

        await db.SaveChangesAsync();
    }

    static void SeedSwedish(PresentationContext db, DateTimeOffset now)
    {
        var org = new Organization { Id = "mock-org-sv", Name = "Foo Bar Kyrka" };
        db.Organizations.Add(org);

        var user = new User
        {
            Id = "mock-user-sv",
            Name = "Foo Bar",
            Email = "foo@foobar.se",
            Role = UserRole.Admin,
            OrganizationId = org.Id,
            Logins = [new UserLogin { Provider = "mock", ProviderSubjectId = "mock-sv" }]
        };
        db.Users.Add(user);

        // Song part labels
        var vers = new DbSongPartLabel { Id = "sv-label-vers", Text = "Vers", Color = "#3b82f6", SortOrder = 0, OrganizationId = org.Id };
        var refrang = new DbSongPartLabel { Id = "sv-label-refrang", Text = "Refräng", Color = "#f97316", SortOrder = 1, OrganizationId = org.Id };
        var brygga = new DbSongPartLabel { Id = "sv-label-brygga", Text = "Brygga", Color = "#a855f7", SortOrder = 2, OrganizationId = org.Id };
        var intro = new DbSongPartLabel { Id = "sv-label-intro", Text = "Intro", Color = "#6b7280", SortOrder = 3, OrganizationId = org.Id };
        db.SongPartLabels.AddRange(vers, refrang, brygga, intro);

        // Songs (public domain — all composers/lyricists died >70 years ago)
        var harligArJorden = new DbSong
        {
            Id = "sv-song-1", Name = "Härlig är jorden",
            OrganizationId = org.Id,
            Parts =
            [
                new DbSongPart { Id = "sv-s1-p1", LabelId = vers.Id, SortOrder = 0, Content = "Härlig är jorden,\nHärlig är Guds himmel,\nSkön är själarnas pilgrimsgång.\nGenom de fagra riken på jorden\nGår vi till paradiset fram." },
                new DbSongPart { Id = "sv-s1-p2", LabelId = vers.Id, SortOrder = 1, Content = "Tidevarv komma,\nTidevarv försvinna,\nSläkten följa släktens gång.\nAldrig uppslocknar tonen från himlen\nI själens glada pilgrimssång." },
                new DbSongPart { Id = "sv-s1-p3", LabelId = vers.Id, SortOrder = 2, Content = "Änglar den sjöngo\nFörst för markens herdar;\nSkön var sången, ljuv och lång.\nFrid på vår jord nu!\nGud till oss sände\nHimmelens frid med Davids son." },
            ],
            Arrangements = [new DbSongArrangement { Id = "sv-arr-1", PartIdsJson = "[\"sv-s1-p1\",\"sv-s1-p2\",\"sv-s1-p3\"]" }]
        };

        var bredDinaVida = new DbSong
        {
            Id = "sv-song-2", Name = "Bred dina vida vingar", Author = "Lina Sandell", Year = 1865,
            OrganizationId = org.Id,
            Parts =
            [
                new DbSongPart { Id = "sv-s2-p1", LabelId = vers.Id, SortOrder = 0, Content = "Bred dina vida vingar\nO Jesus, över mig\nOch låt mig stilla vila\nI skuggan utav dig" },
                new DbSongPart { Id = "sv-s2-p2", LabelId = vers.Id, SortOrder = 1, Content = "Jag är så trött av världen\nOch trött av mig själv\nMen du, o Herre, ger mig\nDin frid vid livets älv" },
                new DbSongPart { Id = "sv-s2-p3", LabelId = vers.Id, SortOrder = 2, Content = "Bred dina vida vingar\nSom modershönan bred\nOch slut ditt lilla kyckling\nTill hjärtat med din fred" },
            ],
            Arrangements = [new DbSongArrangement { Id = "sv-arr-2", PartIdsJson = "[\"sv-s2-p1\",\"sv-s2-p2\",\"sv-s2-p3\"]" }]
        };

        var blottEnDag = new DbSong
        {
            Id = "sv-song-3", Name = "Blott en dag", Author = "Lina Sandell", Year = 1865,
            OrganizationId = org.Id,
            Parts =
            [
                new DbSongPart { Id = "sv-s3-p1", LabelId = vers.Id, SortOrder = 0, Content = "Blott en dag, ett ögonblick i sänder,\nVad det lyser mig på vägars gång!\nDet är nog, ty med din hand mig leder\nDu som känner mina svaghetsplag." },
                new DbSongPart { Id = "sv-s3-r1", LabelId = refrang.Id, SortOrder = 1, Content = "Ja, allt vad jag behöver dag för dagen,\nDet giver du mig, o Fader kär;\nVad sen skall hända, är i dina händer\nOch jag vet att du också är där." },
                new DbSongPart { Id = "sv-s3-p2", LabelId = vers.Id, SortOrder = 2, Content = "Morgondagen, hur den kommer, vet jag icke,\nMen jag vet att du är konung där.\nVad dig lyster låter du mig möta\nNär den dagen gryr i öster." },
            ],
            Arrangements = [new DbSongArrangement { Id = "sv-arr-3", PartIdsJson = "[\"sv-s3-p1\",\"sv-s3-r1\",\"sv-s3-p2\",\"sv-s3-r1\"]" }]
        };

        var oStoreGud = new DbSong
        {
            Id = "sv-song-4", Name = "O store Gud", Author = "Carl Boberg", Year = 1885,
            OrganizationId = org.Id,
            Parts =
            [
                new DbSongPart { Id = "sv-s4-p1", LabelId = vers.Id, SortOrder = 0, Content = "O store Gud, när jag den värld beskådar\nSom du har skapat med ditt allmaktsord,\nHur där din visdom väver livets trådar\nOch allt ditt verk på himlens sky och jord;" },
                new DbSongPart { Id = "sv-s4-r1", LabelId = refrang.Id, SortOrder = 1, Content = "Då brister min själ ut i lovsångens ljud:\nO store Gud! O store Gud!\nDå brister min själ ut i lovsångens ljud:\nO store Gud!" },
                new DbSongPart { Id = "sv-s4-p2", LabelId = vers.Id, SortOrder = 2, Content = "När sommarvinden susar genom skogen\nOch blommorna doftar vid källans bryn,\nNär sjungande fåglar, fyllda av välbehagen,\nDitt lov förkunnar under himlens sköna syn;" },
            ],
            Arrangements = [new DbSongArrangement { Id = "sv-arr-4", PartIdsJson = "[\"sv-s4-p1\",\"sv-s4-r1\",\"sv-s4-p2\",\"sv-s4-r1\"]" }]
        };

        var denBlomstertid = new DbSong
        {
            Id = "sv-song-5", Name = "Den blomstertid nu kommer", Author = "Johan Olof Wallin", Year = 1816,
            OrganizationId = org.Id,
            Parts =
            [
                new DbSongPart { Id = "sv-s5-p1", LabelId = vers.Id, SortOrder = 0, Content = "Den blomstertid nu kommer,\nMed lust och fägring stor;\nDu nalkas, ljuva sommar,\nDå allt i grönskan bor." },
                new DbSongPart { Id = "sv-s5-p2", LabelId = vers.Id, SortOrder = 1, Content = "Välkommen, skön gröna sommar,\nMed glädje, fröjd och ro!\nNu sjunger var liten fogel\nI dal och skogens bo." },
            ],
            Arrangements = [new DbSongArrangement { Id = "sv-arr-5", PartIdsJson = "[\"sv-s5-p1\",\"sv-s5-p2\"]" }]
        };

        var tryggare = new DbSong
        {
            Id = "sv-song-6", Name = "Tryggare kan ingen vara", Author = "Lina Sandell", Year = 1855,
            OrganizationId = org.Id,
            Parts =
            [
                new DbSongPart { Id = "sv-s6-p1", LabelId = vers.Id, SortOrder = 0, Content = "Tryggare kan ingen vara\nÄn Guds lilla barnaskara,\nStjärnan ej på himlafästet,\nFågeln ej i kända nästet." },
                new DbSongPart { Id = "sv-s6-p2", LabelId = vers.Id, SortOrder = 1, Content = "Fader, Fader, du oss ser\nHuru än vår väg sig ter!\nNär vi intet se och veta\nVågar vi på dig oss stödja." },
                new DbSongPart { Id = "sv-s6-p3", LabelId = vers.Id, SortOrder = 2, Content = "Vad han tar, och vad han giver,\nDetsamma han ändå bliver;\nHans är riket, makten, ären;\nDen nöden ser, han nöden bär." },
            ],
            Arrangements = [new DbSongArrangement { Id = "sv-arr-6", PartIdsJson = "[\"sv-s6-p1\",\"sv-s6-p2\",\"sv-s6-p3\"]" }]
        };

        var uppMinTunga = new DbSong
        {
            Id = "sv-song-7", Name = "Upp, min tunga, att lovsjunga", Author = "Johan Olof Wallin", Year = 1819,
            OrganizationId = org.Id,
            Parts =
            [
                new DbSongPart { Id = "sv-s7-p1", LabelId = vers.Id, SortOrder = 0, Content = "Upp, min tunga, att lovsjunga\nDen som sitter på sin tron!\nLåt din röst i jubel ljunga\nÅt Guds enfödde Son!" },
                new DbSongPart { Id = "sv-s7-p2", LabelId = vers.Id, SortOrder = 1, Content = "Herren lever, Herren råder,\nHerren hjälper och befriar;\nHerren ensam vägen banar\nTill det eviga livet." },
            ],
            Arrangements = [new DbSongArrangement { Id = "sv-arr-7", PartIdsJson = "[\"sv-s7-p1\",\"sv-s7-p2\"]" }]
        };

        var varHalsad = new DbSong
        {
            Id = "sv-song-8", Name = "Var hälsad, sköna morgonstund", Author = "Johan Olof Wallin", Year = 1816,
            OrganizationId = org.Id,
            Parts =
            [
                new DbSongPart { Id = "sv-s8-p1", LabelId = vers.Id, SortOrder = 0, Content = "Var hälsad, sköna morgonstund,\nSom av profeters helga mund\nEr väntad och förspord!\nDu sol, som går på himlen opp,\nDu väcks av en hel världens hopp,\nDitt lopp är snart fullgjord." },
                new DbSongPart { Id = "sv-s8-p2", LabelId = vers.Id, SortOrder = 1, Content = "Nu komma de, de trognas hop,\nAtt fira jublets stora lopp\nMed helga sångars ljud!\nOss nalkas dagen full av nåd,\nDå fullbordas de eviga råd\nAv vår rättfärdige Gud." },
            ],
            Arrangements = [new DbSongArrangement { Id = "sv-arr-8", PartIdsJson = "[\"sv-s8-p1\",\"sv-s8-p2\"]" }]
        };

        db.Songs.AddRange(harligArJorden, bredDinaVida, blottEnDag, oStoreGud, denBlomstertid, tryggare, uppMinTunga, varHalsad);

        // Bible text — 1917 Swedish translation (public domain)
        var psalm23sv =
            "Herren är min herde, mig skall intet fattas.\n" +
            "Han låter mig vila på gröna ängar,\n" +
            "han för mig till vatten där jag finner ro.\n" +
            "Han vederkvicker min själ;\n" +
            "han leder mig på rätta stigar, för sitt namns skull.\n\n" +
            "Om jag ock vandrar i dödsskuggans dal,\n" +
            "fruktar jag intet ont, ty du är med mig;\n" +
            "din käpp och din stav de trösta mig.\n\n" +
            "Du bereder för mig ett bord i mina ovänners åsyn;\n" +
            "du smörjer mitt huvud med olja;\n" +
            "mitt bägar flödar över.\n" +
            "Ja, godhet och nåd skall följa mig i alla mina livsdagar,\n" +
            "och jag skall bo i Herrens hus evinnerligen.";

        var johannes316sv =
            "Ty så älskade Gud världen, att han utgav sin enfödde Son,\n" +
            "på det att var och en som tror på honom\n" +
            "icke skall förgås, utan hava evigt liv.";

        var slideDeckSv = new PresentationSlides
        {
            Id = "sv-slides-1", FileName = "Söndagsprogram.pdf", PageCount = 0, CreatedAt = now
        };

        var mainPresentation = new Presentation
        {
            Id = "sv-pres-main",
            Name = "Söndagsgudstjänst",
            OrganizationId = org.Id,
            EventDate = new DateOnly(2026, 4, 20),
            EventTime = new TimeOnly(11, 0),
            EventLocation = "Stora salen",
            CreatedAt = now, CreatedBy = user.Id,
            UpdatedAt = now, UpdatedBy = user.Id,
            SlideDecks = [slideDeckSv],
            Items =
            [
                new PresentationItem
                {
                    SourceId = oStoreGud.Id, Type = PresentationItemType.Song, Title = "O store Gud", SortOrder = 0,
                    Parts =
                    [
                        new PresentationItemPart { Content = oStoreGud.Parts[0].Content, SortOrder = 0 },
                        new PresentationItemPart { Content = oStoreGud.Parts[1].Content, SortOrder = 1 },
                        new PresentationItemPart { Content = oStoreGud.Parts[2].Content, SortOrder = 2 },
                    ]
                },
                new PresentationItem
                {
                    Type = PresentationItemType.BibleText, Title = "Psalm 23:1–6", SortOrder = 1,
                    Parts = [new PresentationItemPart { Content = psalm23sv, SortOrder = 0 }]
                },
                new PresentationItem
                {
                    SourceId = bredDinaVida.Id, Type = PresentationItemType.Song, Title = "Bred dina vida vingar", SortOrder = 2,
                    Parts =
                    [
                        new PresentationItemPart { Content = bredDinaVida.Parts[0].Content, SortOrder = 0 },
                        new PresentationItemPart { Content = bredDinaVida.Parts[1].Content, SortOrder = 1 },
                        new PresentationItemPart { Content = bredDinaVida.Parts[2].Content, SortOrder = 2 },
                    ]
                },
                new PresentationItem { Type = PresentationItemType.Audio, Title = "Välkomsttema", SortOrder = 3, Parts = [] },
                new PresentationItem
                {
                    SourceId = tryggare.Id, Type = PresentationItemType.Song, Title = "Tryggare kan ingen vara", SortOrder = 4,
                    Parts =
                    [
                        new PresentationItemPart { Content = tryggare.Parts[0].Content, SortOrder = 0 },
                        new PresentationItemPart { Content = tryggare.Parts[1].Content, SortOrder = 1 },
                        new PresentationItemPart { Content = tryggare.Parts[2].Content, SortOrder = 2 },
                    ]
                },
                new PresentationItem { SourceId = slideDeckSv.Id, Type = PresentationItemType.Slides, Title = "Söndagsprogram", SortOrder = 5, Parts = [] },
            ]
        };
        db.Presentations.Add(mainPresentation);

        var template = new Presentation
        {
            Id = "sv-pres-template",
            Name = "Söndagsgudstjänst",
            IsTemplate = true,
            OrganizationId = org.Id,
            ScheduledDayOfWeek = (int)DayOfWeek.Sunday,
            ScheduledTime = new TimeOnly(11, 0),
            CreatedAt = now, CreatedBy = user.Id,
            UpdatedAt = now, UpdatedBy = user.Id,
            Items =
            [
                new PresentationItem
                {
                    SourceId = oStoreGud.Id, Type = PresentationItemType.Song, Title = "O store Gud", SortOrder = 0,
                    Parts =
                    [
                        new PresentationItemPart { Content = oStoreGud.Parts[0].Content, SortOrder = 0 },
                        new PresentationItemPart { Content = oStoreGud.Parts[1].Content, SortOrder = 1 },
                        new PresentationItemPart { Content = oStoreGud.Parts[2].Content, SortOrder = 2 },
                    ]
                },
                new PresentationItem { Type = PresentationItemType.BibleText, Title = "Bibeltext", SortOrder = 1, Parts = [] },
                new PresentationItem
                {
                    SourceId = bredDinaVida.Id, Type = PresentationItemType.Song, Title = "Bred dina vida vingar", SortOrder = 2,
                    Parts =
                    [
                        new PresentationItemPart { Content = bredDinaVida.Parts[0].Content, SortOrder = 0 },
                        new PresentationItemPart { Content = bredDinaVida.Parts[1].Content, SortOrder = 1 },
                        new PresentationItemPart { Content = bredDinaVida.Parts[2].Content, SortOrder = 2 },
                    ]
                },
            ]
        };
        db.Presentations.Add(template);

        // Second service today
        db.Presentations.Add(new Presentation
        {
            Id = "sv-pres-youth",
            Name = "Ungdomsgudstjänst",
            OrganizationId = org.Id,
            EventDate = new DateOnly(2026, 4, 20),
            EventTime = new TimeOnly(18, 0),
            EventLocation = "Ungdomslokalen",
            CreatedAt = now, CreatedBy = user.Id,
            UpdatedAt = now, UpdatedBy = user.Id,
            Items =
            [
                new PresentationItem { SourceId = blottEnDag.Id, Type = PresentationItemType.Song, Title = "Blott en dag", SortOrder = 0,
                    Parts = [ new PresentationItemPart { Content = blottEnDag.Parts[0].Content, SortOrder = 0 } ] },
                new PresentationItem { SourceId = tryggare.Id, Type = PresentationItemType.Song, Title = "Tryggare kan ingen vara", SortOrder = 1,
                    Parts = [ new PresentationItemPart { Content = tryggare.Parts[0].Content, SortOrder = 0 } ] },
            ]
        });

        // Upcoming presentations
        db.Presentations.Add(new Presentation
        {
            Id = "sv-pres-prayer",
            Name = "Bönekväll",
            OrganizationId = org.Id,
            EventDate = new DateOnly(2026, 4, 23),
            EventTime = new TimeOnly(19, 0),
            EventLocation = "Bönerummet",
            CreatedAt = now, CreatedBy = user.Id,
            UpdatedAt = now, UpdatedBy = user.Id,
            Items =
            [
                new PresentationItem { SourceId = bredDinaVida.Id, Type = PresentationItemType.Song, Title = "Bred dina vida vingar", SortOrder = 0,
                    Parts = [ new PresentationItemPart { Content = bredDinaVida.Parts[0].Content, SortOrder = 0 } ] },
            ]
        });

        db.Presentations.Add(new Presentation
        {
            Id = "sv-pres-next1",
            Name = "Söndagsgudstjänst",
            OrganizationId = org.Id,
            EventDate = new DateOnly(2026, 4, 27),
            EventTime = new TimeOnly(11, 0),
            EventLocation = "Stora salen",
            CreatedAt = now, CreatedBy = user.Id,
            UpdatedAt = now, UpdatedBy = user.Id,
            Items =
            [
                new PresentationItem { SourceId = oStoreGud.Id, Type = PresentationItemType.Song, Title = "O store Gud", SortOrder = 0,
                    Parts = [ new PresentationItemPart { Content = oStoreGud.Parts[0].Content, SortOrder = 0 } ] },
                new PresentationItem { Type = PresentationItemType.BibleText, Title = "Bibeltext", SortOrder = 1, Parts = [] },
            ]
        });

        db.Presentations.Add(new Presentation
        {
            Id = "sv-pres-family",
            Name = "Familjegudstjänst",
            OrganizationId = org.Id,
            EventDate = new DateOnly(2026, 5, 4),
            EventTime = new TimeOnly(11, 0),
            EventLocation = "Stora salen",
            CreatedAt = now, CreatedBy = user.Id,
            UpdatedAt = now, UpdatedBy = user.Id,
            Items =
            [
                new PresentationItem { SourceId = harligArJorden.Id, Type = PresentationItemType.Song, Title = "Härlig är jorden", SortOrder = 0,
                    Parts = [ new PresentationItemPart { Content = harligArJorden.Parts[0].Content, SortOrder = 0 } ] },
                new PresentationItem { SourceId = tryggare.Id, Type = PresentationItemType.Song, Title = "Tryggare kan ingen vara", SortOrder = 1,
                    Parts = [ new PresentationItemPart { Content = tryggare.Parts[0].Content, SortOrder = 0 } ] },
            ]
        });

        db.Presentations.Add(new Presentation
        {
            Id = "sv-pres-next2",
            Name = "Söndagsgudstjänst",
            OrganizationId = org.Id,
            EventDate = new DateOnly(2026, 5, 11),
            EventTime = new TimeOnly(11, 0),
            EventLocation = "Stora salen",
            CreatedAt = now, CreatedBy = user.Id,
            UpdatedAt = now, UpdatedBy = user.Id,
            Items = []
        });

        // Previous presentations
        var prevDate = new DateTimeOffset(2026, 4, 13, 11, 0, 0, TimeSpan.Zero);
        var prevPresentation = new Presentation
        {
            Id = "sv-pres-prev",
            Name = "Söndagsgudstjänst",
            OrganizationId = org.Id,
            EventDate = new DateOnly(2026, 4, 13),
            EventTime = new TimeOnly(11, 0),
            EventLocation = "Stora salen",
            UseCount = 1,
            LastUsedAt = prevDate,
            CreatedAt = prevDate, CreatedBy = user.Id,
            UpdatedAt = prevDate, UpdatedBy = user.Id,
            Items =
            [
                new PresentationItem
                {
                    SourceId = harligArJorden.Id, Type = PresentationItemType.Song, Title = "Härlig är jorden", SortOrder = 0,
                    Parts =
                    [
                        new PresentationItemPart { Content = harligArJorden.Parts[0].Content, SortOrder = 0 },
                        new PresentationItemPart { Content = harligArJorden.Parts[1].Content, SortOrder = 1 },
                        new PresentationItemPart { Content = harligArJorden.Parts[2].Content, SortOrder = 2 },
                    ]
                },
                new PresentationItem
                {
                    Type = PresentationItemType.BibleText, Title = "Johannes 3:16", SortOrder = 1,
                    Parts = [new PresentationItemPart { Content = johannes316sv, SortOrder = 0 }]
                },
                new PresentationItem
                {
                    SourceId = blottEnDag.Id, Type = PresentationItemType.Song, Title = "Blott en dag", SortOrder = 2,
                    Parts =
                    [
                        new PresentationItemPart { Content = blottEnDag.Parts[0].Content, SortOrder = 0 },
                        new PresentationItemPart { Content = blottEnDag.Parts[1].Content, SortOrder = 1 },
                        new PresentationItemPart { Content = blottEnDag.Parts[2].Content, SortOrder = 2 },
                    ]
                },
            ]
        };
        db.Presentations.Add(prevPresentation);

        var prev2Date = new DateTimeOffset(2026, 4, 13, 18, 0, 0, TimeSpan.Zero);
        db.Presentations.Add(new Presentation
        {
            Id = "sv-pres-prev-youth",
            Name = "Ungdomsgudstjänst",
            OrganizationId = org.Id,
            EventDate = new DateOnly(2026, 4, 13),
            EventTime = new TimeOnly(18, 0),
            EventLocation = "Ungdomslokalen",
            UseCount = 1,
            LastUsedAt = prev2Date,
            CreatedAt = prev2Date, CreatedBy = user.Id,
            UpdatedAt = prev2Date, UpdatedBy = user.Id,
            Items =
            [
                new PresentationItem { SourceId = varHalsad.Id, Type = PresentationItemType.Song, Title = "Var hälsad, sköna morgonstund", SortOrder = 0,
                    Parts = [ new PresentationItemPart { Content = varHalsad.Parts[0].Content, SortOrder = 0 } ] },
            ]
        });

        var prev3Date = new DateTimeOffset(2026, 4, 9, 19, 0, 0, TimeSpan.Zero);
        db.Presentations.Add(new Presentation
        {
            Id = "sv-pres-prev-prayer",
            Name = "Bönekväll",
            OrganizationId = org.Id,
            EventDate = new DateOnly(2026, 4, 9),
            EventTime = new TimeOnly(19, 0),
            EventLocation = "Bönerummet",
            UseCount = 1,
            LastUsedAt = prev3Date,
            CreatedAt = prev3Date, CreatedBy = user.Id,
            UpdatedAt = prev3Date, UpdatedBy = user.Id,
            Items =
            [
                new PresentationItem { SourceId = uppMinTunga.Id, Type = PresentationItemType.Song, Title = "Upp, min tunga, att lovsjunga", SortOrder = 0,
                    Parts = [ new PresentationItemPart { Content = uppMinTunga.Parts[0].Content, SortOrder = 0 } ] },
            ]
        });

        var prev4Date = new DateTimeOffset(2026, 4, 6, 11, 0, 0, TimeSpan.Zero);
        db.Presentations.Add(new Presentation
        {
            Id = "sv-pres-prev2",
            Name = "Söndagsgudstjänst",
            OrganizationId = org.Id,
            EventDate = new DateOnly(2026, 4, 6),
            EventTime = new TimeOnly(11, 0),
            EventLocation = "Stora salen",
            UseCount = 1,
            LastUsedAt = prev4Date,
            CreatedAt = prev4Date, CreatedBy = user.Id,
            UpdatedAt = prev4Date, UpdatedBy = user.Id,
            Items =
            [
                new PresentationItem { SourceId = denBlomstertid.Id, Type = PresentationItemType.Song, Title = "Den blomstertid nu kommer", SortOrder = 0,
                    Parts = [ new PresentationItemPart { Content = denBlomstertid.Parts[0].Content, SortOrder = 0 } ] },
                new PresentationItem { SourceId = oStoreGud.Id, Type = PresentationItemType.Song, Title = "O store Gud", SortOrder = 1,
                    Parts = [ new PresentationItemPart { Content = oStoreGud.Parts[0].Content, SortOrder = 0 } ] },
            ]
        });

        db.OverlaySlides.AddRange(
            new OverlaySlide { Id = "sv-overlay-1", Title = "Välkommen", Content = "Välkommen till Foo Bar Kyrka!", SortOrder = 0, OrganizationId = org.Id },
            new OverlaySlide { Id = "sv-overlay-2", Title = "Kollekt", Content = "Kollekt · Swish 123-456 78 90", SortOrder = 1, OrganizationId = org.Id },
            new OverlaySlide { Id = "sv-overlay-3", Title = "Fika", Content = "Fika serveras i källaren efter gudstjänsten", SortOrder = 2, OrganizationId = org.Id }
        );

        var svBookCodes = new[]
        {
            "GEN","EXO","LEV","NUM","DEU","JOS","JDG","RUT",
            "1SA","2SA","1KI","2KI","1CH","2CH","EZR","NEH","EST",
            "JOB","PSA","PRO","ECC","SNG",
            "ISA","JER","LAM","EZK","DAN",
            "HOS","JOL","AMO","OBA","JON","MIC","NAM","HAB","ZEP","HAG","ZEC","MAL",
            "MAT","MRK","LUK","JHN","ACT",
            "ROM","1CO","2CO","GAL","EPH","PHP","COL","1TH","2TH",
            "1TI","2TI","TIT","PHM","HEB","JAS","1PE","2PE",
            "1JN","2JN","3JN","JUD","REV"
        };
        db.Bibles.Add(new DbBible
        {
            Id = "sv-bible-1",
            Name = "Svenska Bibeln 1917",
            Abbreviation = "SB1917",
            OrganizationId = org.Id,
            VersesJson = BuildBibleVersesJson(svBookCodes),
            VerseCount = svBookCodes.Length
        });
    }

    static void SeedEnglish(PresentationContext db, DateTimeOffset now)
    {
        var org = new Organization { Id = "mock-org-en", Name = "Foo Bar Church" };
        db.Organizations.Add(org);

        var user = new User
        {
            Id = "mock-user-en",
            Name = "Foo Bar",
            Email = "foo@foobar.church",
            Role = UserRole.Admin,
            OrganizationId = org.Id,
            Logins = [new UserLogin { Provider = "mock", ProviderSubjectId = "mock-en" }]
        };
        db.Users.Add(user);

        // Song part labels
        var verse = new DbSongPartLabel { Id = "en-label-verse", Text = "Verse", Color = "#3b82f6", SortOrder = 0, OrganizationId = org.Id };
        var chorus = new DbSongPartLabel { Id = "en-label-chorus", Text = "Chorus", Color = "#f97316", SortOrder = 1, OrganizationId = org.Id };
        var bridge = new DbSongPartLabel { Id = "en-label-bridge", Text = "Bridge", Color = "#a855f7", SortOrder = 2, OrganizationId = org.Id };
        var intro = new DbSongPartLabel { Id = "en-label-intro", Text = "Intro", Color = "#6b7280", SortOrder = 3, OrganizationId = org.Id };
        db.SongPartLabels.AddRange(verse, chorus, bridge, intro);

        // Songs (public domain only)
        var amazingGrace = new DbSong
        {
            Id = "en-song-1", Name = "Amazing Grace", Author = "John Newton", Year = 1779,
            OrganizationId = org.Id,
            Parts =
            [
                new DbSongPart { Id = "en-s1-p1", LabelId = verse.Id, SortOrder = 0, Content = "Amazing grace, how sweet the sound\nThat saved a wretch like me!\nI once was lost, but now am found,\nWas blind, but now I see." },
                new DbSongPart { Id = "en-s1-p2", LabelId = verse.Id, SortOrder = 1, Content = "'Twas grace that taught my heart to fear,\nAnd grace my fears relieved;\nHow precious did that grace appear\nThe hour I first believed." },
                new DbSongPart { Id = "en-s1-p3", LabelId = verse.Id, SortOrder = 2, Content = "Through many dangers, toils and snares\nI have already come;\n'Tis grace hath brought me safe thus far,\nAnd grace will lead me home." },
                new DbSongPart { Id = "en-s1-p4", LabelId = verse.Id, SortOrder = 3, Content = "When we've been there ten thousand years,\nBright shining as the sun,\nWe'll have no less to sing God's praise\nThan when we first begun." },
            ],
            Arrangements = [new DbSongArrangement { Id = "en-arr-1", PartIdsJson = "[\"en-s1-p1\",\"en-s1-p2\",\"en-s1-p3\",\"en-s1-p4\"]" }]
        };

        var holyHolyHoly = new DbSong
        {
            Id = "en-song-2", Name = "Holy, Holy, Holy", Author = "Reginald Heber", Year = 1826,
            OrganizationId = org.Id,
            Parts =
            [
                new DbSongPart { Id = "en-s2-p1", LabelId = verse.Id, SortOrder = 0, Content = "Holy, holy, holy! Lord God Almighty!\nEarly in the morning our song shall rise to thee;\nHoly, holy, holy! Merciful and mighty!\nGod in three persons, blessed Trinity!" },
                new DbSongPart { Id = "en-s2-p2", LabelId = verse.Id, SortOrder = 1, Content = "Holy, holy, holy! All the saints adore thee,\nCasting down their golden crowns around the glassy sea;\nCherubim and seraphim falling down before thee,\nWhich wert, and art, and evermore shalt be." },
                new DbSongPart { Id = "en-s2-p3", LabelId = verse.Id, SortOrder = 2, Content = "Holy, holy, holy! Though the darkness hide thee,\nThough the eye of sinful man thy glory may not see;\nOnly thou art holy; there is none beside thee,\nPerfect in power, in love and purity." },
                new DbSongPart { Id = "en-s2-p4", LabelId = verse.Id, SortOrder = 3, Content = "Holy, holy, holy! Lord God Almighty!\nAll thy works shall praise thy name in earth and sky and sea;\nHoly, holy, holy! Merciful and mighty!\nGod in three persons, blessed Trinity!" },
            ],
            Arrangements = [new DbSongArrangement { Id = "en-arr-2", PartIdsJson = "[\"en-s2-p1\",\"en-s2-p2\",\"en-s2-p3\",\"en-s2-p4\"]" }]
        };

        var abideWithMe = new DbSong
        {
            Id = "en-song-3", Name = "Abide With Me", Author = "Henry Lyte", Year = 1847,
            OrganizationId = org.Id,
            Parts =
            [
                new DbSongPart { Id = "en-s3-p1", LabelId = verse.Id, SortOrder = 0, Content = "Abide with me; fast falls the eventide;\nThe darkness deepens; Lord, with me abide;\nWhen other helpers fail and comforts flee,\nHelp of the helpless, oh, abide with me." },
                new DbSongPart { Id = "en-s3-p2", LabelId = verse.Id, SortOrder = 1, Content = "Swift to its close ebbs out life's little day;\nEarth's joys grow dim, its glories pass away;\nChange and decay in all around I see;\nO thou who changest not, abide with me." },
                new DbSongPart { Id = "en-s3-p3", LabelId = verse.Id, SortOrder = 2, Content = "I need thy presence every passing hour;\nWhat but thy grace can foil the tempter's power?\nWho, like thyself, my guide and stay can be?\nThrough cloud and sunshine, Lord, abide with me." },
            ],
            Arrangements = [new DbSongArrangement { Id = "en-arr-3", PartIdsJson = "[\"en-s3-p1\",\"en-s3-p2\",\"en-s3-p3\"]" }]
        };

        var toGodBeGlory = new DbSong
        {
            Id = "en-song-4", Name = "To God Be the Glory", Author = "Fanny Crosby", Year = 1875,
            OrganizationId = org.Id,
            Parts =
            [
                new DbSongPart { Id = "en-s4-p1", LabelId = verse.Id, SortOrder = 0, Content = "To God be the glory, great things he hath done;\nSo loved he the world that he gave us his Son,\nWho yielded his life an atonement for sin,\nAnd opened the life-gate that all may go in." },
                new DbSongPart { Id = "en-s4-r1", LabelId = chorus.Id, SortOrder = 1, Content = "Praise the Lord, praise the Lord,\nLet the earth hear his voice!\nPraise the Lord, praise the Lord,\nLet the people rejoice!\nO come to the Father, through Jesus the Son,\nAnd give him the glory, great things he hath done!" },
                new DbSongPart { Id = "en-s4-p2", LabelId = verse.Id, SortOrder = 2, Content = "O perfect redemption, the purchase of blood,\nTo every believer the promise of God;\nThe vilest offender who truly believes,\nThat moment from Jesus a pardon receives." },
            ],
            Arrangements = [new DbSongArrangement { Id = "en-arr-4", PartIdsJson = "[\"en-s4-p1\",\"en-s4-r1\",\"en-s4-p2\",\"en-s4-r1\"]" }]
        };

        var allHailThePower = new DbSong
        {
            Id = "en-song-5", Name = "All Hail the Power of Jesus' Name", Author = "Edward Perronet", Year = 1779,
            OrganizationId = org.Id,
            Parts =
            [
                new DbSongPart { Id = "en-s5-p1", LabelId = verse.Id, SortOrder = 0, Content = "All hail the power of Jesus' name!\nLet angels prostrate fall;\nBring forth the royal diadem,\nAnd crown him Lord of all!" },
                new DbSongPart { Id = "en-s5-p2", LabelId = verse.Id, SortOrder = 1, Content = "Ye chosen seed of Israel's race,\nYe ransomed from the fall,\nHail him who saves you by his grace,\nAnd crown him Lord of all!" },
                new DbSongPart { Id = "en-s5-p3", LabelId = verse.Id, SortOrder = 2, Content = "Let every kindred, every tribe\nOn this terrestrial ball,\nTo him all majesty ascribe,\nAnd crown him Lord of all!" },
            ],
            Arrangements = [new DbSongArrangement { Id = "en-arr-5", PartIdsJson = "[\"en-s5-p1\",\"en-s5-p2\",\"en-s5-p3\"]" }]
        };

        db.Songs.AddRange(amazingGrace, holyHolyHoly, abideWithMe, toGodBeGlory, allHailThePower);

        // Bible text — KJV (public domain)
        var psalm23en =
            "The LORD is my shepherd; I shall not want.\n" +
            "He maketh me to lie down in green pastures:\n" +
            "he leadeth me beside the still waters.\n" +
            "He restoreth my soul: he leadeth me in the paths\n" +
            "of righteousness for his name's sake.\n\n" +
            "Yea, though I walk through the valley of the shadow of death,\n" +
            "I will fear no evil: for thou art with me;\n" +
            "thy rod and thy staff they comfort me.\n\n" +
            "Thou preparest a table before me in the presence of mine enemies:\n" +
            "thou anointest my head with oil; my cup runneth over.\n" +
            "Surely goodness and mercy shall follow me all the days of my life:\n" +
            "and I will dwell in the house of the LORD for ever.";

        var john316en =
            "For God so loved the world, that he gave his only begotten Son,\n" +
            "that whosoever believeth in him should not perish,\n" +
            "but have everlasting life.";

        var slideDeckEn = new PresentationSlides
        {
            Id = "en-slides-1", FileName = "Sunday Programme.pdf", PageCount = 0, CreatedAt = now
        };

        var mainPresentation = new Presentation
        {
            Id = "en-pres-main",
            Name = "Sunday Service",
            OrganizationId = org.Id,
            EventDate = new DateOnly(2026, 4, 20),
            EventTime = new TimeOnly(11, 0),
            EventLocation = "Main Hall",
            CreatedAt = now, CreatedBy = user.Id,
            UpdatedAt = now, UpdatedBy = user.Id,
            SlideDecks = [slideDeckEn],
            Items =
            [
                new PresentationItem
                {
                    SourceId = amazingGrace.Id, Type = PresentationItemType.Song, Title = "Amazing Grace", SortOrder = 0,
                    Parts =
                    [
                        new PresentationItemPart { Content = amazingGrace.Parts[0].Content, SortOrder = 0 },
                        new PresentationItemPart { Content = amazingGrace.Parts[1].Content, SortOrder = 1 },
                        new PresentationItemPart { Content = amazingGrace.Parts[2].Content, SortOrder = 2 },
                    ]
                },
                new PresentationItem
                {
                    Type = PresentationItemType.BibleText, Title = "Psalm 23:1–6", SortOrder = 1,
                    Parts = [new PresentationItemPart { Content = psalm23en, SortOrder = 0 }]
                },
                new PresentationItem
                {
                    SourceId = holyHolyHoly.Id, Type = PresentationItemType.Song, Title = "Holy, Holy, Holy", SortOrder = 2,
                    Parts =
                    [
                        new PresentationItemPart { Content = holyHolyHoly.Parts[0].Content, SortOrder = 0 },
                        new PresentationItemPart { Content = holyHolyHoly.Parts[1].Content, SortOrder = 1 },
                        new PresentationItemPart { Content = holyHolyHoly.Parts[2].Content, SortOrder = 2 },
                    ]
                },
                new PresentationItem { Type = PresentationItemType.Audio, Title = "Welcome Theme", SortOrder = 3, Parts = [] },
                new PresentationItem
                {
                    SourceId = abideWithMe.Id, Type = PresentationItemType.Song, Title = "Abide With Me", SortOrder = 4,
                    Parts =
                    [
                        new PresentationItemPart { Content = abideWithMe.Parts[0].Content, SortOrder = 0 },
                        new PresentationItemPart { Content = abideWithMe.Parts[1].Content, SortOrder = 1 },
                        new PresentationItemPart { Content = abideWithMe.Parts[2].Content, SortOrder = 2 },
                    ]
                },
                new PresentationItem { SourceId = slideDeckEn.Id, Type = PresentationItemType.Slides, Title = "Sunday Programme", SortOrder = 5, Parts = [] },
            ]
        };
        db.Presentations.Add(mainPresentation);

        var template = new Presentation
        {
            Id = "en-pres-template",
            Name = "Sunday Service",
            IsTemplate = true,
            OrganizationId = org.Id,
            ScheduledDayOfWeek = (int)DayOfWeek.Sunday,
            ScheduledTime = new TimeOnly(11, 0),
            CreatedAt = now, CreatedBy = user.Id,
            UpdatedAt = now, UpdatedBy = user.Id,
            Items =
            [
                new PresentationItem
                {
                    SourceId = amazingGrace.Id, Type = PresentationItemType.Song, Title = "Amazing Grace", SortOrder = 0,
                    Parts =
                    [
                        new PresentationItemPart { Content = amazingGrace.Parts[0].Content, SortOrder = 0 },
                        new PresentationItemPart { Content = amazingGrace.Parts[1].Content, SortOrder = 1 },
                    ]
                },
                new PresentationItem { Type = PresentationItemType.BibleText, Title = "Bible text", SortOrder = 1, Parts = [] },
                new PresentationItem
                {
                    SourceId = holyHolyHoly.Id, Type = PresentationItemType.Song, Title = "Holy, Holy, Holy", SortOrder = 2,
                    Parts =
                    [
                        new PresentationItemPart { Content = holyHolyHoly.Parts[0].Content, SortOrder = 0 },
                        new PresentationItemPart { Content = holyHolyHoly.Parts[1].Content, SortOrder = 1 },
                    ]
                },
            ]
        };
        db.Presentations.Add(template);

        // Second service today
        db.Presentations.Add(new Presentation
        {
            Id = "en-pres-evening",
            Name = "Evening Service",
            OrganizationId = org.Id,
            EventDate = new DateOnly(2026, 4, 20),
            EventTime = new TimeOnly(18, 0),
            EventLocation = "Main Hall",
            CreatedAt = now, CreatedBy = user.Id,
            UpdatedAt = now, UpdatedBy = user.Id,
            Items =
            [
                new PresentationItem { SourceId = abideWithMe.Id, Type = PresentationItemType.Song, Title = "Abide With Me", SortOrder = 0,
                    Parts = [ new PresentationItemPart { Content = abideWithMe.Parts[0].Content, SortOrder = 0 } ] },
                new PresentationItem { SourceId = allHailThePower.Id, Type = PresentationItemType.Song, Title = "All Hail the Power of Jesus' Name", SortOrder = 1,
                    Parts = [ new PresentationItemPart { Content = allHailThePower.Parts[0].Content, SortOrder = 0 } ] },
            ]
        });

        // Upcoming presentations
        db.Presentations.Add(new Presentation
        {
            Id = "en-pres-prayer",
            Name = "Prayer Meeting",
            OrganizationId = org.Id,
            EventDate = new DateOnly(2026, 4, 22),
            EventTime = new TimeOnly(19, 0),
            EventLocation = "Prayer Room",
            CreatedAt = now, CreatedBy = user.Id,
            UpdatedAt = now, UpdatedBy = user.Id,
            Items =
            [
                new PresentationItem { SourceId = abideWithMe.Id, Type = PresentationItemType.Song, Title = "Abide With Me", SortOrder = 0,
                    Parts = [ new PresentationItemPart { Content = abideWithMe.Parts[0].Content, SortOrder = 0 } ] },
            ]
        });

        db.Presentations.Add(new Presentation
        {
            Id = "en-pres-next1",
            Name = "Sunday Service",
            OrganizationId = org.Id,
            EventDate = new DateOnly(2026, 4, 27),
            EventTime = new TimeOnly(11, 0),
            EventLocation = "Main Hall",
            CreatedAt = now, CreatedBy = user.Id,
            UpdatedAt = now, UpdatedBy = user.Id,
            Items =
            [
                new PresentationItem { SourceId = amazingGrace.Id, Type = PresentationItemType.Song, Title = "Amazing Grace", SortOrder = 0,
                    Parts = [ new PresentationItemPart { Content = amazingGrace.Parts[0].Content, SortOrder = 0 } ] },
                new PresentationItem { Type = PresentationItemType.BibleText, Title = "Bible text", SortOrder = 1, Parts = [] },
            ]
        });

        db.Presentations.Add(new Presentation
        {
            Id = "en-pres-family",
            Name = "Family Service",
            OrganizationId = org.Id,
            EventDate = new DateOnly(2026, 5, 4),
            EventTime = new TimeOnly(11, 0),
            EventLocation = "Main Hall",
            CreatedAt = now, CreatedBy = user.Id,
            UpdatedAt = now, UpdatedBy = user.Id,
            Items =
            [
                new PresentationItem { SourceId = holyHolyHoly.Id, Type = PresentationItemType.Song, Title = "Holy, Holy, Holy", SortOrder = 0,
                    Parts = [ new PresentationItemPart { Content = holyHolyHoly.Parts[0].Content, SortOrder = 0 } ] },
                new PresentationItem { SourceId = toGodBeGlory.Id, Type = PresentationItemType.Song, Title = "To God Be the Glory", SortOrder = 1,
                    Parts = [ new PresentationItemPart { Content = toGodBeGlory.Parts[0].Content, SortOrder = 0 } ] },
            ]
        });

        db.Presentations.Add(new Presentation
        {
            Id = "en-pres-next2",
            Name = "Sunday Service",
            OrganizationId = org.Id,
            EventDate = new DateOnly(2026, 5, 11),
            EventTime = new TimeOnly(11, 0),
            EventLocation = "Main Hall",
            CreatedAt = now, CreatedBy = user.Id,
            UpdatedAt = now, UpdatedBy = user.Id,
            Items = []
        });

        // Previous presentations
        var prevDate = new DateTimeOffset(2026, 4, 13, 11, 0, 0, TimeSpan.Zero);
        var prevPresentation = new Presentation
        {
            Id = "en-pres-prev",
            Name = "Sunday Service",
            OrganizationId = org.Id,
            EventDate = new DateOnly(2026, 4, 13),
            EventTime = new TimeOnly(11, 0),
            EventLocation = "Main Hall",
            UseCount = 1,
            LastUsedAt = prevDate,
            CreatedAt = prevDate, CreatedBy = user.Id,
            UpdatedAt = prevDate, UpdatedBy = user.Id,
            Items =
            [
                new PresentationItem
                {
                    SourceId = holyHolyHoly.Id, Type = PresentationItemType.Song, Title = "Holy, Holy, Holy", SortOrder = 0,
                    Parts =
                    [
                        new PresentationItemPart { Content = holyHolyHoly.Parts[0].Content, SortOrder = 0 },
                        new PresentationItemPart { Content = holyHolyHoly.Parts[1].Content, SortOrder = 1 },
                    ]
                },
                new PresentationItem
                {
                    Type = PresentationItemType.BibleText, Title = "John 3:16", SortOrder = 1,
                    Parts = [new PresentationItemPart { Content = john316en, SortOrder = 0 }]
                },
                new PresentationItem
                {
                    SourceId = toGodBeGlory.Id, Type = PresentationItemType.Song, Title = "To God Be the Glory", SortOrder = 2,
                    Parts =
                    [
                        new PresentationItemPart { Content = toGodBeGlory.Parts[0].Content, SortOrder = 0 },
                        new PresentationItemPart { Content = toGodBeGlory.Parts[1].Content, SortOrder = 1 },
                        new PresentationItemPart { Content = toGodBeGlory.Parts[2].Content, SortOrder = 2 },
                    ]
                },
            ]
        };
        db.Presentations.Add(prevPresentation);

        var prev2Date = new DateTimeOffset(2026, 4, 12, 17, 0, 0, TimeSpan.Zero);
        db.Presentations.Add(new Presentation
        {
            Id = "en-pres-prev-youth",
            Name = "Youth Service",
            OrganizationId = org.Id,
            EventDate = new DateOnly(2026, 4, 12),
            EventTime = new TimeOnly(17, 0),
            EventLocation = "Youth Hall",
            UseCount = 1,
            LastUsedAt = prev2Date,
            CreatedAt = prev2Date, CreatedBy = user.Id,
            UpdatedAt = prev2Date, UpdatedBy = user.Id,
            Items =
            [
                new PresentationItem { SourceId = allHailThePower.Id, Type = PresentationItemType.Song, Title = "All Hail the Power of Jesus' Name", SortOrder = 0,
                    Parts = [ new PresentationItemPart { Content = allHailThePower.Parts[0].Content, SortOrder = 0 } ] },
            ]
        });

        var prev3Date = new DateTimeOffset(2026, 4, 9, 19, 0, 0, TimeSpan.Zero);
        db.Presentations.Add(new Presentation
        {
            Id = "en-pres-prev-prayer",
            Name = "Prayer Meeting",
            OrganizationId = org.Id,
            EventDate = new DateOnly(2026, 4, 9),
            EventTime = new TimeOnly(19, 0),
            EventLocation = "Prayer Room",
            UseCount = 1,
            LastUsedAt = prev3Date,
            CreatedAt = prev3Date, CreatedBy = user.Id,
            UpdatedAt = prev3Date, UpdatedBy = user.Id,
            Items =
            [
                new PresentationItem { SourceId = abideWithMe.Id, Type = PresentationItemType.Song, Title = "Abide With Me", SortOrder = 0,
                    Parts = [ new PresentationItemPart { Content = abideWithMe.Parts[0].Content, SortOrder = 0 } ] },
            ]
        });

        var prev4Date = new DateTimeOffset(2026, 4, 6, 11, 0, 0, TimeSpan.Zero);
        db.Presentations.Add(new Presentation
        {
            Id = "en-pres-prev2",
            Name = "Sunday Service",
            OrganizationId = org.Id,
            EventDate = new DateOnly(2026, 4, 6),
            EventTime = new TimeOnly(11, 0),
            EventLocation = "Main Hall",
            UseCount = 1,
            LastUsedAt = prev4Date,
            CreatedAt = prev4Date, CreatedBy = user.Id,
            UpdatedAt = prev4Date, UpdatedBy = user.Id,
            Items =
            [
                new PresentationItem { SourceId = amazingGrace.Id, Type = PresentationItemType.Song, Title = "Amazing Grace", SortOrder = 0,
                    Parts = [ new PresentationItemPart { Content = amazingGrace.Parts[0].Content, SortOrder = 0 } ] },
                new PresentationItem { SourceId = holyHolyHoly.Id, Type = PresentationItemType.Song, Title = "Holy, Holy, Holy", SortOrder = 1,
                    Parts = [ new PresentationItemPart { Content = holyHolyHoly.Parts[0].Content, SortOrder = 0 } ] },
            ]
        });

        db.OverlaySlides.AddRange(
            new OverlaySlide { Id = "en-overlay-1", Title = "Welcome", Content = "Welcome to Foo Bar Church!", SortOrder = 0, OrganizationId = org.Id },
            new OverlaySlide { Id = "en-overlay-2", Title = "Offering", Content = "Offering · Account 12345678", SortOrder = 1, OrganizationId = org.Id },
            new OverlaySlide { Id = "en-overlay-3", Title = "Coffee", Content = "Coffee served in the hall after the service", SortOrder = 2, OrganizationId = org.Id }
        );

        var enBookCodes = new[]
        {
            "GEN","EXO","LEV","NUM","DEU","JOS","JDG","RUT",
            "1SA","2SA","1KI","2KI","1CH","2CH","EZR","NEH","EST",
            "JOB","PSA","PRO","ECC","SNG",
            "ISA","JER","LAM","EZK","DAN",
            "HOS","JOL","AMO","OBA","JON","MIC","NAM","HAB","ZEP","HAG","ZEC","MAL",
            "MAT","MRK","LUK","JHN","ACT",
            "ROM","1CO","2CO","GAL","EPH","PHP","COL","1TH","2TH",
            "1TI","2TI","TIT","PHM","HEB","JAS","1PE","2PE",
            "1JN","2JN","3JN","JUD","REV"
        };
        db.Bibles.Add(new DbBible
        {
            Id = "en-bible-1",
            Name = "King James Version",
            Abbreviation = "KJV",
            OrganizationId = org.Id,
            VersesJson = BuildBibleVersesJson(enBookCodes),
            VerseCount = enBookCodes.Length
        });
    }

    static string BuildBibleVersesJson(string[] bookCodes)
    {
        var verses = bookCodes.Select(b => $"{{\"b\":\"{b}\",\"c\":1,\"v\":1,\"t\":\"...\"}}");
        return "[" + string.Join(",", verses) + "]";
    }
}
