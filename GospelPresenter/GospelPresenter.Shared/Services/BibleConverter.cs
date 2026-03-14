using System.Text.Json;
using System.Text.Encodings.Web;
using System.Text.Json.Serialization;
using System.Text.Unicode;

namespace GospelPresenter.Shared.Services;

public static class BibleConverter
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerOptions.Web)
    {
        Encoder = JavaScriptEncoder.Create(UnicodeRanges.All),
        WriteIndented = true
    };

    public static void ConvertUsxToJson(string usxFolderPath, string outputPath)
    {
        var allVerses = Directory.GetFiles(usxFolderPath, "*.usx")
            .Select(UsxParser.ParseBook)
            .SelectMany(book => book.Chapters.SelectMany(chapter =>
                chapter.Verses.Select(verse => new Verse(
                    book.Code,
                    chapter.Number,
                    verse.Number,
                    verse.Text))))
            .ToList();

        var json = JsonSerializer.Serialize(allVerses, JsonOptions);
        File.WriteAllText(outputPath, json);
    }
}

public record Verse(
    [property: JsonPropertyName("b")] string BookId,
    [property: JsonPropertyName("c")] int Chapter,
    [property: JsonPropertyName("v")] int VerseNumber,
    [property: JsonPropertyName("t")] string Text
);
