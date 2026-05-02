using Microsoft.Playwright;

namespace GospelPresenter.E2ETests.Fixtures;

public static class SlideProbe
{
    // Pick a 6+ character word from a slide preview to use as a propagation probe.
    // Avoids short tokens that could collide with app chrome (e.g. menu labels).
    public static string ExtractProbe(string slideText)
    {
        var words = slideText
            .Split([' ', '\n', '\r', '\t', ',', '.', '!', '?', ';', ':'], StringSplitOptions.RemoveEmptyEntries)
            .Where(w => w.Length >= 6 && w.All(c => char.IsLetter(c) || c == '\''))
            .ToList();
        return words.FirstOrDefault() ?? slideText.Trim();
    }

    public static Task WaitForProbeOnPageAsync(IPage page, string probe, float timeoutMs = 5_000)
    {
        var escaped = probe.Replace("\\", "\\\\").Replace("'", "\\'");
        return page.WaitForFunctionAsync(
            $"() => document.body.textContent.includes('{escaped}')",
            new PageWaitForFunctionOptions { Timeout = timeoutMs });
    }
}
