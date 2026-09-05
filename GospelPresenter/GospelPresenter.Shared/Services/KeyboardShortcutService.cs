namespace GospelPresenter.Shared.Services;

/// <summary>
/// The circuit's shortcut registry: a stack of scopes where only the topmost one hears keystrokes.
/// A page pushes a scope when it renders, a modal pushes one on top, and the page falls silent for
/// as long as the modal is open. That is what stops "n" from creating a second presentation behind
/// a dialog that is already asking for the first one's name.
///
/// Only page-level *actions* belong here — create, add, rename, remove, focus the search box, open
/// help. Arrow-key movement inside a list does not: several lists can share a page (the presentation
/// editor has the item sidebar and the slide grid side by side), and the answer to "which list do
/// the arrows move?" is "the one the user is looking at", which is a question only real DOM focus
/// can answer. Those handlers stay local, on the list container. See <see cref="Utils.ListNavigation"/>.
/// </summary>
public sealed class KeyboardShortcutService
{
    private readonly List<ShortcutScope> scopes = [];

    /// <summary>
    /// Raised whenever the set of keystrokes the browser should intercept changes. The JS listener
    /// needs this: it has to decide <c>preventDefault</c> synchronously, and it cannot ask .NET in
    /// time, so it keeps its own copy of the active tokens.
    /// </summary>
    public event Action? ActiveShortcutsChanged;

    /// <summary>
    /// Whether this circuit's browser is on a Mac, so tooltips and the help dialog can write ⌘
    /// where that is what the user will press. Set once by the layout after it asks the browser;
    /// false until then, which is the safer guess — "Ctrl+K" on a Mac is merely wrong, whereas "⌘K"
    /// on Windows names a key that is not on the keyboard.
    /// </summary>
    public bool IsMac { get; set; }

    /// <summary>
    /// Opens a scope on top of the stack. Dispose it — normally from the component's own
    /// <c>Dispose</c> — to hand control back to the scope beneath.
    /// </summary>
    /// <param name="titleKey">Resource key naming this group in the help dialog.</param>
    /// <param name="refresh">
    /// Re-renders the component that owns the scope, run after each of its handlers. A handler
    /// arrives on a JS interop call belonging to the layout component that owns the listener, so
    /// Blazor re-renders that one and nothing else: without this, a shortcut would set the flag that
    /// opens a dialog and the dialog would appear on the next unrelated render. Taken once per scope
    /// rather than per handler, so that a new shortcut cannot be added without it.
    /// </param>
    /// <param name="blocking">
    /// True for a modal dialog: keystrokes it does not bind are swallowed rather than passed to the
    /// page behind it, so "n" cannot start a second presentation while a dialog is already asking
    /// for the first one's name. A page scope leaves this false and falls through to the layout's
    /// scope beneath, which is what keeps "?" working everywhere.
    /// </param>
    public ShortcutScope PushScope(string titleKey, Func<Task>? refresh = null, bool blocking = false)
    {
        var scope = new ShortcutScope(this, titleKey, refresh, blocking);
        scopes.Add(scope);
        return scope;
    }

    internal void Pop(ShortcutScope scope)
    {
        if (scopes.Remove(scope))
            NotifyChanged();
    }

    internal void NotifyChanged() => ActiveShortcutsChanged?.Invoke();

    /// <summary>The keystrokes currently reachable, as JS-comparable tokens.</summary>
    public IReadOnlyCollection<string> ActiveTokens
    {
        get
        {
            var tokens = new HashSet<string>();
            foreach (var scope in Reachable())
                tokens.UnionWith(scope.DispatchTokens);
            return tokens;
        }
    }

    /// <summary>
    /// Runs the handler for this keystroke, searching from the topmost scope down. Returns false
    /// when nothing is bound, which the caller may treat as "the browser should have kept it".
    /// </summary>
    public async Task<bool> HandleAsync(string token)
    {
        foreach (var scope in Reachable())
        {
            var handler = scope.Find(token);
            if (handler is null) continue;
            await handler();
            await scope.RefreshAsync();
            return true;
        }

        return false;
    }

