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
    
    [ObservableProperty] private Project? selectedProject;

    [ObservableProperty] private ProjectItem? selectedProjectItem;
    [ObservableProperty] private int? selectedItemPartIndex;

    public void Reset()
    {
        SelectedProject = null;
    }
}
