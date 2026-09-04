using System.Globalization;
using GospelPresenter.Shared.Localization;
using Microsoft.Extensions.Localization;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Shouldly;

namespace GospelPresenter.UnitTests.Localization;

/// <summary>
/// The seam that decides what language a render comes out in.
///
/// Blazor resolves every string from the ambient CultureInfo, which travels with the
/// ExecutionContext — so it belongs to whichever thread triggered the render. Once a device's hub
/// call, an announcement timer or another user's circuit can trigger one, the ambient culture stops
/// meaning anything about the person looking at the page, and the whole UI repaints in a language
/// nobody asked for. These tests pin the alternative: the answer comes from the circuit, not the
/// thread.
///
/// Against the real resource files on purpose. A fake localizer would agree with any
/// implementation, including one that ignores the pinned culture entirely.
/// </summary>
public class CircuitStringLocalizerTests
{
    /// <summary>A key whose two translations cannot be confused for each other.</summary>
    private const string Key = "MainLayout.Reload";
    private const string English = "Reload";
    private const string Swedish = "Ladda om";

    private static readonly IStringLocalizerFactory Factory =
        new ResourceManagerStringLocalizerFactory(
            new OptionsWrapper<LocalizationOptions>(new LocalizationOptions { ResourcesPath = "Resources" }),
            NullLoggerFactory.Instance);

    private static CircuitStringLocalizer<SharedResource> LocalizerPinnedTo(string language)
    {
        var culture = new CultureInfo(language);
        var circuit = new CircuitCulture();
        circuit.Pin(culture, culture);
        return new CircuitStringLocalizer<SharedResource>(Factory, circuit);
    }

    /// <summary>Guards the tests below: they prove nothing if the resource files are not being read.</summary>
    [Fact]
    public void Indexer_ForAPinnedCulture_ReadsTheRealResources()
    {
        LocalizerPinnedTo("sv")[Key].Value.ShouldBe(Swedish);
    }

    /// <summary>
    /// The bug, in one line: this is the render dispatched from a device's hub call, which carries
    /// the default language because a device sends no culture cookie and no Accept-Language.
    /// </summary>
    [Fact]
    public void Indexer_WhenTheThreadCarriesAnotherLanguage_StillAnswersInTheCircuitsLanguage()
    {
        var localizer = LocalizerPinnedTo("sv");
        using var thread = new AmbientCulture("en");

        localizer[Key].Value.ShouldBe(Swedish);
    }

    /// <summary>The container's own case: a thread that never had a culture set at all.</summary>
    [Fact]
    public void Indexer_WhenTheThreadHasNoLanguage_StillAnswersInTheCircuitsLanguage()
    {
        var localizer = LocalizerPinnedTo("sv");
        using var thread = new AmbientCulture(CultureInfo.InvariantCulture);

        localizer[Key].Value.ShouldBe(Swedish);
    }

    /// <summary>
    /// Arguments are formatted with CurrentCulture, not CurrentUICulture, so pinning only the UI
    /// culture would have produced a Swedish sentence with an English number in it.
    /// </summary>
    [Fact]
    public void Indexer_WithAnArgument_FormatsItInTheCircuitsCulture()
    {
        var localizer = LocalizerPinnedTo("sv");
        using var thread = new AmbientCulture("en");

        localizer["{0}", 1.5].Value.ShouldBe("1,5");
    }

    /// <summary>
    /// A host that never pins — a plain HTML response, a test, the MAUI app that sets the process
    /// culture instead — has to keep behaving exactly as it did before this class existed.
    /// </summary>
    [Fact]
    public void Indexer_WhenNothingIsPinned_FollowsTheThread()
    {
        var localizer = new CircuitStringLocalizer<SharedResource>(Factory, new CircuitCulture());
        using var thread = new AmbientCulture("sv");

        localizer[Key].Value.ShouldBe(Swedish);
    }

    [Fact]
    public void GetAllStrings_ForAPinnedCulture_AnswersInTheCircuitsLanguage()
    {
        var localizer = LocalizerPinnedTo("sv");
        using var thread = new AmbientCulture("en");

        localizer.GetAllStrings(includeParentCultures: true)
            .First(s => s.Name == Key).Value.ShouldBe(Swedish);
    }

    [Fact]
    public void Indexer_ForACircuitPinnedToEnglish_AnswersInEnglish()
    {
        var localizer = LocalizerPinnedTo("en");
        using var thread = new AmbientCulture("sv");

        localizer[Key].Value.ShouldBe(English);
    }

    /// <summary>Sets the thread's culture for the duration of a test and puts it back afterwards.</summary>
    private sealed class AmbientCulture : IDisposable
    {
        private readonly CultureInfo previousCulture = CultureInfo.CurrentCulture;
        private readonly CultureInfo previousUiCulture = CultureInfo.CurrentUICulture;

        public AmbientCulture(string language) : this(new CultureInfo(language))
        {
        }

        public AmbientCulture(CultureInfo culture)
        {
            CultureInfo.CurrentCulture = culture;
            CultureInfo.CurrentUICulture = culture;
        }

        public void Dispose()
        {
            CultureInfo.CurrentCulture = previousCulture;
            CultureInfo.CurrentUICulture = previousUiCulture;
        }
    }
}
