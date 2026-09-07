using GospelPresenter.Shared.Services;
using Shouldly;

namespace GospelPresenter.UnitTests.Services;

/// <summary>
/// The type a blob is stored under is the type it is served under, from the app's own origin. So
/// it is read off the bytes, and a body that is not one of the accepted formats is not media at all.
/// </summary>
public class MediaSnifferTests
{
    [Theory]
    [InlineData(new byte[] { 0xFF, 0xD8, 0xFF, 0xE0, 0, 0 }, "image/jpeg")]
    [InlineData(new byte[] { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0 }, "image/png")]
    [InlineData(new byte[] { (byte)'G', (byte)'I', (byte)'F', (byte)'8', (byte)'9', (byte)'a', 0 }, "image/gif")]
    [InlineData(new byte[] { (byte)'R', (byte)'I', (byte)'F', (byte)'F', 1, 2, 3, 4, (byte)'W', (byte)'E', (byte)'B', (byte)'P', 0 }, "image/webp")]
    public void DetectImageContentType_RecognisesEachAcceptedFormat(byte[] bytes, string expected)
    {
        MediaSniffer.DetectImageContentType(bytes).ShouldBe(expected);
    }

    [Theory]
    [InlineData(new byte[] { (byte)'I', (byte)'D', (byte)'3', 4, 0 }, "audio/mpeg")]
    [InlineData(new byte[] { 0xFF, 0xFB, 0x90, 0x00 }, "audio/mpeg")]
    [InlineData(new byte[] { (byte)'R', (byte)'I', (byte)'F', (byte)'F', 1, 2, 3, 4, (byte)'W', (byte)'A', (byte)'V', (byte)'E', 0 }, "audio/wav")]
    [InlineData(new byte[] { (byte)'O', (byte)'g', (byte)'g', (byte)'S', 0 }, "audio/ogg")]
    [InlineData(new byte[] { 0, 0, 0, 0x18, (byte)'f', (byte)'t', (byte)'y', (byte)'p', (byte)'M', (byte)'4', (byte)'A', (byte)' ' }, "audio/mp4")]
    [InlineData(new byte[] { 0x1A, 0x45, 0xDF, 0xA3, 0 }, "audio/webm")]
    public void DetectAudioContentType_RecognisesEachAcceptedFormat(byte[] bytes, string expected)
    {
        MediaSniffer.DetectAudioContentType(bytes).ShouldBe(expected);
    }

    [Theory]
    [InlineData("<html><script>alert(1)</script></html>")]
    [InlineData("<svg xmlns=\"http://www.w3.org/2000/svg\" onload=\"alert(1)\"/>")]
    [InlineData("%PDF-1.4")]
    [InlineData("")]
    [InlineData("R")]
    public void Detect_AnythingElse_IsNotMedia(string text)
    {
        var bytes = System.Text.Encoding.UTF8.GetBytes(text);

        MediaSniffer.DetectImageContentType(bytes).ShouldBeNull();
        MediaSniffer.DetectAudioContentType(bytes).ShouldBeNull();
    }

    [Fact]
    public void DetectImageContentType_ARiffThatIsNotWebp_IsNotAnImage()
    {
        byte[] wave = [(byte)'R', (byte)'I', (byte)'F', (byte)'F', 1, 2, 3, 4, (byte)'W', (byte)'A', (byte)'V', (byte)'E'];

        MediaSniffer.DetectImageContentType(wave).ShouldBeNull();
    }
}
