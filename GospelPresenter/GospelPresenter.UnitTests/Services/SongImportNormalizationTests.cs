using System.Text;
using GospelPresenter.Shared.Contexts;
using GospelPresenter.Shared.Models;
using GospelPresenter.Shared.Proto;
using GospelPresenter.Shared.Services;
using GospelPresenter.Shared.State;
using Google.Protobuf;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Shouldly;
using ProtoAction = GospelPresenter.Shared.Proto.Action;
using ProtoPresentation = GospelPresenter.Shared.Proto.Presentation;

namespace GospelPresenter.UnitTests.Services;

/// <summary>
/// Songs imported before the parser started composing Unicode are stored decomposed, where "a" is
/// followed by a combining diaeresis rather than being the single character "a". Both forms render
/// identically, so a duplicate that is not recognised as one shows up in the song list as the same
/// title twice. Everything here is about the ordinal comparisons that decide that.
/// </summary>
public class SongImportNormalizationTests : IDisposable
{
    private const string OrgName = "Org";
    private const string ComposedTitle = "Advent är mörker och kyla";
    private const string ComposedLabel = "Refräng";

    private readonly SqliteConnection connection;
    private readonly IDbContextFactory<PresentationContext> factory;
    private readonly SongService service;
    private readonly Organization org;
    private readonly CallerContext caller;

    public SongImportNormalizationTests()
    {
        connection = new SqliteConnection("DataSource=:memory:");
        connection.Open();

        var options = new DbContextOptionsBuilder<PresentationContext>().UseSqlite(connection).Options;
        factory = new TestDbContextFactory(options);
        service = new SongService(factory);

        using var context = factory.CreateDbContext();
        context.Database.EnsureCreated();

        org = new Organization { Name = OrgName };
        context.Organizations.Add(org);
        context.SaveChanges();

        caller = new CallerContext("user", UserRole.Admin, org.Id);
    }

    public void Dispose()
    {
        connection.Dispose();
        GC.SuppressFinalize(this);
    }

    /// <summary>The song row a pre-normalisation import left behind.</summary>
    private void SeedDecomposedSong(string title)
    {
        using var context = factory.CreateDbContext();
        context.Songs.Add(new DbSong { Name = Nfd(title), OrganizationId = org.Id });
        context.SaveChanges();
    }

    [Fact]
    public async Task FindDuplicateNames_DecomposedNameInDatabase_MatchesComposedName()
    {
        SeedDecomposedSong(ComposedTitle);

        var duplicates = await service.FindDuplicateNamesAsync([ComposedTitle], org.Id, caller);

        duplicates.ShouldBe([ComposedTitle]);
    }

    [Fact]
    public async Task Import_SongAlreadyStoredDecomposed_IsSkippedInsteadOfDuplicated()
    {
        SeedDecomposedSong(ComposedTitle);

        var result = await service.ImportProPresenterFilesAsync(
            [($"{ComposedTitle}.pro", BuildSong(ComposedTitle, "Verse 1", "Text"))],
            org.Id, caller);

        result.Imported.ShouldBe(0);
        result.Skipped.ShouldBe(1);
        await using var context = factory.CreateDbContext();
        (await context.Songs.CountAsync()).ShouldBe(1);
    }

    [Fact]
    public async Task Import_SongAlreadyStoredDecomposed_ReplacesItWhenAsked()
    {
        SeedDecomposedSong(ComposedTitle);

        var result = await service.ImportProPresenterFilesAsync(
            [($"{ComposedTitle}.pro", BuildSong(ComposedTitle, "Verse 1", "Text"))],
            org.Id, caller, replaceExisting: true);

        result.Replaced.ShouldBe(1);
        result.Imported.ShouldBe(0);
        await using var context = factory.CreateDbContext();
        (await context.Songs.CountAsync()).ShouldBe(1);
    }

