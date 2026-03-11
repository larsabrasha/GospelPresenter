using SkiaSharp;

namespace GospelPresenter.Shared.Services;

public interface IProfileImageService
{
    (string full, string small) Resize(byte[] imageData, string contentType);
}

public class ProfileImageService : IProfileImageService
{
    private const int FullSize = 256;
    private const int SmallSize = 64;

    public (string full, string small) Resize(byte[] imageData, string contentType)
    {
        using var original = SKBitmap.Decode(imageData);
        using var cropped = CropToSquare(original);
        var fullDataUri = ResizeToDataUri(cropped, FullSize);
        var smallDataUri = ResizeToDataUri(cropped, SmallSize);
        return (fullDataUri, smallDataUri);
    }

    private static SKBitmap CropToSquare(SKBitmap original)
    {
        var cropSide = Math.Min(original.Width, original.Height);
        var cropX = (original.Width - cropSide) / 2;
        var cropY = (original.Height - cropSide) / 2;

        var dest = new SKBitmap(cropSide, cropSide, original.ColorType, original.AlphaType);
        using var canvas = new SKCanvas(dest);
        var sourceRect = new SKRect(cropX, cropY, cropX + cropSide, cropY + cropSide);
        var destRect = new SKRect(0, 0, cropSide, cropSide);
        canvas.DrawBitmap(original, sourceRect, destRect);
        return dest;
    }

    private static string ResizeToDataUri(SKBitmap source, int size)
    {
        var info = new SKImageInfo(size, size, SKColorType.Rgba8888, SKAlphaType.Premul);
        var sampling = new SKSamplingOptions(SKCubicResampler.Mitchell);
        using var resized = source.Resize(info, sampling);

        using var image = SKImage.FromBitmap(resized);
        using var data = image.Encode(SKEncodedImageFormat.Png, 100);
        return $"data:image/png;base64,{Convert.ToBase64String(data.ToArray())}";
    }
}
