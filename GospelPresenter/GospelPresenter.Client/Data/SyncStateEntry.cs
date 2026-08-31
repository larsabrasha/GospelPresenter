namespace GospelPresenter.Client.Data;

/// <summary>
/// Client-side key/value state for the sync engine: the pull watermark, and the "applying" flag
/// the change-journal triggers consult so rows written while applying a pull are not journaled
/// back as local edits (echo suppression). The table name is fixed because the trigger SQL in
/// <c>SyncTriggerInstaller</c> references it verbatim.
/// </summary>
public class SyncStateEntry
{
    public const string TableName = "SyncState";

    /// <summary>Set to "1" (inside the applying transaction) while server rows are being written.</summary>
    public const string ApplyingKey = "applying";

    /// <summary>The server watermark of the last completed pull, ISO-8601.</summary>
    public const string WatermarkKey = "watermark";

    public string Key { get; set; } = "";
    public string Value { get; set; } = "";
}