    [Fact]
    public async Task Import_LabelAlreadyStoredDecomposed_ReusesItInsteadOfCreatingASecond()
    {
        await using (var context = factory.CreateDbContext())
        {
            context.SongPartLabels.Add(new DbSongPartLabel
            {
                Text = Nfd(ComposedLabel),
                Color = "#e85d04",
                SortOrder = 0,
                OrganizationId = org.Id
            });
            await context.SaveChangesAsync();
        }

        await service.ImportProPresenterFilesAsync(
            [("Ny sång.pro", BuildSong("Ny sång", ComposedLabel, "Text"))],
            org.Id, caller);

        await using var check = factory.CreateDbContext();
        var labels = await check.SongPartLabels.Where(l => l.OrganizationId == org.Id).ToListAsync();
        labels.Count.ShouldBe(1);

        var part = await check.SongParts.SingleAsync();
        part.LabelId.ShouldBe(labels[0].Id);
    }

    [Fact]
    public async Task Import_UntitledPresentationName_IsStoredUnderTheFileName()
    {
        var result = await service.ImportProPresenterFilesAsync(
            [("Böneämnen.pro", BuildSong("Untitled", "Verse 1", "Text"))],
            org.Id, caller);

        result.Imported.ShouldBe(1);
        await using var context = factory.CreateDbContext();
        (await context.Songs.SingleAsync()).Name.ShouldBe("Böneämnen");
    }

    [Fact]
    public async Task Import_FileWithNoSlideText_IsReportedAsFailedRatherThanDropped()
    {
        var empty = new ProtoPresentation { Name = "Välkommen" }.ToByteArray();

        var result = await service.ImportProPresenterFilesAsync(
            [("Välkommen.pro", empty), ("Ny sång.pro", BuildSong("Ny sång", "Verse 1", "Text"))],
            org.Id, caller);

        result.Imported.ShouldBe(1);
        result.Failed.ShouldBe(1);
        result.Total.ShouldBe(2);
    }

    [Fact]
    public async Task Import_UnreadableFile_IsCountedInsteadOfAbortingTheBatch()
    {
        var garbage = new byte[] { 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF };
        // The point of the test is the throwing path, not merely an empty parse.
        Should.Throw<Exception>(() => ProPresenterParser.Parse(garbage, "Trasig"));

        var result = await service.ImportProPresenterFilesAsync(
            [("Trasig.pro", garbage), ("Ny sång.pro", BuildSong("Ny sång", "Verse 1", "Text"))],
            org.Id, caller);

        result.Imported.ShouldBe(1);
        result.Failed.ShouldBe(1);
    }

    private static string Nfd(string text) => text.Normalize(NormalizationForm.FormD);

    private static byte[] BuildSong(string presentationName, string groupLabel, string slideText)
    {
        var presentation = new ProtoPresentation { Name = presentationName };

        var cue = new Cue { Uuid = new UUID { String = "c1" } };
        cue.Actions.Add(new ProtoAction
        {
            Slide = new ProtoAction.Types.SlideType
            {
                Presentation = new PresentationSlide
                {
                    BaseSlide = new Slide
                    {
                        Elements =
                        {
                            new Slide.Types.Element
                            {
                                Element_ = new GraphicsElement
                                {
                                    Text = new GraphicsText
                                    {
                                        RtfData = ByteString.CopyFromUtf8("{\\rtf1\\ansi\n\\pard\\qc\n" + slideText + "\n}")
                                    }
                                }
                            }
                        }
                    }
                }
            }
        });
        presentation.Cues.Add(cue);

        var group = new ProtoPresentation.Types.CueGroup
        {
            Group = new Group { Uuid = new UUID { String = "g1" }, Name = groupLabel }
        };
        group.CueIdentifiers.Add(new UUID { String = "c1" });
        presentation.CueGroups.Add(group);

        return presentation.ToByteArray();
    }

    private class TestDbContextFactory(DbContextOptions<PresentationContext> options)
        : IDbContextFactory<PresentationContext>
    {
        public PresentationContext CreateDbContext() => new(options);
    }
}
