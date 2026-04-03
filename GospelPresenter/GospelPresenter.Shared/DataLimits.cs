namespace GospelPresenter.Shared;

public static class DataLimits
{
    // Text lengths
    public const int NameMaxLength = 200;
    public const int EmailMaxLength = 320;
    public const int DescriptionMaxLength = 500;
    public const int LocationMaxLength = 100;
    public const int SongAuthorMaxLength = 200;
    public const int SongPublisherMaxLength = 200;
    public const int SongCcliMaxLength = 20;
    public const int SongPartLabelMaxLength = 50;
    public const int SongPartContentMaxLength = 5_000;
    public const int OverlayTitleMaxLength = 200;
    public const int OverlayContentMaxLength = 2_000;
    public const int PresentationItemPartContentMaxLength = 5_000;
    public const int SettingsKeyMaxLength = 200;
    public const int SettingsValueMaxLength = 1_000;
    public const int SongVersionPartsJsonMaxLength = 50_000;
    public const int FileNameMaxLength = 200;
    public const int SearchMaxLength = 100;

    // Numeric ranges
    public const int SongYearMin = 0;
    public const int SongYearMax = 9999;

    // Entity count limits
    public const int MaxPresentationsPerOrg = 3_000;
    public const int MaxTemplatesPerOrg = 50;
    public const int MaxItemsPerPresentation = 100;
    public const int MaxPartsPerPresentationItem = 50;
    public const int MaxSongsPerOrg = 5_000;
    public const int MaxSongPartsPerSong = 50;
    public const int MaxSongVersionsPerSong = 50;
    public const int MaxOverlaysPerOrg = 200;
    public const int MaxUsersPerOrg = 100;
    public const int MaxOrganizationsTotal = 100;
    public const int MaxImagesPerOrg = 1_000;
    public const int MaxAudioPerOrg = 500;
    public const int MaxApiKeysPerUser = 10;
    public const int MaxInvitesPerUser = 20;
    public const int MaxLoginsPerUser = 5;
    public const int MaxSettingsPerUser = 50;
    public const int MaxSettingsPerOrg = 50;

    // File sizes (bytes)
    public const long MaxImageFileSizeBytes = 10 * 1024 * 1024;
    public const long MaxAudioFileSizeBytes = 20 * 1024 * 1024;
}