    /// <summary>
    /// The scopes a keystroke can still reach: from the top down, stopping after the first blocking
    /// one — that scope is itself reachable, everything under it is not.
    /// </summary>
    private IEnumerable<ShortcutScope> Reachable()
    {
        for (var i = scopes.Count - 1; i >= 0; i--)
        {
            yield return scopes[i];
            if (scopes[i].Blocking) yield break;
        }
    }

    /// <summary>
    /// Every shortcut currently registered, newest scope first, for the help dialog. Includes
    /// documentation-only entries and the scopes that are currently shadowed — the dialog is a
    /// reference for the page behind it, not a list of what would fire while it is open.
    /// </summary>
    /// <param name="exclude">The dialog's own scope, which has nothing to teach the reader.</param>
    public IReadOnlyList<ShortcutGroup> Describe(ShortcutScope? exclude = null) =>
        scopes
            .Where(s => s != exclude && s.Entries.Count > 0)
            .Reverse()
            .Select(s => new ShortcutGroup(s.TitleKey, s.Entries))
            .ToList();
}

/// <summary>One heading's worth of shortcuts in the help dialog.</summary>
public sealed record ShortcutGroup(string TitleKey, IReadOnlyList<ShortcutEntry> Entries);

/// <summary>A single line in the help dialog: the keystroke and what it does.</summary>
public sealed record ShortcutEntry(Shortcut Shortcut, string DescriptionKey);

public sealed class ShortcutScope : IDisposable
{
    private readonly KeyboardShortcutService owner;
    private readonly Dictionary<string, Func<Task>> handlers = [];
    private readonly List<ShortcutEntry> entries = [];
    private bool disposed;

    private readonly Func<Task>? refresh;

    internal ShortcutScope(KeyboardShortcutService owner, string titleKey, Func<Task>? refresh, bool blocking)
    {
        this.owner = owner;
        this.refresh = refresh;
        TitleKey = titleKey;
        Blocking = blocking;
    }

    internal Task RefreshAsync() => refresh?.Invoke() ?? Task.CompletedTask;

    public string TitleKey { get; }

    internal bool Blocking { get; }

    internal IReadOnlyList<ShortcutEntry> Entries => entries;

    internal IReadOnlyCollection<string> DispatchTokens => handlers.Keys;

    internal Func<Task>? Find(string token) => handlers.GetValueOrDefault(token);

    /// <summary>
    /// Binds a keystroke and lists it in the help dialog. Binding the same keystroke twice in one
    /// scope throws rather than letting the later registration win silently: two shortcuts that
    /// collide is a bug the author should hear about at the moment they write it, not something a
    /// user discovers when one of two buttons stops responding.
    /// </summary>
    public ShortcutScope Add(Shortcut shortcut, string descriptionKey, Func<Task> handler)
    {
        var token = shortcut.ToToken();
        if (handlers.ContainsKey(token))
            throw new InvalidOperationException(
                $"The keystroke '{token}' is already bound in the '{TitleKey}' shortcut scope.");

        handlers[token] = handler;
        entries.Add(new ShortcutEntry(shortcut, descriptionKey));
        owner.NotifyChanged();
        return this;
    }

    /// <inheritdoc cref="Add(Shortcut,string,Func{Task})"/>
    public ShortcutScope Add(Shortcut shortcut, string descriptionKey, Action handler) =>
        Add(shortcut, descriptionKey, () =>
        {
            handler();
            return Task.CompletedTask;
        });

    /// <summary>
    /// Lists a keystroke in the help dialog without binding it. For the conventions handled by the
    /// focused element itself — arrow keys moving through a list, Enter opening the focused row —
    /// which are real shortcuts to the reader even though no entry in this registry dispatches them.
    /// </summary>
    public ShortcutScope Document(Shortcut shortcut, string descriptionKey)
    {
        entries.Add(new ShortcutEntry(shortcut, descriptionKey));
        return this;
    }

    public void Dispose()
    {
        if (disposed) return;
        disposed = true;
        owner.Pop(this);
    }
}
