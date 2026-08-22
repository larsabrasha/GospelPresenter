using Bunit;
using Bunit.TestDoubles;
using GospelPresenter.Shared.Localization;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Localization;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;

namespace GospelPresenter.UnitTests.Support;

/// <summary>
/// Shared setup for component tests. The localizer is the real one reading the real .resx files
/// rather than a stub, so a test that asserts on rendered text also proves the key exists in
/// SharedResource — a missing key renders as the key name and would otherwise pass unnoticed.
/// </summary>
public abstract class ComponentTestBase : TestContext
{
    protected ComponentTestBase()
    {
        JSInterop.Mode = JSRuntimeMode.Loose;
        Services.AddLogging();

        // ResourcesPath has to match SharedServicesSetup, or every lookup silently returns the key
        // name instead of the translation and assertions on rendered text pass for the wrong reason.
        var options = new LocalizationOptions { ResourcesPath = "Resources" };
        Services.AddLocalization(o => o.ResourcesPath = options.ResourcesPath);
        Services.AddSingleton<IStringLocalizer<SharedResource>>(
            new StringLocalizer<SharedResource>(
                new ResourceManagerStringLocalizerFactory(
                    new OptionsWrapper<LocalizationOptions>(options),
                    NullLoggerFactory.Instance)));
    }

    protected FakeNavigationManager Navigation => Services.GetRequiredService<FakeNavigationManager>();
}
