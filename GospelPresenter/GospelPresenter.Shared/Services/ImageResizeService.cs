using SkiaSharp;

namespace GospelPresenter.Shared.Services;

public interface IImageResizeService
{
    (byte[] fullData, byte[] thumbData, string contentType) Resize(Stream imageStream, string sourceContentType);
}

public class ImageResizeService : IImageResizeService
{
    public const int FullMaxWidth = 1920;
    public const int FullMaxHeight = 1080;
    public const int FullQuality = 90;
    public const int ThumbMaxWidth = 400;
    public const int ThumbMaxHeight = 225;
    public const int ThumbQuality = 80;

    public (byte[] fullData, byte[] thumbData, string contentType) Resize(Stream imageStream, string sourceContentType)
    {
        using var original = SKBitmap.Decode(imageStream);
        if (original is null)
            throw new ArgumentException("Failed to decode image");

        var hasAlpha = sourceContentType is "image/png" or "image/webp" or "image/gif";
        var format = hasAlpha ? SKEncodedImageFormat.Webp : SKEncodedImageFormat.Jpeg;
        var contentType = hasAlpha ? "image/webp" : "image/jpeg";

        var fullData = ResizeAndEncode(original, FullMaxWidth, FullMaxHeight, FullQuality, format);
        var thumbData = ResizeAndEncode(original, ThumbMaxWidth, ThumbMaxHeight, ThumbQuality, format);

        return (fullData, thumbData, contentType);
    }

    private static byte[] ResizeAndEncode(SKBitmap source, int maxWidth, int maxHeight, int quality, SKEncodedImageFormat format)
    {
        var w = source.Width;
        var h = source.Height;

        if (w > maxWidth || h > maxHeight)
        {
            var ratio = Math.Min((double)maxWidth / w, (double)maxHeight / h);
            w = (int)Math.Round(w * ratio);
            h = (int)Math.Round(h * ratio);
        }

        var info = new SKImageInfo(w, h, SKColorType.Rgba8888, SKAlphaType.Premul);
        var sampling = new SKSamplingOptions(SKCubicResampler.Mitchell);
        using var resized = source.Resize(info, sampling);
        using var image = SKImage.FromBitmap(resized);
        using var data = image.Encode(format, quality);
        return data.ToArray();
    }
}
