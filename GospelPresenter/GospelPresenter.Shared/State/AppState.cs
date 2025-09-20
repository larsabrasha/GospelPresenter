using CommunityToolkit.Mvvm.ComponentModel;
using GospelPresenter.Shared.Services;

namespace GospelPresenter.Shared.State;

public partial class AppState(ISongService songService) : ObservableObject
{
    [ObservableProperty] private bool? isWebViewVersionInsufficient;

    [ObservableProperty] private bool isAboutModalVisible;
    [ObservableProperty] private bool isLogoutModalVisible;
    [ObservableProperty] private bool isAcknowledgementsModalVisible;

    [ObservableProperty] private ProgressEnum authProgress;
    [ObservableProperty] private string? authMessage;
    [ObservableProperty] private LoggedInUser? loggedInUser;
    [ObservableProperty] private ProgressEnum initialDataProgress;

    [ObservableProperty] private Project? selectedProject = new()
    {
        Id = "841fbdf8-4df1-4f11-ad20-b3b708cf4980",
        Name = "Gudstjänst 21/9 2025",
        Items =
        [
            new ProjectItem
            {
                Id = "9d2ae22f-de51-42a9-9615-f9647e0cd47a",
                Type = ProjectItemType.Song,
                Title = "O store Gud"
            },
            new ProjectItem
            {
                Id = "9d2ae22f-de51-42a9-9615-f9647e0cd47b",
                Type = ProjectItemType.Song,
                Title = "Helig, helig, helig"
            },
            new ProjectItem
            {
                Id = "9d2ae22f-de51-42a9-9615-f9647e0cd47c",
                Type = ProjectItemType.Song,
                Title = "Lov, ära och pris"
            },
            new ProjectItem
            {
                Id = "9d2ae22f-de51-42a9-9615-f9647e0cd47d",
                Type = ProjectItemType.Song,
                Title = "Brist ut, min själ, i lovsångs ljud"
            },
            new ProjectItem
            {
                Id = "9d2ae22f-de51-42a9-9615-f9647e0cd47e",
                Type = ProjectItemType.Song,
                Title = "Jublen, I himlar"
            },
            new ProjectItem
            {
                Id = "9d2ae22f-de51-42a9-9615-f9647e0cd47f",
                Type = ProjectItemType.Song,
                Title = "Änglarna sjunger i himlen"
            },
            new ProjectItem
            {
                Id = "9d2ae22f-de51-42a9-9615-f9647e0cd47g",
                Type = ProjectItemType.Song,
                Title = "Gud är mitt allt"
            },
            new ProjectItem
            {
                Id = "9d2ae22f-de51-42a9-9615-f9647e0cd47h",
                Type = ProjectItemType.Song,
                Title = "Makten är i Jesu händer"
            }
        ]
    };

    [ObservableProperty] private string? selectedProjectItemId;
    [ObservableProperty] private int? selectedItemPartIndex;

    [ObservableProperty] private LiveSlide liveSlide = new(LiveSlideStatus.ShowingPresentation, null, null, null);


    public void Reset()
    {
        IsAboutModalVisible = false;
        IsLogoutModalVisible = false;
        IsAcknowledgementsModalVisible = false;

        AuthProgress = ProgressEnum.NotStarted;
        LoggedInUser = null;
        InitialDataProgress = ProgressEnum.NotStarted;
    }

    public void SetSelectedLiveSlide(string selectedSongId, int partIndex)
    {
        var projectItem = SelectedProject?.Items.FirstOrDefault(x => x.Id == selectedSongId);

        string? text = null;

        if (projectItem is not null &&
            projectItem.Type == ProjectItemType.Song)
        {
            var song = songService.GetSongById(projectItem.Id);

            if (song is not null && partIndex < song.Parts.Count)
            {
                text = song.Parts[partIndex].Replace("\n", "<br>");
            }
        }

        LiveSlide = LiveSlide with { ProjectItemId = selectedSongId, ItemPartIndex = partIndex, Text = text };
    }

    public void ToggleBlackScreen()
    {
        LiveSlide = LiveSlide with
        {
            Status = LiveSlide.Status == LiveSlideStatus.ShowingPresentation
                ? LiveSlideStatus.ShowingBlackScreen
                : LiveSlideStatus.ShowingPresentation
        };
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
