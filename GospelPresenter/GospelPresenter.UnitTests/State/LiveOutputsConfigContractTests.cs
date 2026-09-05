using System.Text.Json;
using GospelPresenter.Shared.State;
using Microsoft.JSInterop;
using Microsoft.JSInterop.Infrastructure;
using Shouldly;

namespace GospelPresenter.UnitTests.State;

/// <summary>
/// The saved output configuration crosses into JavaScript, and the names it crosses under are a
/// contract with <c>utils.js</c>: <c>saveOutputConfig</c> writes the object to local storage
/// verbatim and <c>loadOutputConfig</c> hands it straight back.
///
/// It used to be written from an anonymous object with hand-written lowercase names and read back
/// into a record, so the two directions could drift apart without anything noticing — and browsers
/// out there already hold the old spelling. Both directions now go through
/// <see cref="LiveOutputsConfig"/>, and these tests pin the names against the serializer Blazor
/// actually uses rather than the one this test would like it to use.
/// </summary>
public class LiveOutputsConfigContractTests
{
    private static readonly JsonSerializerOptions BlazorOptions = new TestJSRuntime().Options;

    [Fact]
    public void Writing_UsesTheNamesTheScriptStoresUnder()
    {
        var json = JsonSerializer.Serialize(
            new LiveOutputsConfig(["screen-1"], 2, true), BlazorOptions);

        json.ShouldContain("\"enabledDisplayIds\"");
        json.ShouldContain("\"windowCount\"");
        json.ShouldContain("\"presentationDisplay\"");
    }

    /// <summary>
    /// A browser that last ran the old build has this exact object in local storage. Reading it has
    /// to keep working, because losing it silently drops the operator's outputs on the next start.
    /// </summary>
    [Fact]
    public void Reading_WhatTheOldBuildLeftInLocalStorage_StillUnderstandsIt()
    {
        const string stored =
            """{"enabledDisplayIds":["screen-1","qr-2"],"windowCount":1,"presentationDisplay":true}""";

        var config = JsonSerializer.Deserialize<LiveOutputsConfig>(stored, BlazorOptions);

        config.ShouldNotBeNull();
        config.EnabledDisplayIds.ShouldBe(["screen-1", "qr-2"]);
        config.WindowCount.ShouldBe(1);
        config.PresentationDisplay.ShouldBe(true);
    }

    /// <summary>
    /// A build older still wrote no outputs field at all. Absent has to read as absent rather than
    /// as "none", which is the same distinction MirroredSessionState draws for the same reason.
    /// </summary>
    [Fact]
    public void Reading_AConfigFromBeforeTheseFieldsExisted_LeavesThemUnanswered()
    {
        var config = JsonSerializer.Deserialize<LiveOutputsConfig>("{}", BlazorOptions);

        config.ShouldNotBeNull();
        config.EnabledDisplayIds.ShouldBeNull();
        config.WindowCount.ShouldBeNull();
        config.PresentationDisplay.ShouldBeNull();
    }

    /// <summary>
    /// Compared field by field, not with the record's own equality: it holds an array, so two
    /// records with the same outputs are unequal unless they share the instance. Nothing here
    /// depends on that — this config is read for its fields and never compared — but it is the same
    /// trap MirroredSessionState had to design around, so it is worth saying out loud.
    /// </summary>
    [Fact]
    public void WritingThenReading_ComesBackTheSame()
    {
        var original = new LiveOutputsConfig(["screen-1"], 3, false);

        var read = JsonSerializer.Deserialize<LiveOutputsConfig>(
            JsonSerializer.Serialize(original, BlazorOptions), BlazorOptions);

        read.ShouldNotBeNull();
        read.EnabledDisplayIds.ShouldBe(original.EnabledDisplayIds);
        read.WindowCount.ShouldBe(original.WindowCount);
        read.PresentationDisplay.ShouldBe(original.PresentationDisplay);
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
