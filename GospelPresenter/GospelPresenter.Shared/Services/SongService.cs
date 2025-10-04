using GospelPresenter.Shared.State;

namespace GospelPresenter.Shared.Services;

public interface ISongService
{
    Song? GetSongById(string id);
}

public class SongService : ISongService
{
    private readonly Dictionary<string, Song> allSongs = new()
    {
        {
            "9d2ae22f-de51-42a9-9615-f9647e0cd47a", new Song(
                "9d2ae22f-de51-42a9-9615-f9647e0cd47a",
                "Herren är vår Gud",
                "Zacharias Topelius, Stralsund",
                "Ps o S 2",
                null,
                "",
                [
                    "Herren vår Gud är en konung \ni makt och i ära.\nKom, alla folk, att vårt eviga \nlov honom bära!\nHimmel och jord \nbärs av hans kraftiga ord.\nallt han sitt hägn vill beskära.",
                    "Pris vare Herren, som allting \nså härligt bereder,\nsom oss har skapat och blickar \ni nåd till oss neder,\nsom i vår nöd\nskänker oss välfärd och bröd\noch sitt beskydd kring oss breder.",
                    "Herren, vår Gud, vare lov \nsom en Far för oss blivit,\nsom för vår synd har sin Son \nuppå korset utgivit,\nsom på vår jord\nleder med Ande och ord\ndem som åt Kristus sig givit.",
                    "Herren, vår salighets Gud, \nmå vi prisa och tjäna.\nKraften är hans och all vishet \noch ära allena.\nPris ske hans namn,\natt han oss vill i sin famn\nalla med Kristus förena.",
                    "Herren, vår salighets Gud, \nmå vi prisa och tjäna.\nKraften är hans och all vishet \noch ära allena.\nPris ske hans namn,\natt han oss vill i sin famn\nalla med Kristus förena."
                ])
        },
        {
            "9d2ae22f-de51-42a9-9615-f9647e0cd47b", new Song(
                "9d2ae22f-de51-42a9-9615-f9647e0cd47b",
                "I tid och rum",
                "",
                "",
                null,
                "",
                [
                    "Guds dyra lamm av evighet\nÄr värd vårt lov vår tacksamhet\nEtt kors blev rest i tid och rum \nVår tro Guds evangelium",
                    "Det glada budet till oss når \nDet genom alla tider går \nAtt Gud har gjort det vi ej kan \nOch burit världens skuld och skam",
                    "Ur gravens mörka kalla famn \nPå tredje dagen uppstod han\nSom är vårt hopp i evighet \nVår frälsare vår helighet\nVår frälsare vår helighet",
                    "På Faderns bud i Andens kraft\nDu kommer åter som du sagt\nNär himlens morgon gryr en gång \nVi sjunger Lammets nya sång \nNär himlens morgon gryr en gång \nVi sjunger Lammets nya sång"
                ])
        },
        {
            "9d2ae22f-de51-42a9-9615-f9647e0cd47c", new Song(
                "9d2ae22f-de51-42a9-9615-f9647e0cd47c",
                "Majestät",
                "Jan Honningdal",
                "Honningdal, Tove & Jan",
                null,
                "1353016",
                [
                    "Majestät, Konung i evighet.\nJord och hav och himmel,\n är skapat utav Dig.\nMajestät, Konung i evighet\nDu min frälsningsklippa \nen säker tillflyktsplats.",
                    "Vi vill upphöja Dig kung Jesus\nvarje knä ska böjas inför Dig.\nVi vill upphöja Dig kung Jesus\nIngen är som Du, \nnej ingen är som Du."
                ])
        },
        {
            "9d2ae22f-de51-42a9-9615-f9647e0cd47d", new Song(
                "9d2ae22f-de51-42a9-9615-f9647e0cd47d",
                "Högst av allt",
                "Bengt Johansson, Erik Stenlund, Lenny LeBlanc, Paul Baloche",
                "LeSongs Publishing",
                1999,
                "6440666",
                [
                    "Högt över världen och mänsklig makt \nÖver allt skapat och hela jordens prakt \nHögt över visdom och allt vad männskor lär \nInnan något fanns var Du här \nHögt över riken och rikedom \növer de under som världen talar om \nHögt över välstånd och skatter jorden ger \ninför dig ska allting falla ner",
                    "Men du dog ensam och fördömd \nen korsfäst Gud och i gravens mörker gömd \nsom en ros bryts och trampas ner \nDu tog min plats älskade mig högst av allt."
                ])
        },
        {
            "9d2ae22f-de51-42a9-9615-f9647e0cd47e", new Song(
                "9d2ae22f-de51-42a9-9615-f9647e0cd47e",
                "Mer av dig, Jesus",
                "Bo Järpehag, Elsa Järpehag",
                "",
                null,
                "7096406",
                [
                    "Jesus jag är törstig \nBer dig kom och fyll mig\nMät mig Herre i min nöd \nBara du är livet bröd\nAllt jag ber är mer av Dig \nLängtar efter mer av Dig\nHerre allt jag ber om är mer av Dig\nLängtar efter mer av Dig"
                ])
        },
        {
            "9d2ae22f-de51-42a9-9615-f9647e0cd47f", new Song(
                "9d2ae22f-de51-42a9-9615-f9647e0cd47f",
                "Det är saligt",
                "",
                "",
                null,
                "",
                [
                    "Det är saligt på Jesus få tro\noch att vara Guds barn blott av nåd.\nDet blir härligt hos Jesus få bo\noch där prisa hans trofasta råd",
                    "Gud ske lov, Gud ske tack\natt hans salighet även är min.\nGud ske lov, Gud ske tack,\natt hans salighet även är min.",
                    "Det är saligt att samlas i tro\nomkring ordet till bön och till sång.\nO hur härligt det blir vid Guds tron\natt få stå bland de frälsta en gång.",
                    "Det är saligt att tro fast vi än\nej fått skåda vår Frälsare kär.\nMen en dag skall han komma igen,\nvi får se honom såsom han är."
                ])
        },
        {
            "9d2ae22f-de51-42a9-9615-f9647e0cd47g", new Song(
                "9d2ae22f-de51-42a9-9615-f9647e0cd47g",
                "Vi vill se Gud",
                "",
                "",
                null,
                "",
                [
                    "Glödhet är Guds närhet,\nHans härlighet brinner över oss\nHan vill låta elden falla ner\növer dem som ropar och ber",
                    "Vi vill se Gud, vi vill se Gud i detta land\nHerre kom nu! Sätt vart hjärta i brand\nIfrån norr till söder, en förväntan som glöder\nifrån väster till öster, hörs ett rop från tusen röster\noch man ber\nVi vill se Gud \nVi vill se Gud"
                ])
        }
    };

    public Song? GetSongById(string id)
    {
        return allSongs.GetValueOrDefault(id);
    }
}
