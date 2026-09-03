using Microsoft.AspNetCore.Components;
using Microsoft.JSInterop;

namespace GospelPresenter.Shared.Components;

/// <summary>
/// Shared value ownership for the text inputs.
///
/// Blazor renders a text field's <c>value</c> from server state, and its diff writes that
/// value into the DOM whenever it differs from the previously rendered one. Over a circuit
/// the server is always at least one roundtrip behind the keyboard, so any re-render that
/// lands while someone is typing writes back a value one or more keystrokes stale, and the
/// characters they just typed disappear. It does not take an expensive handler to trigger:
/// an autosave, a live-session callback or a search returning is enough.
///
/// So the DOM owns the value from the first keystroke onwards. <see cref="Value"/> is
/// tracked as usual until then — an async load filling in a form works the way it always
/// has — and after that the field only accepts a new value when the caller bumps
/// <see cref="Revision"/> to say it set one on purpose.
/// </summary>
public abstract class DomOwnedInputBase : ComponentBase, IAsyncDisposable
{
    [Inject] protected IJSRuntime JsRuntime { get; set; } = default!;

    [Parameter] public string? Value { get; set; }

    /// <summary>
    /// Bump whenever the app sets <see cref="Value"/> itself after the user may have typed:
    /// a clear button, a reset, loading a different record into an open form. Without a bump
    /// the field keeps what the user typed, which is the whole point — but it also means a
    /// forgotten bump shows up as a field that quietly refuses to update.
    /// </summary>
    [Parameter] public int Revision { get; set; }

    [Parameter] public EventCallback<string> ValueChanged { get; set; }

    /// <summary>
    /// Collapse bursts of keystrokes in the browser to at most one call per this many
    /// milliseconds, so an expensive handler is not run per character and no roundtrip is
    /// paid for the keystrokes in between. 0 leaves the field unthrottled, which is right
    /// for anything whose handler only assigns a field.
    /// </summary>
    [Parameter] public int ThrottleMs { get; set; }

    protected ElementReference InputElement;

    /// <summary>
    /// What the <c>value</c> attribute renders as. Deliberately stops following
    /// <see cref="Value"/> once the user has typed.
    /// </summary>
    protected string? RenderedValue { get; private set; }

    private DotNetObjectReference<DomOwnedInputBase>? selfReference;
    private IJSObjectReference? throttleHandle;
    private bool userHasTyped;
    private int renderedRevision;
    private bool valueNeedsWriting;

    public ValueTask FocusAsync() => InputElement.FocusAsync();

    protected override void OnParametersSet()
    {
        var revisionBumped = Revision != renderedRevision;
        renderedRevision = Revision;

        if (!userHasTyped)
        {
            RenderedValue = Value;
            return;
        }

        if (!revisionBumped) return;

        // Take the new value and write it out ourselves. The render tree and the DOM have
        // deliberately diverged by now, so the diff cannot be relied on: bumping to a value the
        // tree already holds emits no edit at all, and clearing a search field back to "" is
        // exactly that case.
        //
        // Ownership stays with the DOM. Handing it back to the server until the next keystroke
        // arrives would leave a window in which an unrelated re-render could write value again,
        // and the rule this class exists for is "never while the user is typing", not "rarely".
        RenderedValue = Value;
        valueNeedsWriting = true;
    }

    protected override async Task OnAfterRenderAsync(bool firstRender)
    {
        if (firstRender && ThrottleMs > 0)
        {
            selfReference = DotNetObjectReference.Create(this);
            throttleHandle = await JsRuntime.InvokeAsync<IJSObjectReference>(
                "initThrottledInput", InputElement, selfReference, ThrottleMs);
        }

        if (valueNeedsWriting)
        {
            valueNeedsWriting = false;

            // Drop any throttled call still pending first. It carries the text the user typed,
            // and delivering it after the app has deliberately set a different value would put
            // the caller's copy and the field out of step — with the caller holding the older
            // one. Resetting also clears the rate limit, so the next keystroke searches at once.
            if (throttleHandle is not null)
                await throttleHandle.InvokeVoidAsync("reset");

            await JsRuntime.InvokeVoidAsync("setInputValue", InputElement, RenderedValue ?? "");
        }
    }

    /// <summary>Called from the throttled listener in utils.js.</summary>
    [JSInvokable]
    public Task OnThrottledInput(string value) => AcceptUserValue(value);

    /// <summary>
    /// Wired to <c>@oninput</c>. For an unthrottled field this is the only path. For a
    /// throttled one it covers the window between the first render and the listener being
    /// installed, after which utils.js keeps the event from reaching Blazor at all.
    /// </summary>
    protected Task HandleInput(ChangeEventArgs e) => AcceptUserValue(e.Value?.ToString() ?? "");

    private Task AcceptUserValue(string value)
    {
        userHasTyped = true;
        return ValueChanged.InvokeAsync(value);
    }

    public async ValueTask DisposeAsync()
    {
        if (throttleHandle is not null)
        {
            try
            {
                await throttleHandle.InvokeVoidAsync("dispose");
                await throttleHandle.DisposeAsync();
            }
            catch (JSDisconnectedException)
            {
                // The circuit is already gone, and the listener went with the page.
            }
        }

        selfReference?.Dispose();
    }
}
