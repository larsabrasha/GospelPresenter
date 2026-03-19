using CommandLine;

namespace GospelPresenter.Screenshots;

class Options
{
    [Option("base-url", Default = "http://localhost:5253", HelpText = "Base URL of the running web app.")]
    public string BaseUrl { get; set; } = null!;

    [Option('o', "output", Default = "./screenshots", HelpText = "Directory to save screenshots to.")]
    public string Output { get; set; } = null!;

    [Option("install", Default = false, HelpText = "Install Playwright browsers and exit.")]
    public bool Install { get; set; }

    [Option("headed", Default = false, HelpText = "Run browser in headed mode (visible window).")]
    public bool Headed { get; set; }

    [Option('p', "parallel", Default = 4, HelpText = "Max number of browser contexts to run in parallel.")]
    public int Parallel { get; set; }
}
