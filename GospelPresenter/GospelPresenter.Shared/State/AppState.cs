using CommunityToolkit.Mvvm.ComponentModel;

namespace GospelPresenter.Shared.State;

public partial class AppState : ObservableObject
{
    [ObservableProperty] private bool? isWebViewVersionInsufficient;
    
    [ObservableProperty] private bool isAboutModalVisible;
    [ObservableProperty] private bool isLogoutModalVisible;
    [ObservableProperty] private bool isAcknowledgementsModalVisible;

    [ObservableProperty] private ProgressEnum authProgress;
    [ObservableProperty] private string? authMessage;
    [ObservableProperty] private LoggedInUser? loggedInUser;
    [ObservableProperty] private ProgressEnum initialDataProgress;
    
    public void Reset()
    {
        IsAboutModalVisible = false;
        IsLogoutModalVisible = false;
        IsAcknowledgementsModalVisible = false;

        AuthProgress = ProgressEnum.NotStarted;
        LoggedInUser = null;
        InitialDataProgress = ProgressEnum.NotStarted;
    }
}

public record LoggedInUser(string Token, string UserId);

public enum ProgressEnum
{
    NotStarted,
    InProgress,
    Success,
    Failed
}
