using System.Globalization;
using Bunit;
using GospelPresenter.Shared.Components.Presentations.AddItem.Slides;
using GospelPresenter.Shared.Localization;
using GospelPresenter.Shared.Services;
using GospelPresenter.Shared.State;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Localization;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Shouldly;

namespace GospelPresenter.UnitTests.Components;

/// <summary>
/// The PowerPoint tab in a host that cannot convert one. Turning a .pptx into slides needs the
/// converter the web host talks to, so the device apps have nothing to offer here — and offering
/// an upload button anyway is worse than saying so: the user picks a file, waits, and gets an
/// error that reads like a bug.
/// </summary>
public class SlidesTabHonestyTests : TestContext
{
    private sealed class Capabilities(bool uploadEndpoints) : IAppCapabilities
    {
        public bool RemoteControl => false;
        public bool PublicOutput => false;
        public bool PairedDisplays => false;
        public bool CalendarSubscriptions => false;
        public bool UserAdministration => false;
        public bool ProfileEditing => false;
        public bool UploadEndpoints => uploadEndpoints;
    }

    private void Arrange(bool uploadEndpoints)
    {
        var swedish = new CultureInfo("sv");
        var circuit = new CircuitCulture();
        circuit.Pin(swedish, swedish);

        JSInterop.Mode = JSRuntimeMode.Loose;

        Services.AddSingleton(circuit);
        Services.AddSingleton<ToastService>();
        Services.AddSingleton(new ActiveOrganizationState());
        Services.AddSingleton<IAppCapabilities>(new Capabilities(uploadEndpoints));
        Services.AddSingleton<IStringLocalizerFactory>(
            new ResourceManagerStringLocalizerFactory(
                new OptionsWrapper<LocalizationOptions>(new LocalizationOptions { ResourcesPath = "Resources" }),
                NullLoggerFactory.Instance));
        Services.AddScoped(typeof(IStringLocalizer<>), typeof(CircuitStringLocalizer<>));
    }

    [Fact]
    public void WithoutUploadEndpoints_SaysWhereTheImportHasToBeDone()
    {
        Arrange(uploadEndpoints: false);

        var tab = RenderComponent<SlidesTab>(p => p.Add(t => t.PresentationId, "p1"));

        tab.Markup.ShouldContain("webbappen");
    }

    [Fact]
    public void WithoutUploadEndpoints_OffersNoFileToPick()
    {
        Arrange(uploadEndpoints: false);

        var tab = RenderComponent<SlidesTab>(p => p.Add(t => t.PresentationId, "p1"));

        tab.FindAll("input[type=\"file\"]").ShouldBeEmpty();
    }

    /// <summary>With no input and nowhere to hand files, the zone must not invite a drop either.</summary>
    [Fact]
    public void WithoutUploadEndpoints_DoesNotOfferToTakeADrop()
    {
        Arrange(uploadEndpoints: false);

        var tab = RenderComponent<SlidesTab>(p => p.Add(t => t.PresentationId, "p1"));

        JSInterop.VerifyInvoke("gospelPresenter.registerDropZone").Arguments[4].ShouldBe(false);
    }

    [Fact]
    public void WithUploadEndpoints_OffersTheUpload()
    {
        Arrange(uploadEndpoints: true);

        var tab = RenderComponent<SlidesTab>(p => p.Add(t => t.PresentationId, "p1"));

        tab.FindAll("input[type=\"file\"]").Count.ShouldBe(1);
    }
}
