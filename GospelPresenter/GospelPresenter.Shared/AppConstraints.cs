namespace GospelPresenter.Shared;

public static class AppConstraints
{
    // Text lengths
    public const int NameMaxLength = 200;
    public const int EmailMaxLength = 320;
    public const int DescriptionMaxLength = 5_000;
    public const int LocationMaxLength = 100;
    public const int SongAuthorMaxLength = 200;
    public const int SongPublisherMaxLength = 200;
    public const int SongCcliMaxLength = 20;
    public const int SongPartLabelMaxLength = 50;
    public const int SongPartLabelTextMaxLength = 50;
    public const int SongPartLabelColorMaxLength = 7;
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
    public const int MaxSongPartLabelsPerOrg = 50;
    public const int MaxSongPartsPerSong = 50;
    public const int MaxSongVersionsPerSong = 50;
    public const int MaxArrangementsPerSong = 10;
    public const int SongArrangementNameMaxLength = 100;
    public const int SongArrangementPartIdsJsonMaxLength = 5_000;
    public const int MaxOverlaysPerOrg = 200;
    public const int MaxRemoteDisplaysPerOrg = 50;
    public const int MaxUsersPerOrg = 100;
    public const int MaxOrganizationsTotal = 100;
    public const int MaxImagesPerOrg = 1_000;
    public const int MaxAudioPerOrg = 500;
    public const int MaxApiKeysPerUser = 10;
    public const int MaxDeviceTokensPerUser = 10;
    public const int MaxCalendarSubscriptionsPerUser = 10;

    /// <summary>
    /// How long a trashed song or presentation is kept before it is purged for good. Purging is
    /// lazy — it runs when someone opens the trash — so a row may outlive this without anyone
    /// looking, which is the safe direction to be wrong in.
    /// </summary>
    public const int TrashRetentionDays = 30;
    public const int MaxInvitesPerUser = 20;
    public const int MaxLoginsPerUser = 5;
    public const int MaxSettingsPerUser = 50;
    public const int MaxSettingsPerOrg = 50;

    // Bible constraints
    public const int BibleAbbreviationMaxLength = 50;
    public const int MaxBiblesPerOrg = 10;
    public const long MaxBibleFileSizeBytes = 50 * 1024 * 1024;

    // File sizes (bytes)
    public const long MaxImageFileSizeBytes = 10 * 1024 * 1024;
    public const long MaxAudioFileSizeBytes = 20 * 1024 * 1024;
    public const long MaxSlidesFileSizeBytes = 50 * 1024 * 1024;

    // A ProPresenter file is mostly text, but one can carry embedded media as well. Only the
    // device apps enforce this: the web posts the files to an endpoint, which has its own limits.
    public const long MaxSongImportFileSizeBytes = 25 * 1024 * 1024;

    // Slides constraints
    public const int MaxSlidesPageCount = 100;

    // Allowed content types
    public static readonly IReadOnlySet<string> AllowedImageTypes = new HashSet<string> { "image/jpeg", "image/png", "image/webp", "image/gif" };
    public static readonly IReadOnlySet<string> AllowedAudioTypes = new HashSet<string> { "audio/mpeg", "audio/wav", "audio/ogg", "audio/mp4", "audio/webm", "audio/x-m4a" };
    public const string PdfContentType = "application/pdf";
    public const string PptxContentType = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    public const string PptContentType = "application/vnd.ms-powerpoint";

    public static readonly IReadOnlySet<string> AllowedSlidesTypes = new HashSet<string>
    {
        PdfContentType,
        PptxContentType,
        PptContentType,
    };

    public static readonly IReadOnlySet<string> PowerPointContentTypes = new HashSet<string>
    {
        PptxContentType,
        PptContentType,
    };

    // Accept strings for file inputs
    public const string ImageAccept = "image/jpeg,image/png,image/webp,image/gif";
    public const string AudioAccept = "audio/mpeg,audio/wav,audio/ogg,audio/mp4,audio/webm,audio/x-m4a";
    public const string SlidesAccept = "application/pdf,.pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation,.pptx,application/vnd.ms-powerpoint,.ppt";

    // JS file-read sentinel values (must match utils.js readFileAsDataUrl)
    public const string FileReadUnsupportedType = "unsupported-type";
    public const string FileReadTooLarge = "too-large";
}
