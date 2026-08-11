using QRCoder;

namespace GospelPresenter.Shared.Services;

public static class QrCodeImage
{
    /// <summary>
    /// Renders a QR code as a PNG data URL, big enough to print on a sign.
    ///
    /// Offered as a download so an operator can put the code up in the entrance and can also add
    /// it to a presentation as an ordinary image or overlay — which is how the code gets projected
    /// before a service without any of this touching the live rendering path.
    /// </summary>
    public static string ToPngDataUrl(string value, int pixelsPerModule = 24)
    {
        using var generator = new QRCodeGenerator();
        using var data = generator.CreateQrCode(value, QRCodeGenerator.ECCLevel.M);
        var png = new PngByteQRCode(data);
        return "data:image/png;base64," + Convert.ToBase64String(png.GetGraphic(pixelsPerModule));
    }
}
