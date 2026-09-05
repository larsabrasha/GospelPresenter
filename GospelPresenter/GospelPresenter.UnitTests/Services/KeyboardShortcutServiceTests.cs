using GospelPresenter.Shared.Services;
using Shouldly;

namespace GospelPresenter.UnitTests.Services;

/// <summary>
/// The registry that decides which keystroke reaches which handler. Two rules matter enough to pin:
/// a modal has to silence the page underneath it, and two shortcuts on the same key have to be a
/// build-time complaint rather than a user-visible coin toss.
/// </summary>
public class KeyboardShortcutServiceTests
{
    private static string Token(string key, bool ctrl = false, bool shift = false) =>
        new Shortcut(key, Ctrl: ctrl, Shift: shift).ToToken();

    [Fact]
    public async Task HandleAsync_WithNoScopes_ReportsUnhandled()
    {
        var service = new KeyboardShortcutService();

        var handled = await service.HandleAsync(Token("n"));

        handled.ShouldBeFalse();
    }

    [Fact]
    public async Task HandleAsync_WithBoundKeystroke_RunsTheHandler()
    {
        var service = new KeyboardShortcutService();
        var ran = false;
        using var scope = service.PushScope("page");
        scope.Add(new Shortcut("n"), "desc", () => ran = true);

        await service.HandleAsync(Token("n"));

        ran.ShouldBeTrue();
    }

    [Fact]
    public async Task HandleAsync_WithNonBlockingScopeOnTop_FallsThroughToTheScopeBelow()
    {
        var service = new KeyboardShortcutService();
        var rootRan = false;
        using var root = service.PushScope("layout");
        root.Add(new Shortcut("?"), "desc", () => rootRan = true);
        using var page = service.PushScope("page");
        page.Add(new Shortcut("n"), "desc", () => { });

        await service.HandleAsync(Token("?"));

        rootRan.ShouldBeTrue();
    }

    [Fact]
    public async Task HandleAsync_WithBlockingScopeOnTop_DoesNotReachTheScopeBelow()
    {
        var service = new KeyboardShortcutService();
        var pageRan = false;
        using var page = service.PushScope("page");
        page.Add(new Shortcut("n"), "desc", () => pageRan = true);
        using var modal = service.PushScope("modal", blocking: true);

        await service.HandleAsync(Token("n"));

        pageRan.ShouldBeFalse();
    }

    [Fact]
    public async Task HandleAsync_WithTheSameKeyInTwoScopes_RunsTheTopmostOne()
    {
        var service = new KeyboardShortcutService();
        var winner = "";
        using var page = service.PushScope("page");
        page.Add(new Shortcut("n"), "desc", () => winner = "page");
        using var modal = service.PushScope("modal");
        modal.Add(new Shortcut("n"), "desc", () => winner = "modal");

        await service.HandleAsync(Token("n"));

        winner.ShouldBe("modal");
    }

    [Fact]
    public async Task HandleAsync_AfterTheTopScopeIsDisposed_ReachesThePageAgain()
    {
        var service = new KeyboardShortcutService();
        var pageRan = false;
        using var page = service.PushScope("page");
        page.Add(new Shortcut("n"), "desc", () => pageRan = true);
        var modal = service.PushScope("modal", blocking: true);
        modal.Dispose();

        await service.HandleAsync(Token("n"));

        pageRan.ShouldBeTrue();
    }

    [Fact]
    public void Add_WithAKeystrokeAlreadyBoundInTheSameScope_Throws()
    {
        var service = new KeyboardShortcutService();
        using var scope = service.PushScope("page");
        scope.Add(new Shortcut("n"), "first", () => { });

        Should.Throw<InvalidOperationException>(() => scope.Add(new Shortcut("n"), "second", () => { }));
    }

