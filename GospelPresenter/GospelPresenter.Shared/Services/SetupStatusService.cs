namespace GospelPresenter.Shared.Services;

public class SetupStatusService
{
    private bool? setupComplete;

    public async Task<bool> IsSetupCompleteAsync(IUserService userService)
    {
        if (setupComplete == true)
            return true;

        setupComplete = await userService.HasAnyUsersAsync();
        return setupComplete.Value;
    }

    public void MarkSetupComplete()
    {
        setupComplete = true;
    }
}
