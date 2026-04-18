using PDFtoImage;
using SkiaSharp;

namespace GospelPresenter.Shared.Services;

public record RenderedPage(int Index, byte[] Bytes);

public interface IPdfRenderService
{
    IReadOnlyList<RenderedPage> RenderPdf(Stream pdfStream, int maxPages);
}

public class PdfRenderService : IPdfRenderService
{
    private const int Dpi = 150;
    private const int WebpQuality = 85;

    public IReadOnlyList<RenderedPage> RenderPdf(Stream pdfStream, int maxPages)
    {
        using var ms = new MemoryStream();
        pdfStream.CopyTo(ms);
        var pdfBytes = ms.ToArray();

        int pageCount;
        try
        {
            pageCount = Conversion.GetPageCount(new MemoryStream(pdfBytes));
        }
        catch (Exception ex)
        {
            throw new InvalidOperationException("Could not read the PDF. The file may be password-protected or corrupted.", ex);
        }

        if (pageCount > maxPages)
            throw new ArgumentOutOfRangeException(nameof(pdfStream),
                $"PDF has {pageCount} pages, maximum allowed is {maxPages}.");

        var pages = new List<RenderedPage>(pageCount);

        for (var i = 0; i < pageCount; i++)
        {
            using var bitmap = Conversion.ToImage(new MemoryStream(pdfBytes), (Index)i,
                options: new RenderOptions(Dpi: Dpi));
            using var encoded = bitmap.Encode(SKEncodedImageFormat.Webp, WebpQuality);
            pages.Add(new RenderedPage(i, encoded.ToArray()));
        }

        return pages;
    }
}
