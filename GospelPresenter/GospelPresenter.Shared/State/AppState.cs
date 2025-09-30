using CommunityToolkit.Mvvm.ComponentModel;
using GospelPresenter.Shared.Models;

namespace GospelPresenter.Shared.State;

public partial class AppState : ObservableObject
{
    [ObservableProperty] private Viewport? mainViewport;
    [ObservableProperty] private Viewport? presentationViewport;
    [ObservableProperty] private int baseSlideWidth = 1920;
    [ObservableProperty] private int baseSlideHeight = 1080;
    [ObservableProperty] private bool isMenuVisible = true;
    
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
                Id = "9d2ae22f-de51-42a9-9615-f9647e0cd47g",
                Type = ProjectItemType.Song,
                Title = "Vi vill se Gud"
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
                Title = "Majestät"
            },
            new ProjectItem
            {
                Id = "9d2ae22f-de51-42a9-9615-f9647e0cd47e",
                Type = ProjectItemType.Song,
                Title = "Mer av dig, Jesus"
            },
            new ProjectItem
            {
                Id = "9d2ae22f-de51-42a9-9615-f9647e0cd47d",
                Type = ProjectItemType.Song,
                Title = "Högst av allt"
            },
            new ProjectItem
            {
                Id = "9d2ae22f-de51-42a9-9615-f9647e0cd47f",
                Type = ProjectItemType.Song,
                Title = "Det är saligt"
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

    public void Reset()
    {
        SelectedProject = null;
    }
}
