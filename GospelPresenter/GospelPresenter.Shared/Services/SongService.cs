using GospelPresenter.Shared.State;

namespace GospelPresenter.Shared.Services;

public interface ISongService
{
    Song? GetSongById(string id);
}

public class SongService : ISongService
{
    private readonly IDictionary<string, Song> allSongs = new Dictionary<string, Song>
    {
        {
            "9d2ae22f-de51-42a9-9615-f9647e0cd47a", new Song(
                "9d2ae22f-de51-42a9-9615-f9647e0cd47a",
                "O Store Gud",
                [
                    "O store Gud, när jag den värld beskådar,\nSom du har skapat med ditt allmaktsord,\nHur där din visdom leder livets trådar,\nOch alla väsen mättas vid ditt bord.",
                    "Då brister själen ut i lovsångsljud:\nO store Gud! O store Gud!\nDå brister själen ut i lovsångsljud:\nO store Gud! O store Gud!",
                    "När jag hör åskans röst och stormar brusa\noch blixtens klingor springa fram ur skyn\nnär regnets kalla friska skurar susa\noch löftets båge glänser för min sky",
                    "När sommarvinden susar över fälten\nNär blommor dofta invid källans rand\nNär trastar drilla i de gröna tälten\nVid furuskogens tysta, dunkla rand",
                    "När jag i Bibeln skådar alla under\nSom Herren gjort sen förste Adams tid\nHur nådefull Han varit alla stunder\nOch hjälpt sitt folk ur livets synd och strid",
                    "När tryckt av synd och skuld jag faller neder\nvid Herrens fot och ber om nåd och frid\noch han min själ på rätta vägen leder\noch frälsar mig från all min synd och strid",
                    "När en gång alla tidens höljen falla\noch jag får skåda det jag nu får tro\noch evighetens klara klockor kalla\nmin frälsta ande till dess sabbatsro"
                ])
        },
        {
            "9d2ae22f-de51-42a9-9615-f9647e0cd47b", new Song(
                "9d2ae22f-de51-42a9-9615-f9647e0cd47b",
                "Helig, helig, helig",
                [
                    "Helig, helig, helig, Herre Gud allsmäktig\nNär den nya dagen gryr vår lovsång till dig går\nHelig, helig, helig, nådefull och mäktig\nDig vi vill tillbedja, Gud och Fader vår",
                    "Helig, helig, helig, sjunga helgon alla,\nsänka sina gyllne kronor för din härlighet.\nNed för dig keruber och serafer falla.\nDu var och är och blir i evighet.",
                    "Helig, helig, helig, hög och otillgänglig\när din glans din klara som ej syndigt öga ser.\nEvig är din nåd din kärlek oförgänglig.\nAllgod till stoftets barn Du skådar ner.",
                    "Helig, helig, helig, Herre Gud allsmäktig!\nÖver himlar, jord och hav ditt herravälde når.\nHelig, helig, helig nådefull och mäktig\nDig vi tillbedja Gud och Fader vår."
                ])
        }
    };

    public Song? GetSongById(string id)
    {
        return allSongs.TryGetValue(id, out var song) ? song : null;
    }
}
