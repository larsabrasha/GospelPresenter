// The start page on the demo data: app.sqlite in the user's local app data, copied from the demo once, brought to
// today's schema, and the core's lists shown. Every call of the core is on this window's UI thread.
using GospelPresenter.Shell;
using Microsoft.UI.Composition.SystemBackdrops;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Media;

namespace GospelPresenter.App;

/// <summary>One of the start page's lists as the window draws it.</summary>
public sealed record ListModel(string Title, List<RowModel> Rows);

/// <summary>A presentation's row: its name, and its second line when there is one.</summary>
public sealed record RowModel(string Id, string Name, string Subtitle)
{
    public Visibility HasSubtitle => Subtitle.Length > 0 ? Visibility.Visible : Visibility.Collapsed;

    /// <summary>What a screen reader says for the row (a ListViewItem's name is its item's text), not the record's
    /// fields.</summary>
    public override string ToString() => Subtitle.Length > 0 ? $"{Name}, {Subtitle}" : Name;
}

public sealed partial class MainWindow : Window
{
    Core? core;

    public MainWindow()
    {
        InitializeComponent();
        // Mica only where Windows has it (11); elsewhere (10) the page keeps the theme's background brush.
        if (MicaController.IsSupported())
        {
            SystemBackdrop = new MicaBackdrop();
            Page.Background = null;
        }
        try
        {
            core = OpenDemo();
            Show(core);
        }
        catch (Exception e) when (e is SqlException or Refusal or IOException)
        {
            Problem.Message = e.Message;
            Problem.IsOpen = true;
        }
        Closed += (_, _) => core?.Db.Dispose();
    }

    /// <summary>The demo data on this device alone, as the Mac's openDemo: copied once, then kept.</summary>
    static Core OpenDemo()
    {
        var home = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "GospelPresenter");
        Directory.CreateDirectory(home);
        var path = Path.Combine(home, "app.sqlite");
        if (!File.Exists(path))
        {
            var demo = Path.Combine(AppContext.BaseDirectory, "demo.sqlite");
            if (!File.Exists(demo)) throw new IOException($"demo.sqlite saknas i {AppContext.BaseDirectory}");
            File.Copy(demo, path);
        }
        var db = new Database(path);
        db.Exec("PRAGMA journal_mode = WAL");
        var core = new Core(db);
        // The demo data as today's schema has it (it may be made by an older core).
        core.Command("migrateOrgSchema");
        return core;
    }

    void Show(Core core)
    {
        var today = Views.LocalToday();
        Lists.ItemsSource = core.StartPage(today).Select(list => new ListModel(
            Texts.T(list.Title),
            list.Rows.Select(r => new RowModel(r.Id, r.Name, r.Subtitle(today, list.ShowDate, list.WithYear))).ToList()
        )).ToList();
    }
}
