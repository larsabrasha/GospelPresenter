using DocumentFormat.OpenXml;
using DocumentFormat.OpenXml.Packaging;
using D = DocumentFormat.OpenXml.Drawing;
using P = DocumentFormat.OpenXml.Presentation;

namespace GospelPresenter.IntegrationTests.Helpers;

// Builds a minimal valid .pptx in memory so integration tests don't need a binary fixture file.
// The layout/master/theme are constructed by SDK helpers; we just add slides with a single text box.
public static class MinimalPptxFactory
{
    public static byte[] Create(params string[] slideTexts)
    {
        if (slideTexts.Length == 0) slideTexts = ["Test slide"];

        using var stream = new MemoryStream();
        using (var doc = PresentationDocument.Create(stream, DocumentFormat.OpenXml.PresentationDocumentType.Presentation))
        {
            var presentationPart = doc.AddPresentationPart();
            presentationPart.Presentation = new P.Presentation();

            var slideMasterPart = CreateSlideMasterPart(presentationPart);
            var slideLayoutPart = CreateSlideLayoutPart(slideMasterPart);
            CreateThemePart(slideMasterPart);

            BuildSlideMaster(slideMasterPart, slideLayoutPart);
            BuildSlideLayout(slideLayoutPart);

            var slideIdList = new P.SlideIdList();
            uint slideId = 256;
            foreach (var text in slideTexts)
            {
                var slidePart = presentationPart.AddNewPart<SlidePart>();
                slidePart.AddPart(slideLayoutPart);
                BuildSlide(slidePart, text);
                var relId = presentationPart.GetIdOfPart(slidePart);
                slideIdList.AppendChild(new P.SlideId { Id = slideId++, RelationshipId = relId });
            }

            presentationPart.Presentation.SlideIdList = slideIdList;
            presentationPart.Presentation.SlideMasterIdList = new P.SlideMasterIdList(
                new P.SlideMasterId { Id = 2147483648U, RelationshipId = presentationPart.GetIdOfPart(slideMasterPart) });
            presentationPart.Presentation.SlideSize = new P.SlideSize { Cx = 9_144_000, Cy = 6_858_000 };
            presentationPart.Presentation.NotesSize = new P.NotesSize { Cx = 6_858_000, Cy = 9_144_000 };
            presentationPart.Presentation.Save();
        }

        return stream.ToArray();
    }

    private static SlideMasterPart CreateSlideMasterPart(PresentationPart presentationPart) =>
        presentationPart.AddNewPart<SlideMasterPart>();

    private static SlideLayoutPart CreateSlideLayoutPart(SlideMasterPart slideMasterPart) =>
        slideMasterPart.AddNewPart<SlideLayoutPart>();

    private static void CreateThemePart(SlideMasterPart slideMasterPart)
    {
        var themePart = slideMasterPart.AddNewPart<ThemePart>();
        themePart.Theme = new D.Theme(
            new D.ThemeElements(
                new D.ColorScheme(
                    new D.Dark1Color(new D.SystemColor { Val = D.SystemColorValues.WindowText, LastColor = "000000" }),
                    new D.Light1Color(new D.SystemColor { Val = D.SystemColorValues.Window, LastColor = "FFFFFF" }),
                    new D.Dark2Color(new D.RgbColorModelHex { Val = "44546A" }),
                    new D.Light2Color(new D.RgbColorModelHex { Val = "E7E6E6" }),
                    new D.Accent1Color(new D.RgbColorModelHex { Val = "5B9BD5" }),
                    new D.Accent2Color(new D.RgbColorModelHex { Val = "ED7D31" }),
                    new D.Accent3Color(new D.RgbColorModelHex { Val = "A5A5A5" }),
                    new D.Accent4Color(new D.RgbColorModelHex { Val = "FFC000" }),
                    new D.Accent5Color(new D.RgbColorModelHex { Val = "4472C4" }),
                    new D.Accent6Color(new D.RgbColorModelHex { Val = "70AD47" }),
                    new D.Hyperlink(new D.RgbColorModelHex { Val = "0563C1" }),
                    new D.FollowedHyperlinkColor(new D.RgbColorModelHex { Val = "954F72" }))
                { Name = "Office" },
                new D.FontScheme(
                    new D.MajorFont(
                        new D.LatinFont { Typeface = "Calibri Light" },
                        new D.EastAsianFont { Typeface = "" },
                        new D.ComplexScriptFont { Typeface = "" }),
                    new D.MinorFont(
                        new D.LatinFont { Typeface = "Calibri" },
                        new D.EastAsianFont { Typeface = "" },
                        new D.ComplexScriptFont { Typeface = "" }))
                { Name = "Office" },
                new D.FormatScheme(
                    new D.FillStyleList(
                        new D.SolidFill(new D.SchemeColor { Val = D.SchemeColorValues.PhColor }),
                        new D.SolidFill(new D.SchemeColor { Val = D.SchemeColorValues.PhColor }),
                        new D.SolidFill(new D.SchemeColor { Val = D.SchemeColorValues.PhColor })),
                    new D.LineStyleList(
                        new D.Outline(new D.SolidFill(new D.SchemeColor { Val = D.SchemeColorValues.PhColor })) { Width = 6350 },
                        new D.Outline(new D.SolidFill(new D.SchemeColor { Val = D.SchemeColorValues.PhColor })) { Width = 12700 },
                        new D.Outline(new D.SolidFill(new D.SchemeColor { Val = D.SchemeColorValues.PhColor })) { Width = 19050 }),
                    new D.EffectStyleList(
                        new D.EffectStyle(new D.EffectList()),
                        new D.EffectStyle(new D.EffectList()),
                        new D.EffectStyle(new D.EffectList())),
                    new D.BackgroundFillStyleList(
                        new D.SolidFill(new D.SchemeColor { Val = D.SchemeColorValues.PhColor }),
                        new D.SolidFill(new D.SchemeColor { Val = D.SchemeColorValues.PhColor }),
                        new D.SolidFill(new D.SchemeColor { Val = D.SchemeColorValues.PhColor })))
                { Name = "Office" })
            )
        { Name = "Office Theme" };
    }

