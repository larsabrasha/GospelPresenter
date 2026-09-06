using System.Text;
using GospelPresenter.Shared.Proto;
using GospelPresenter.Shared.Services;
using Google.Protobuf;
using Shouldly;
using ProtoAction = GospelPresenter.Shared.Proto.Action;

namespace GospelPresenter.UnitTests.Services;

public class ProPresenterTitleTests
{
    [Theory]
    [InlineData("Untitled")]
    [InlineData("untitled")]
    [InlineData("Untitled 2")]
    [InlineData("Untitled-1")]
    [InlineData("   ")]
    [InlineData("")]
    public void Parse_PlaceholderPresentationName_UsesFileName(string presentationName)
    {
        var data = BuildPresentation(presentationName, "Verse 1", "Text");

        var song = ProPresenterParser.Parse(data, "Hos Dig");

        song.ShouldNotBeNull();
        song.Name.ShouldBe("Hos Dig");
    }

    [Fact]
    public void Parse_PlaceholderNameAndNoFileName_UsesCcliSongTitle()
    {
        var data = BuildPresentation("Untitled", "Verse 1", "Text", ccliTitle: "Pappa");

        var song = ProPresenterParser.Parse(data, fallbackTitle: null);

        song.ShouldNotBeNull();
        song.Name.ShouldBe("Pappa");
    }

    [Fact]
    public void Parse_BlankFileName_DoesNotBecomeTheTitle()
    {
        var data = BuildPresentation("Untitled", "Verse 1", "Text", ccliTitle: "Pappa");

        var song = ProPresenterParser.Parse(data, fallbackTitle: "   ");

        song.ShouldNotBeNull();
        song.Name.ShouldBe("Pappa");
    }

    [Fact]
    public void Parse_NoTitleAnywhere_FallsBackToUntitled()
    {
        var data = BuildPresentation("Untitled", "Verse 1", "Text");

        var song = ProPresenterParser.Parse(data, fallbackTitle: null);

        song.ShouldNotBeNull();
        song.Name.ShouldBe("Untitled");
    }

    [Fact]
    public void Parse_RealPresentationName_WinsOverFileNameAndCcli()
    {
        // The file name loses characters the file system forbids, so the presentation name is better.
        var data = BuildPresentation("Hos Dig - R. Gunnargard", "Verse 1", "Text", ccliTitle: "Hos Dig");

        var song = ProPresenterParser.Parse(data, "Hos Dig - R_ Gunnargard");

        song.ShouldNotBeNull();
        song.Name.ShouldBe("Hos Dig - R. Gunnargard");
    }

    [Fact]
    public void Parse_DecomposedText_IsNormalizedToComposedForm()
    {
        // ProPresenter stores its presentation name decomposed ("a" + combining diaeresis),
        // which reads the same but compares unequal to the composed form the app uses elsewhere.
        var data = BuildPresentation(
            Nfd("Äran och makten"),
            Nfd("Värs 1"),
            Nfd("Nåd över nåd"),
            author: Nfd("Björn Aslaksen"));

        var song = ProPresenterParser.Parse(data, "ignored");

        song.ShouldNotBeNull();
        song.Name.ShouldBe("Äran och makten");
        song.Author.ShouldBe("Björn Aslaksen");
        song.Parts[0].Label.ShouldBe("Värs 1");
        song.Parts[0].Content.ShouldBe("Nåd över nåd");
    }

    [Fact]
    public void Parse_DecomposedFileNameFallback_IsNormalizedToComposedForm()
    {
        var data = BuildPresentation("Untitled", "Verse 1", "Text");

        var song = ProPresenterParser.Parse(data, Nfd("Böneämnen"));

        song.ShouldNotBeNull();
        song.Name.ShouldBe("Böneämnen");
    }

    [Fact]
    public void Parse_NoSlideText_ReturnsNull()
    {
        var presentation = new Presentation { Name = "Valkommen" };
        presentation.CueGroups.Add(new Presentation.Types.CueGroup
        {
            Group = new Group { Uuid = new UUID { String = "g1" }, Name = "Verse 1" }
        });

        ProPresenterParser.Parse(presentation.ToByteArray(), "Valkommen").ShouldBeNull();
    }

    private static byte[] BuildPresentation(
        string presentationName,
        string groupLabel,
        string slideText,
        string? ccliTitle = null,
        string? author = null)
    {
        var presentation = new Presentation { Name = presentationName };

        if (ccliTitle is not null || author is not null)
        {
            presentation.Ccli = new Presentation.Types.CCLI
            {
                SongTitle = ccliTitle ?? "",
                Author = author ?? ""
            };
        }

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
                                    Text = new GraphicsText { RtfData = ByteString.CopyFromUtf8(Rtf(slideText)) }
                                }
                            }
                        }
                    }
                }
            }
        });
        presentation.Cues.Add(cue);

        var group = new Presentation.Types.CueGroup
        {
            Group = new Group { Uuid = new UUID { String = "g1" }, Name = groupLabel }
        };
        group.CueIdentifiers.Add(new UUID { String = "c1" });
        presentation.CueGroups.Add(group);

        return presentation.ToByteArray();
    }

    private static string Nfd(string text) => text.Normalize(NormalizationForm.FormD);

    private static string Rtf(string text) =>
        "{\\rtf1\\ansi\n\\pard\\qc\n" + text + "\n}";
}
