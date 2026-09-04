using System.Globalization;
using GospelPresenter.Shared.Localization;
using Shouldly;

namespace GospelPresenter.UnitTests.Localization;

/// <summary>
/// The language one circuit renders in. Two properties carry the weight: a circuit's language
/// cannot be redefined by a later render reached from a foreign thread, and the culture a dispatch
/// applies is put back afterwards — these run on pooled threads, and a culture left behind on one
/// is how a wrong language reaches the next piece of work that lands there.
/// </summary>
public class CircuitCultureTests
{
    private static readonly CultureInfo Swedish = new("sv");
    private static readonly CultureInfo EnglishCulture = new("en");

    [Fact]
    public void UiCulture_BeforePinning_FollowsTheThread()
    {
        var circuit = new CircuitCulture();

        circuit.UiCulture.ShouldBe(CultureInfo.CurrentUICulture);
    }

    [Fact]
    public void IsPinned_BeforePinning_IsFalse()
    {
        new CircuitCulture().IsPinned.ShouldBeFalse();
    }

    [Fact]
    public void UiCulture_AfterPinning_IsThePinnedOne()
    {
        var circuit = new CircuitCulture();

        circuit.Pin(Swedish, Swedish);

        circuit.UiCulture.ShouldBe(Swedish);
    }

    /// <summary>
    /// First call wins. A render reached from someone else's thread must not be able to redefine
    /// what this circuit is, which is the whole point of the class.
    /// </summary>
    [Fact]
    public void Pin_CalledTwice_KeepsTheFirstCulture()
    {
        var circuit = new CircuitCulture();
        circuit.Pin(Swedish, Swedish);

        circuit.Pin(EnglishCulture, EnglishCulture);

        circuit.UiCulture.ShouldBe(Swedish);
    }

    [Fact]
    public void Restore_RunsTheWorkInThePinnedCulture()
    {
        var circuit = new CircuitCulture();
        circuit.Pin(Swedish, Swedish);
        CultureInfo? seen = null;

        circuit.Restore(() => seen = CultureInfo.CurrentUICulture)();

        seen.ShouldBe(Swedish);
    }

    [Fact]
    public void Restore_PutsTheThreadsCultureBackAfterwards()
    {
        var circuit = new CircuitCulture();
        circuit.Pin(Swedish, Swedish);
        var before = CultureInfo.CurrentUICulture;

        circuit.Restore(() => { })();

        CultureInfo.CurrentUICulture.ShouldBe(before);
    }

    [Fact]
    public async Task Restore_ForAsyncWork_RunsItInThePinnedCulture()
    {
        var circuit = new CircuitCulture();
        circuit.Pin(Swedish, Swedish);
        CultureInfo? seen = null;

        await circuit.Restore(async () =>
        {
            await Task.Yield();
            seen = CultureInfo.CurrentUICulture;
        })();

        seen.ShouldBe(Swedish);
    }

    [Fact]
    public async Task Restore_ForAsyncWork_PutsTheThreadsCultureBackAfterwards()
    {
        var circuit = new CircuitCulture();
        circuit.Pin(Swedish, Swedish);
        var before = CultureInfo.CurrentUICulture;

        await circuit.Restore(async () => await Task.Yield())();

        CultureInfo.CurrentUICulture.ShouldBe(before);
    }
}
