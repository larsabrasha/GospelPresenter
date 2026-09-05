using System.Text.Json;
using GospelPresenter.Shared.Services;
using Microsoft.JSInterop;
using Microsoft.JSInterop.Infrastructure;
using Shouldly;

namespace GospelPresenter.UnitTests.State;

/// <summary>
/// A live window crosses into JavaScript and back: out as the object the script turns into the
/// window's URL, and in again as what the window says about itself when the operator's panel asks
/// who is out there. The names and the spelling of the role are a contract with <c>utils.js</c>.
///
/// It is worth pinning because nothing else would notice it breaking. A role that failed to read
/// would come back as a live view, so a reloaded operator page would list the projector as
/// "Live view (0)" and show its own projector toggle as off — no exception, just an output the
/// panel describes wrongly and a second projector the next time it restores.
/// </summary>
public class LiveWindowEntryContractTests
{
    private static readonly JsonSerializerOptions BlazorOptions = new TestJSRuntime().Options;

    [Fact]
    public void Writing_UsesTheNamesTheScriptReads()
    {
        var json = JsonSerializer.Serialize(
            new LiveWindowEntry("session-1", "window-1", "Live view (2)", LiveWindowRole.Live, 2), BlazorOptions);

        json.ShouldContain("\"sessionId\"");
        json.ShouldContain("\"windowId\"");
        json.ShouldContain("\"title\"");
        json.ShouldContain("\"role\"");
        json.ShouldContain("\"index\"");
    }

    /// <summary>
    /// The role by name, not by number. It ends up in a URL that a human reads while debugging a
    /// projector, and a number there would silently change meaning if this enum were ever reordered.
    /// </summary>
    [Fact]
    public void Writing_SpellsTheRoleOut()
    {
        var json = JsonSerializer.Serialize(
            new LiveWindowEntry("session-1", "window-1", "Projector", LiveWindowRole.Projector, 0), BlazorOptions);

        json.ShouldContain("\"role\":\"Projector\"");
    }

    /// <summary>What a window that answered the roll call actually sends.</summary>
    [Fact]
    public void Reading_WhatALiveWindowAnswersWith_UnderstandsAllOfIt()
    {
        const string answered =
            """{"sessionId":"session-1","windowId":"a1b2c3d4","title":"Live view (2)","role":"Live","index":2}""";

        var entry = JsonSerializer.Deserialize<LiveWindowEntry>(answered, BlazorOptions);

        entry.ShouldNotBeNull();
        entry.SessionId.ShouldBe("session-1");
        entry.WindowId.ShouldBe("a1b2c3d4");
        entry.Title.ShouldBe("Live view (2)");
        entry.Role.ShouldBe(LiveWindowRole.Live);
        entry.Index.ShouldBe(2);
    }

    [Fact]
    public void Reading_TheProjectorsAnswer_KeepsItAProjector()
    {
        const string answered =
            """{"sessionId":"session-1","windowId":"a1b2c3d4","title":"Projector","role":"Projector","index":0}""";

        JsonSerializer.Deserialize<LiveWindowEntry>(answered, BlazorOptions)!
            .Role.ShouldBe(LiveWindowRole.Projector);
    }

    /// <summary>
    /// Blazor's own interop options, reached the only way they are reachable: they are protected on
    /// JSRuntime, so a subclass has to hand them over. Asserting against a locally built
    /// JsonSerializerOptions instead would only pin this test's guess about them.
    /// </summary>
    private sealed class TestJSRuntime : JSRuntime
    {
        public JsonSerializerOptions Options => JsonSerializerOptions;

        protected override void BeginInvokeJS(long taskId, string identifier, string? argsJson) =>
            throw new NotSupportedException();

        protected override void BeginInvokeJS(
            long taskId, string identifier, string? argsJson, JSCallResultType resultType, long targetInstanceId) =>
            throw new NotSupportedException();

        protected override void EndInvokeDotNet(
            DotNetInvocationInfo invocationInfo, in DotNetInvocationResult invocationResult) =>
            throw new NotSupportedException();
    }
}