    private static void BuildSlideMaster(SlideMasterPart slideMasterPart, SlideLayoutPart slideLayoutPart)
    {
        slideMasterPart.SlideMaster = new P.SlideMaster(
            new P.CommonSlideData(
                new P.Background(new P.BackgroundStyleReference(new D.SchemeColor { Val = D.SchemeColorValues.Background1 }) { Index = 1001 }),
                new P.ShapeTree(
                    new P.NonVisualGroupShapeProperties(
                        new P.NonVisualDrawingProperties { Id = 1, Name = "" },
                        new P.NonVisualGroupShapeDrawingProperties(),
                        new P.ApplicationNonVisualDrawingProperties()),
                    new P.GroupShapeProperties(new D.TransformGroup()))),
            new P.ColorMap
            {
                Background1 = D.ColorSchemeIndexValues.Light1,
                Text1 = D.ColorSchemeIndexValues.Dark1,
                Background2 = D.ColorSchemeIndexValues.Light2,
                Text2 = D.ColorSchemeIndexValues.Dark2,
                Accent1 = D.ColorSchemeIndexValues.Accent1,
                Accent2 = D.ColorSchemeIndexValues.Accent2,
                Accent3 = D.ColorSchemeIndexValues.Accent3,
                Accent4 = D.ColorSchemeIndexValues.Accent4,
                Accent5 = D.ColorSchemeIndexValues.Accent5,
                Accent6 = D.ColorSchemeIndexValues.Accent6,
                Hyperlink = D.ColorSchemeIndexValues.Hyperlink,
                FollowedHyperlink = D.ColorSchemeIndexValues.FollowedHyperlink
            },
            new P.SlideLayoutIdList(
                new P.SlideLayoutId { Id = 2147483649U, RelationshipId = slideMasterPart.GetIdOfPart(slideLayoutPart) }));
    }

    private static void BuildSlideLayout(SlideLayoutPart slideLayoutPart)
    {
        slideLayoutPart.SlideLayout = new P.SlideLayout(
            new P.CommonSlideData(
                new P.ShapeTree(
                    new P.NonVisualGroupShapeProperties(
                        new P.NonVisualDrawingProperties { Id = 1, Name = "" },
                        new P.NonVisualGroupShapeDrawingProperties(),
                        new P.ApplicationNonVisualDrawingProperties()),
                    new P.GroupShapeProperties(new D.TransformGroup()))));
    }

    private static void BuildSlide(SlidePart slidePart, string text)
    {
        slidePart.Slide = new P.Slide(
            new P.CommonSlideData(
                new P.ShapeTree(
                    new P.NonVisualGroupShapeProperties(
                        new P.NonVisualDrawingProperties { Id = 1, Name = "" },
                        new P.NonVisualGroupShapeDrawingProperties(),
                        new P.ApplicationNonVisualDrawingProperties()),
                    new P.GroupShapeProperties(new D.TransformGroup()),
                    new P.Shape(
                        new P.NonVisualShapeProperties(
                            new P.NonVisualDrawingProperties { Id = 2, Name = "Text" },
                            new P.NonVisualShapeDrawingProperties(new D.ShapeLocks { NoGrouping = true }),
                            new P.ApplicationNonVisualDrawingProperties()),
                        new P.ShapeProperties(
                            new D.Transform2D(
                                new D.Offset { X = 914400L, Y = 914400L },
                                new D.Extents { Cx = 7315200L, Cy = 1828800L }),
                            new D.PresetGeometry(new D.AdjustValueList()) { Preset = D.ShapeTypeValues.Rectangle }),
                        new P.TextBody(
                            new D.BodyProperties(),
                            new D.ListStyle(),
                            new D.Paragraph(new D.Run(new D.RunProperties { Language = "en-US" }, new D.Text(text))))))));
    }
}