    [Fact]
    public void ActiveTokens_WithABlockingScope_LeavesOutTheKeysItSwallows()
    {
        var service = new KeyboardShortcutService();
        using var page = service.PushScope("page");
        page.Add(new Shortcut("n"), "desc", () => { });
        using var modal = service.PushScope("modal", blocking: true);
        modal.Add(new Shortcut("1", Ctrl: true), "desc", () => { });

        service.ActiveTokens.ShouldBe([Token("1", ctrl: true)]);
    }

    [Fact]
    public void ActiveTokens_WithANonBlockingScope_IncludesBothLevels()
    {
        var service = new KeyboardShortcutService();
        using var root = service.PushScope("layout");
        root.Add(new Shortcut("?"), "desc", () => { });
        using var page = service.PushScope("page");
        page.Add(new Shortcut("n"), "desc", () => { });

        service.ActiveTokens.ShouldBe([Token("n"), Token("?")], ignoreOrder: true);
    }

    [Fact]
    public void ActiveShortcutsChanged_WhenAScopeIsDisposed_IsRaised()
    {
        var service = new KeyboardShortcutService();
        var scope = service.PushScope("page");
        var raised = 0;
        service.ActiveShortcutsChanged += () => raised++;

        scope.Dispose();

        raised.ShouldBe(1);
    }

    /// <summary>
    /// The handler runs on the layout component's interop call, so Blazor re-renders the layout and
    /// nothing else. Without the scope's own refresh, a shortcut would set the flag that opens a
    /// dialog and the dialog would not appear until something unrelated caused a render.
    /// </summary>
    [Fact]
    public async Task HandleAsync_AfterRunningAHandler_RefreshesTheOwningComponent()
    {
        var service = new KeyboardShortcutService();
        var refreshed = 0;
        using var scope = service.PushScope("page", () =>
        {
            refreshed++;
            return Task.CompletedTask;
        });
        scope.Add(new Shortcut("n"), "desc", () => { });

        await service.HandleAsync(Token("n"));

        refreshed.ShouldBe(1);
    }

    [Fact]
    public async Task HandleAsync_WithNothingBound_DoesNotRefresh()
    {
        var service = new KeyboardShortcutService();
        var refreshed = 0;
        using var scope = service.PushScope("page", () =>
        {
            refreshed++;
            return Task.CompletedTask;
        });

        await service.HandleAsync(Token("n"));

        refreshed.ShouldBe(0);
    }

    [Fact]
    public void Describe_ListsTheNewestScopeFirst()
    {
        var service = new KeyboardShortcutService();
        using var page = service.PushScope("page");
        page.Add(new Shortcut("n"), "desc", () => { });
        using var modal = service.PushScope("modal");
        modal.Add(new Shortcut("1", Ctrl: true), "desc", () => { });

        service.Describe().Select(g => g.TitleKey).ShouldBe(["modal", "page"]);
    }

    [Fact]
    public void Describe_WithAnExcludedScope_LeavesItOut()
    {
        var service = new KeyboardShortcutService();
        using var page = service.PushScope("page");
        page.Add(new Shortcut("n"), "desc", () => { });
        using var help = service.PushScope("help");
        help.Add(new Shortcut("?"), "desc", () => { });

        service.Describe(help).Select(g => g.TitleKey).ShouldBe(["page"]);
    }

    [Fact]
    public void Describe_IncludesDocumentedKeystrokesThatNothingDispatches()
    {
        var service = new KeyboardShortcutService();
        using var scope = service.PushScope("page");
        scope.Document(new Shortcut("ArrowDown"), "Shortcuts.MoveThroughList");

        service.Describe().Single().Entries.Single().DescriptionKey.ShouldBe("Shortcuts.MoveThroughList");
    }

    [Fact]
    public async Task Document_DoesNotBindTheKeystroke()
    {
        var service = new KeyboardShortcutService();
        using var scope = service.PushScope("page");
        scope.Document(new Shortcut("ArrowDown"), "desc");

        var handled = await service.HandleAsync(Token("ArrowDown"));

        handled.ShouldBeFalse();
    }
}
