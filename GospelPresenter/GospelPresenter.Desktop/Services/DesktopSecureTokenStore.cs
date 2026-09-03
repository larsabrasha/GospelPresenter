using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;
using GospelPresenter.Client.Auth;

namespace GospelPresenter.Desktop.Services;

/// <summary>
/// The device token at rest, in whatever the platform actually offers.
///
///   macOS    the login keychain, through the security(1) tool
///   Windows  DPAPI, encrypted to the current user, in a file beside the data
///   Linux    a file with owner-only permissions, NOT encrypted
///
/// Electron has safeStorage, which would cover all three, but ElectronNET.Core does not expose it;
/// going through the renderer to reach it would put the token through the same channel the page
/// can see. These are the platform's own facilities, reached directly.
///
/// The Linux path is the honest gap. A 0600 file protects the token from other users on the box and
/// from nothing else, which is the same protection the cached identity next to it already has. A
/// libsecret binding would be the fix, and is worth having before anyone runs this on a shared
/// Linux machine.
/// </summary>
public class DesktopSecureTokenStore(ILogger<DesktopSecureTokenStore> logger) : ISecureTokenStore
{
    /// <summary>
    /// The keychain service the item is filed under, and the one place in this class where the
    /// installation's identity shows up: the file path below is already inside a per-scheme
    /// directory, but the macOS keychain is one namespace for the whole login session. Left as a
    /// bare constant, a Test build signing in would overwrite the real app's device token.
    /// </summary>
    private static string ServiceName => DesktopBuild.AppFolderName;

    private const string AccountName = "device-token";

    private static string FilePath => Path.Combine(DesktopPaths.DataDirectory, "device-token");

    public Task<string?> GetTokenAsync() =>
        Task.FromResult(OperatingSystem.IsMacOS() ? KeychainGet() : FileGet());

    public Task SetTokenAsync(string token)
    {
        if (OperatingSystem.IsMacOS())
            KeychainSet(token);
        else
            FileSet(token);

        return Task.CompletedTask;
    }

    public Task RemoveTokenAsync()
    {
        if (OperatingSystem.IsMacOS())
            Security("delete-generic-password", "-s", ServiceName, "-a", AccountName);
        else if (File.Exists(FilePath))
            File.Delete(FilePath);

        return Task.CompletedTask;
    }

    private string? KeychainGet()
    {
        // -w prints the password alone. A missing item exits 44, which is not an error here.
        var (exitCode, output) = Security("find-generic-password", "-s", ServiceName, "-a", AccountName, "-w");
        if (exitCode == 0)
            return output.TrimEnd('\n');

        if (exitCode != 44)
            logger.LogWarning("Reading the keychain failed with exit code {ExitCode}", exitCode);

        return null;
    }

    private void KeychainSet(string token)
    {
        // -U updates an existing item instead of failing on the duplicate.
        var (exitCode, _) = Security("add-generic-password", "-s", ServiceName, "-a", AccountName, "-w", token, "-U");
        if (exitCode != 0)
            logger.LogError("Writing to the keychain failed with exit code {ExitCode}", exitCode);
    }

    private static (int ExitCode, string Output) Security(params string[] arguments)
    {
        var info = new ProcessStartInfo("/usr/bin/security")
        {
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };
        foreach (var argument in arguments)
            info.ArgumentList.Add(argument);

        using var process = Process.Start(info)!;
        var output = process.StandardOutput.ReadToEnd();
        process.WaitForExit();
        return (process.ExitCode, output);
    }

    private string? FileGet()
    {
        if (!File.Exists(FilePath))
            return null;

        try
        {
            var stored = File.ReadAllBytes(FilePath);
            if (!OperatingSystem.IsWindows())
                return Encoding.UTF8.GetString(stored);

            var plaintext = ProtectedData.Unprotect(stored, optionalEntropy: null, DataProtectionScope.CurrentUser);
            return Encoding.UTF8.GetString(plaintext);
        }
        catch (Exception e)
        {
            // A token that cannot be read means signing in again, never a broken app.
            logger.LogError(e, "The stored device token could not be read; the user will need to sign in again");
            return null;
        }
    }

    private static void FileSet(string token)
    {
        var bytes = Encoding.UTF8.GetBytes(token);
        if (OperatingSystem.IsWindows())
            bytes = ProtectedData.Protect(bytes, optionalEntropy: null, DataProtectionScope.CurrentUser);

        File.WriteAllBytes(FilePath, bytes);

        if (!OperatingSystem.IsWindows())
            File.SetUnixFileMode(FilePath, UnixFileMode.UserRead | UnixFileMode.UserWrite);
    }
}
