namespace GospelPresenter.Web.Configuration;

public class Settings
{
    public string? DataProtectionKeysDirectory { get; set; }
    public string? BiblesPath { get; set; }
    public string? SongsPath { get; set; }
    public int SessionTimeoutMinutes { get; set; } = 240;

    public static readonly string ApiBaseUrl = "";
}
