using System.Globalization;

namespace GospelPresenter.Shared.Services;

public interface IOnboardingService
{
    Task<bool> ShouldShowWelcomeAsync(string userId, CallerContext caller);
    Task MarkWelcomeShownAsync(string userId, CallerContext caller);
}

public class OnboardingService(IUserService userService) : IOnboardingService
{
    public const string WelcomeShownAtKey = "Onboarding.WelcomeShownAt";

    public async Task<bool> ShouldShowWelcomeAsync(string userId, CallerContext caller)
    {
        var value = await userService.GetUserSettingAsync(userId, WelcomeShownAtKey, caller);
        return string.IsNullOrEmpty(value);
    }

    public async Task MarkWelcomeShownAsync(string userId, CallerContext caller)
    {
        var timestamp = DateTimeOffset.UtcNow.ToString("O", CultureInfo.InvariantCulture);
        await userService.SetUserSettingAsync(userId, WelcomeShownAtKey, timestamp, caller);
    }
}
