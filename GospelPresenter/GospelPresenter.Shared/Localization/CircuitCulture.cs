using System.Globalization;

namespace GospelPresenter.Shared.Localization;

/// <summary>
/// The language one circuit renders in, pinned once and never read from the ambient thread again.
///
/// Blazor resolves every localized string at render time from <see cref="CultureInfo.CurrentUICulture"/>,
/// and that value travels with the <see cref="System.Threading.ExecutionContext"/> — so it belongs to
/// whichever thread *triggered* a render, not to the person looking at the page. That is fine as long
/// as renders only ever start from the viewer's own click. They do not: a device's hub call
/// (<c>MirroredSessionProjector</c>), an announcement timer (<c>OrganizationChangeNotifier</c>), a
/// visitor's SSE request (<c>PublicOutputState</c>) and another user's circuit all write into the
/// singleton <c>SharedAppState</c>, and every subscribing circuit answers with
/// <c>InvokeAsync(StateHasChanged)</c> under the writer's context. A device carries no culture cookie
/// and no Accept-Language, so its context is the default language — and the operator's whole page
/// repaints in it. Every string changes at once, which reads as the entire UI flashing.
///
/// Pinned in <c>Routes.OnInitialized</c>, which runs on the circuit's own startup context inside the
/// request that established it, so request localization has already decided by then. Unpinned it
/// falls back to the ambient culture, which is exactly today's behaviour — so a host that never pins
/// (a plain HTML response, a test) is unaffected.
///
/// This replaces a <c>CultureInfo.DefaultThreadCurrent*Culture</c> assignment that used to live in
/// <c>Routes</c>. Those two fields are process-wide: on a server they made the most recently
/// connected visitor's language the fallback for every thread in the process that had none.
/// </summary>
public sealed class CircuitCulture
{
    private CultureInfo? culture;
    private CultureInfo? uiCulture;

    /// <summary>The culture for formatting — dates, numbers, sorting.</summary>
    public CultureInfo Culture => culture ?? CultureInfo.CurrentCulture;

    /// <summary>The culture resource lookups are resolved against.</summary>
    public CultureInfo UiCulture => uiCulture ?? CultureInfo.CurrentUICulture;

    /// <summary>Whether a language has been decided for this circuit, as opposed to inherited.</summary>
    public bool IsPinned => uiCulture is not null;

    /// <summary>
    /// Records the circuit's language. First call wins: a later render reached from a foreign thread
    /// must not be able to redefine what this circuit is, which is the whole point of the class.
    /// Picking another language goes through <c>/culture</c>, which redirects, and the fresh page load
    /// builds a new circuit.
    /// </summary>
    public void Pin(CultureInfo culture, CultureInfo uiCulture)
    {
        this.culture ??= culture;
        this.uiCulture ??= uiCulture;
    }

    /// <summary>
    /// Applies this circuit's culture to the calling thread until the returned scope is disposed.
    /// </summary>
    public CultureScope Enter() => new(Culture, UiCulture);

    /// <summary>
    /// Wraps work so it runs in this circuit's culture wherever it ends up being dispatched. Use it
    /// instead of a bare <c>InvokeAsync(...)</c> whenever the event that triggers the work can be
    /// raised by somebody else — a hub, a timer, another circuit.
    /// </summary>
    public Action Restore(Action work) =>
        () =>
        {
            using var scope = Enter();
            work();
        };

    /// <inheritdoc cref="Restore(Action)"/>
    public Func<Task> Restore(Func<Task> work) =>
        async () =>
        {
            using var scope = Enter();
            await work();
        };
}

/// <summary>
/// Sets the culture on the current thread and puts back what was there on dispose. Restoring
/// matters: this runs on pooled threads, and a culture left behind on one is how a wrong language
/// spreads to the next piece of work that lands there.
/// </summary>
public readonly struct CultureScope : IDisposable
{
    private readonly CultureInfo previousCulture;
    private readonly CultureInfo previousUiCulture;

    internal CultureScope(CultureInfo culture, CultureInfo uiCulture)
    {
        previousCulture = CultureInfo.CurrentCulture;
        previousUiCulture = CultureInfo.CurrentUICulture;
        CultureInfo.CurrentCulture = culture;
        CultureInfo.CurrentUICulture = uiCulture;
    }

    public void Dispose()
    {
        CultureInfo.CurrentCulture = previousCulture;
        CultureInfo.CurrentUICulture = previousUiCulture;
    }
}
