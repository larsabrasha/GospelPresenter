namespace GospelPresenter.Shared.Models;

public class OrganizationSetting
{
    public const string SongFontSize = "SongFontSize";
    public const string SongFontFamily = "SongFontFamily";
    public const string SongFontWeight = "SongFontWeight";
    public const string SongLineHeight = "SongLineHeight";

    public const string CreditsFontSize = "CreditsFontSize";
    public const string CreditsFontFamily = "CreditsFontFamily";
    public const string CreditsFontWeight = "CreditsFontWeight";
    public const string CreditsLineHeight = "CreditsLineHeight";

    public const string BibleFontSize = "BibleFontSize";
    public const string BibleFontFamily = "BibleFontFamily";
    public const string BibleFontWeight = "BibleFontWeight";
    public const string BibleLineHeight = "BibleLineHeight";

    public const string BibleCreditsFontSize = "BibleCreditsFontSize";
    public const string BibleCreditsFontFamily = "BibleCreditsFontFamily";
    public const string BibleCreditsFontWeight = "BibleCreditsFontWeight";
    public const string BibleCreditsLineHeight = "BibleCreditsLineHeight";

    public const string CcliCollectionEnabled = "CcliCollectionEnabled";

    public string Id { get; set; } = Guid.NewGuid().ToString();
    public string OrganizationId { get; set; } = "";
    public Organization Organization { get; set; } = null!;
    public string Key { get; set; } = "";
    public string Value { get; set; } = "";
}
