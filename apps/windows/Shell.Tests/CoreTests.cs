// The Shell library over the real core and a copy of the demo data: the statements answered from SQLite, the views
// decoded, refusals and transactions as the Mac's Core has them.
using Xunit;

namespace GospelPresenter.Shell.Tests;

public sealed class CoreTests : IDisposable
{
    readonly string path = Path.Combine(Path.GetTempPath(), $"gp-shell-{Guid.NewGuid():N}.sqlite");
    readonly Database db;
    readonly Core core;

    public CoreTests()
    {
        File.Copy(Path.Combine(AppContext.BaseDirectory, "demo.sqlite"), path);
        db = new Database(path);
        core = new Core(db);
        core.Command("migrateOrgSchema");
    }

    public void Dispose()
    {
        db.Dispose();
        File.Delete(path);
    }

    [Fact]
    public void TheStartPageListsTheDemoPresentations()
    {
        var lists = core.StartPage("2000-01-01");

        var names = lists.SelectMany(l => l.Rows).Select(r => r.Name).ToList();
        Assert.NotEmpty(names);
        Assert.Equal(names.Count, db.Query("SELECT id FROM presentations WHERE deleted_at IS NULL", []).Length);
    }

    [Fact]
    public void TheStartPageGivesEachRowItsNumberOfItems()
    {
        var rows = core.StartPage("2000-01-01").SelectMany(l => l.Rows);

        Assert.Contains(rows, r => r.ItemCount > 0);
    }

    [Fact]
    public void TheStartPageTitlesItsListsWithTextKeys()
    {
        var titles = core.StartPage("2000-01-01").Select(l => l.Title);

        Assert.All(titles, title => Assert.StartsWith("presentations.", title));
    }

    [Fact]
    public void AViewWithArgumentsThatAreNotJsonIsRefused()
    {
        var refusal = Assert.Throws<Refusal>(() => core.Call("startPageView", "{"));

        Assert.Equal("invalid-args", refusal.Code);
    }

    [Fact]
    public void AStatementSqliteRefusesFailsTheCallAsSqlError()
    {
        db.Exec("ALTER TABLE presentations RENAME TO presentations_gone");

        var refusal = Assert.Throws<Refusal>(() => core.StartPage("2000-01-01"));

        Assert.StartsWith("sql-error: no such table: presentations", refusal.Code);
    }

    [Fact]
    public void ATransactionThatThrowsLeavesTheDatabaseAsItWas()
    {
        var before = db.Query("SELECT group_concat(name) FROM presentations", [])[0][0];

        Assert.Throws<InvalidOperationException>(() => core.Transaction<int>(() =>
        {
            db.Exec("UPDATE presentations SET name = 'gone'");
            throw new InvalidOperationException("stop");
        }));

        Assert.Equal(before, db.Query("SELECT group_concat(name) FROM presentations", [])[0][0]);
    }
}
