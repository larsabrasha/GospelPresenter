namespace GospelPresenter.Shared.Services;

public interface IBibleService
{
    IReadOnlyList<Verse> AllVerses { get; }
    IEnumerable<Verse> Search(string query);
}

public class BibleService : IBibleService
{
    public IReadOnlyList<Verse> AllVerses { get; } = [];

    public IEnumerable<Verse> Search(string query)
    {
        return VerseSearch.Search(AllVerses, query);
    }
}
