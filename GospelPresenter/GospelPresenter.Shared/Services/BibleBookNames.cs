using System.Collections.Frozen;

namespace GospelPresenter.Shared.Services;

/// <summary>
/// Maps Swedish book names, abbreviations, and ordinal variants to USX book codes.
/// Lookup is case-insensitive and supports prefix matching.
/// </summary>
public static class BibleBookNames
{
    private static readonly FrozenDictionary<string, string> Aliases = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
    {
        // Gamla testamentet

        // 1 Moseboken
        ["1 mos"] = "GEN", ["1 mosebok"] = "GEN", ["1 moseboken"] = "GEN",
        ["1:a mos"] = "GEN", ["1:a mosebok"] = "GEN", ["1:a moseboken"] = "GEN",
        ["första mos"] = "GEN", ["första mosebok"] = "GEN", ["första moseboken"] = "GEN",
        ["genesis"] = "GEN", ["gen"] = "GEN",

        // 2 Moseboken
        ["2 mos"] = "EXO", ["2 mosebok"] = "EXO", ["2 moseboken"] = "EXO",
        ["2:a mos"] = "EXO", ["2:a mosebok"] = "EXO", ["2:a moseboken"] = "EXO",
        ["andra mos"] = "EXO", ["andra mosebok"] = "EXO", ["andra moseboken"] = "EXO",
        ["exodus"] = "EXO", ["exo"] = "EXO",

        // 3 Moseboken
        ["3 mos"] = "LEV", ["3 mosebok"] = "LEV", ["3 moseboken"] = "LEV",
        ["3:e mos"] = "LEV", ["3:e mosebok"] = "LEV", ["3:e moseboken"] = "LEV",
        ["tredje mos"] = "LEV", ["tredje mosebok"] = "LEV", ["tredje moseboken"] = "LEV",
        ["leviticus"] = "LEV", ["lev"] = "LEV",

        // 4 Moseboken
        ["4 mos"] = "NUM", ["4 mosebok"] = "NUM", ["4 moseboken"] = "NUM",
        ["4:e mos"] = "NUM", ["4:e mosebok"] = "NUM", ["4:e moseboken"] = "NUM",
        ["fjärde mos"] = "NUM", ["fjärde mosebok"] = "NUM", ["fjärde moseboken"] = "NUM",
        ["numeri"] = "NUM", ["num"] = "NUM",

        // 5 Moseboken
        ["5 mos"] = "DEU", ["5 mosebok"] = "DEU", ["5 moseboken"] = "DEU",
        ["5:e mos"] = "DEU", ["5:e mosebok"] = "DEU", ["5:e moseboken"] = "DEU",
        ["femte mos"] = "DEU", ["femte mosebok"] = "DEU", ["femte moseboken"] = "DEU",
        ["deuteronomium"] = "DEU", ["deu"] = "DEU",

        ["josua"] = "JOS", ["jos"] = "JOS",
        ["domarboken"] = "JDG", ["dom"] = "JDG",
        ["rut"] = "RUT",
        ["1 sam"] = "1SA", ["1 samuel"] = "1SA", ["1 samuelsboken"] = "1SA",
        ["1:a sam"] = "1SA", ["1:a samuel"] = "1SA", ["1:a samuelsboken"] = "1SA",
        ["första sam"] = "1SA", ["första samuel"] = "1SA", ["första samuelsboken"] = "1SA",
        ["2 sam"] = "2SA", ["2 samuel"] = "2SA", ["2 samuelsboken"] = "2SA",
        ["2:a sam"] = "2SA", ["2:a samuel"] = "2SA", ["2:a samuelsboken"] = "2SA",
        ["andra sam"] = "2SA", ["andra samuel"] = "2SA", ["andra samuelsboken"] = "2SA",
        ["1 kung"] = "1KI", ["1 kungaboken"] = "1KI",
        ["1:a kung"] = "1KI", ["1:a kungaboken"] = "1KI",
        ["första kung"] = "1KI", ["första kungaboken"] = "1KI",
        ["2 kung"] = "2KI", ["2 kungaboken"] = "2KI",
        ["2:a kung"] = "2KI", ["2:a kungaboken"] = "2KI",
        ["andra kung"] = "2KI", ["andra kungaboken"] = "2KI",
        ["1 krön"] = "1CH", ["1 krönikeboken"] = "1CH",
        ["1:a krön"] = "1CH", ["1:a krönikeboken"] = "1CH",
        ["första krön"] = "1CH", ["första krönikeboken"] = "1CH",
        ["2 krön"] = "2CH", ["2 krönikeboken"] = "2CH",
        ["2:a krön"] = "2CH", ["2:a krönikeboken"] = "2CH",
        ["andra krön"] = "2CH", ["andra krönikeboken"] = "2CH",
        ["esra"] = "EZR", ["esr"] = "EZR",
        ["nehemja"] = "NEH", ["neh"] = "NEH",
        ["ester"] = "EST", ["est"] = "EST",
        ["job"] = "JOB",
        ["psaltaren"] = "PSA", ["ps"] = "PSA", ["psa"] = "PSA",
        ["ordspråksboken"] = "PRO", ["ords"] = "PRO", ["ordspr"] = "PRO",
        ["predikaren"] = "ECC", ["pred"] = "ECC",
        ["höga visan"] = "SNG", ["höga"] = "SNG", ["hv"] = "SNG",
        ["jesaja"] = "ISA", ["jes"] = "ISA", ["isa"] = "ISA",
        ["jeremia"] = "JER", ["jer"] = "JER",
        ["klagovisorna"] = "LAM", ["klag"] = "LAM",
        ["hesekiel"] = "EZK", ["hes"] = "EZK",
        ["daniel"] = "DAN", ["dan"] = "DAN",
        ["hosea"] = "HOS", ["hos"] = "HOS",
        ["joel"] = "JOL",
        ["amos"] = "AMO",
        ["obadja"] = "OBA", ["ob"] = "OBA",
        ["jona"] = "JON",
        ["mika"] = "MIC", ["mic"] = "MIC",
        ["nahum"] = "NAM", ["nah"] = "NAM",
        ["habackuk"] = "HAB", ["hab"] = "HAB",
        ["sefanja"] = "ZEP", ["sef"] = "ZEP",
        ["haggaj"] = "HAG", ["hag"] = "HAG",
        ["sakarja"] = "ZEC", ["sak"] = "ZEC",
        ["malaki"] = "MAL", ["mal"] = "MAL",

        // Nya testamentet
        ["matteus"] = "MAT", ["matt"] = "MAT", ["mat"] = "MAT",
        ["matteusevangeliet"] = "MAT",
        ["markus"] = "MRK", ["mark"] = "MRK", ["mrk"] = "MRK",
        ["markusevangeliet"] = "MRK",
        ["lukas"] = "LUK", ["luk"] = "LUK",
        ["lukasevangeliet"] = "LUK",
        ["johannes"] = "JHN", ["joh"] = "JHN",
        ["johannesevangeliet"] = "JHN",
        ["apostlagärningarna"] = "ACT", ["apg"] = "ACT",
        ["romarbrevet"] = "ROM", ["rom"] = "ROM",
        ["1 kor"] = "1CO", ["1 korintierbrevet"] = "1CO",
        ["1:a kor"] = "1CO", ["1:a korintierbrevet"] = "1CO",
        ["första kor"] = "1CO", ["första korintierbrevet"] = "1CO",
        ["2 kor"] = "2CO", ["2 korintierbrevet"] = "2CO",
        ["2:a kor"] = "2CO", ["2:a korintierbrevet"] = "2CO",
        ["andra kor"] = "2CO", ["andra korintierbrevet"] = "2CO",
        ["galaterbrevet"] = "GAL", ["gal"] = "GAL",
        ["efesierbrevet"] = "EPH", ["ef"] = "EPH",
        ["filipperbrevet"] = "PHP", ["fil"] = "PHP",
        ["kolosserbrevet"] = "COL", ["kol"] = "COL",
        ["1 thess"] = "1TH", ["1 thessalonikerbrevet"] = "1TH",
        ["1:a thess"] = "1TH", ["1:a thessalonikerbrevet"] = "1TH",
        ["första thess"] = "1TH", ["första thessalonikerbrevet"] = "1TH",
        ["1 tess"] = "1TH", ["1:a tess"] = "1TH", ["första tess"] = "1TH",
        ["2 thess"] = "2TH", ["2 thessalonikerbrevet"] = "2TH",
        ["2:a thess"] = "2TH", ["2:a thessalonikerbrevet"] = "2TH",
        ["andra thess"] = "2TH", ["andra thessalonikerbrevet"] = "2TH",
        ["2 tess"] = "2TH", ["2:a tess"] = "2TH", ["andra tess"] = "2TH",
        ["1 tim"] = "1TI", ["1 timoteusbrevet"] = "1TI",
        ["1:a tim"] = "1TI", ["1:a timoteusbrevet"] = "1TI",
        ["första tim"] = "1TI", ["första timoteusbrevet"] = "1TI",
        ["2 tim"] = "2TI", ["2 timoteusbrevet"] = "2TI",
        ["2:a tim"] = "2TI", ["2:a timoteusbrevet"] = "2TI",
        ["andra tim"] = "2TI", ["andra timoteusbrevet"] = "2TI",
        ["titus"] = "TIT", ["tit"] = "TIT",
        ["filemon"] = "PHM", ["filem"] = "PHM",
        ["hebreerbrevet"] = "HEB", ["hebr"] = "HEB", ["heb"] = "HEB",
        ["jakob"] = "JAS", ["jak"] = "JAS",
        ["jakobsbrevet"] = "JAS",
        ["1 petr"] = "1PE", ["1 petrusbrevet"] = "1PE",
        ["1:a petr"] = "1PE", ["1:a petrusbrevet"] = "1PE",
        ["första petr"] = "1PE", ["första petrusbrevet"] = "1PE",
        ["1 pet"] = "1PE", ["1:a pet"] = "1PE", ["första pet"] = "1PE",
        ["2 petr"] = "2PE", ["2 petrusbrevet"] = "2PE",
        ["2:a petr"] = "2PE", ["2:a petrusbrevet"] = "2PE",
        ["andra petr"] = "2PE", ["andra petrusbrevet"] = "2PE",
        ["2 pet"] = "2PE", ["2:a pet"] = "2PE", ["andra pet"] = "2PE",
        ["1 joh"] = "1JN", ["1 johannesbrevet"] = "1JN",
        ["1:a joh"] = "1JN", ["1:a johannesbrevet"] = "1JN",
        ["första joh"] = "1JN", ["första johannesbrevet"] = "1JN",
        ["2 joh"] = "2JN", ["2 johannesbrevet"] = "2JN",
        ["2:a joh"] = "2JN", ["2:a johannesbrevet"] = "2JN",
        ["andra joh"] = "2JN", ["andra johannesbrevet"] = "2JN",
        ["3 joh"] = "3JN", ["3 johannesbrevet"] = "3JN",
        ["3:e joh"] = "3JN", ["3:e johannesbrevet"] = "3JN",
        ["tredje joh"] = "3JN", ["tredje johannesbrevet"] = "3JN",
        ["judas"] = "JUD", ["jud"] = "JUD",
        ["judasbrevet"] = "JUD",
        ["uppenbarelseboken"] = "REV", ["upp"] = "REV", ["upb"] = "REV",
    }.ToFrozenDictionary();

    /// <summary>
    /// Resolves a book name, abbreviation, or code to a USX book code.
    /// Tries exact match first, then prefix match on aliases, then prefix match on book codes.
    /// Returns null if no match is found.
    /// </summary>
    public static string? Resolve(string input)
    {
        if (string.IsNullOrWhiteSpace(input))
            return null;

        var trimmed = input.Trim();

        // Exact match on alias
        if (Aliases.TryGetValue(trimmed, out var code))
            return code;

        // Prefix match on aliases — find the longest matching alias
        string? bestMatch = null;
        var bestLength = 0;
        foreach (var (alias, bookCode) in Aliases)
        {
            if (alias.StartsWith(trimmed, StringComparison.OrdinalIgnoreCase) && alias.Length > bestLength)
            {
                bestMatch = bookCode;
                bestLength = alias.Length;
            }
        }

        return bestMatch;
    }
}
