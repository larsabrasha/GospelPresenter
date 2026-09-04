using Microsoft.Extensions.Localization;

namespace GospelPresenter.Shared.Localization;

/// <summary>
/// The localizer every component gets, resolving against <see cref="CircuitCulture"/> rather than
/// the ambient thread culture.
///
/// This is the one seam worth owning: <c>_Imports.razor</c> injects <c>IStringLocalizer&lt;SharedResource&gt;</c>
/// into every component in the assembly, so replacing the registration fixes every render path at
/// once — including the ones reached from a device's hub call or an announcement timer — without a
/// single call site having to remember anything. See <see cref="CircuitCulture"/> for why those
/// paths render in the wrong language to begin with.
///
/// Both cultures are applied, not just the UI one: <c>L["Key", count]</c> formats its arguments with
/// <see cref="System.Globalization.CultureInfo.CurrentCulture"/>, so a Swedish string would otherwise
/// still have come back with an English number in it.
///
/// Scoped, so one belongs to each circuit. Every consumer of a localizer in this solution is scoped
/// or narrower (<c>SyncService</c>, <c>IMediaUploader</c>, the endpoint that renders the handover
/// page), so nothing rooted asks for one.
/// </summary>
public sealed class CircuitStringLocalizer<T> : IStringLocalizer<T>
{
    private readonly IStringLocalizer inner;
    private readonly CircuitCulture culture;

    public CircuitStringLocalizer(IStringLocalizerFactory factory, CircuitCulture culture)
    {
        // The same thing the framework's StringLocalizer<T> does: the resource set is addressed by
        // the marker type, and only the culture of the lookup is ours to decide.
        inner = factory.Create(typeof(T));
        this.culture = culture;
    }

    public LocalizedString this[string name]
    {
        get
        {
            using var scope = culture.Enter();
            return inner[name];
        }
    }

    public LocalizedString this[string name, params object[] arguments]
    {
        get
        {
            using var scope = culture.Enter();
            return inner[name, arguments];
        }
    }

    public IEnumerable<LocalizedString> GetAllStrings(bool includeParentCultures)
    {
        using var scope = culture.Enter();
        // Materialised inside the scope on purpose: the framework's implementation is lazy, and a
        // deferred enumeration would read the culture again once the scope was already gone.
        return inner.GetAllStrings(includeParentCultures).ToList();
    }
}
