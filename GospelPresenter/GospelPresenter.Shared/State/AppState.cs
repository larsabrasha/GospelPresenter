using CommunityToolkit.Mvvm.ComponentModel;
using GospelPresenter.Shared.Services;

namespace GospelPresenter.Shared.State;

public partial class AppState(
    ISongService songService,
    IImageService imageService
) : ObservableObject
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
                Title = "Herren är vår Gud"
            },
            new ProjectItem
            {
                Id = "9d2ae22f-de51-42a9-9615-f9647e0cd47b",
                Type = ProjectItemType.Song,
                Title = "I tid och rum"
            },
            new ProjectItem
            {
                Id = "9d2ae22f-de51-42a9-9615-f9647e0cd47c",
                Type = ProjectItemType.Song,
                Title = "Majestät, konung i evighet"
            },
            new ProjectItem
            {
                Id = "9d2ae22f-de51-42a9-9615-f9647e0cd47d",
                Type = ProjectItemType.Song,
                Title = "Högst av allt"
            },
            new ProjectItem
            {
                Id = "9d2ae22f-de51-42a9-9615-f9647e0cd47e",
                Type = ProjectItemType.Song,
                Title = "Mer av dig"
            },
            new ProjectItem
            {
                Id = "9d2ae22f-de51-42a9-9615-f9647e0cd47f",
                Type = ProjectItemType.Song,
                Title = "Det är saligt (Psalm 263?)"
            },
            new ProjectItem
            {
                Id = "9d2ae22f-de51-42a9-9615-f9647e0cd47g",
                Type = ProjectItemType.Song,
                Title = "Vi vill se Gud"
            },
            new ProjectItem
            {
                Id = "9d2ae22f-de51-42a9-9615-f9647e0cd47i",
                Type = ProjectItemType.Image,
                Title = "Swish"
            }
        ]
    };

    [ObservableProperty] private ProjectItem? selectedProjectItem;
    [ObservableProperty] private int? selectedItemPartIndex;

    [ObservableProperty] private LiveSlide liveSlide = new(
        LiveSlideStatus.ShowingPresentation,
        null,
        null,
        null,
        null
    );

    public void Reset()
    {
        IsAboutModalVisible = false;
        IsLogoutModalVisible = false;
        IsAcknowledgementsModalVisible = false;

        AuthProgress = ProgressEnum.NotStarted;
        LoggedInUser = null;
        InitialDataProgress = ProgressEnum.NotStarted;
    }

    public void SetSelectedLiveSlide(string selectedItemId, int partIndex)
    {
        var projectItem = SelectedProject?.Items.FirstOrDefault(x => x.Id == selectedItemId);
        if (projectItem is null) return;

        string? text = null;
        string? imageUrl = null;

        switch (projectItem.Type)
        {
            case ProjectItemType.Song:
            {
                var song = songService.GetSongById(projectItem.Id);
                if (song is not null && partIndex < song.Parts.Count)
                {
                    text = song.Parts[partIndex].Replace("\n", "<br>");
                }

                break;
            }
            case ProjectItemType.Image:
            {
                var image = imageService.GetImageById(projectItem.Id);
                if (image is not null)
                {
                    imageUrl = image.Url;
                }

                break;
            }
            case ProjectItemType.BibleText:
                break;
            default:
                return;
        }

        LiveSlide = LiveSlide with
        {
            ProjectItemId = selectedItemId,
            ItemPartIndex = partIndex,
            Text = text,
            ImageUrl = imageUrl
        };
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
