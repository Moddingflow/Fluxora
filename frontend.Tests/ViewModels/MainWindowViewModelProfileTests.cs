using Fluxora.App.Models;
using Fluxora.App.Services;
using Fluxora.App.ViewModels;
using System.Reflection;

namespace Fluxora.App.Tests.ViewModels;

public sealed class MainWindowViewModelProfileTests
{
    [Fact]
    public void SelectedProfileNormalizesInputAndFallsBackToTemplateDefault()
    {
        MainWindowViewModel viewModel = MainWindowViewModelTestFactory.Create();
        viewModel.SelectedProject = ProjectWithDefaultProfile("Gameplay");

        viewModel.SelectedProfile = "  Testing  ";

        Assert.Equal("Testing", viewModel.SelectedProfile);
        Assert.Equal("Testing", viewModel.SelectedProfileDisplayText);
        Assert.True(viewModel.CanRenameSelectedProfile);

        viewModel.SelectedProfile = "  ";

        Assert.Equal("Gameplay", viewModel.SelectedProfile);
        Assert.Equal("Gameplay", viewModel.SelectedProfileDisplayText);
        Assert.False(viewModel.CanRenameSelectedProfile);
    }

    [Fact]
    public void DefaultProfileIsProtectedFromDestructiveActions()
    {
        MainWindowViewModel viewModel = MainWindowViewModelTestFactory.Create();
        viewModel.SelectedProject = ProjectWithDefaultProfile("Default");
        viewModel.AvailableProfiles.Add("Default");
        viewModel.AvailableProfiles.Add("Testing");

        viewModel.SelectedProfile = "Default";

        Assert.False(viewModel.CanRenameSelectedProfile);
        Assert.False(viewModel.CanDeleteSelectedProfile);
    }

    [Fact]
    public void OpenProfileManagerPreparesCloneNameAndShowsDialog()
    {
        RecordingProfileManagerDialogService dialogService = new();
        MainWindowViewModel viewModel = MainWindowViewModelTestFactory.Create(profileManagerDialogService: dialogService);
        viewModel.SelectedProject = ProjectWithDefaultProfile("Default");
        viewModel.AvailableProfiles.Add("Default");
        viewModel.AvailableProfiles.Add("Gameplay");
        viewModel.SelectedProfile = "Gameplay";
        SetProjectWorkspaceOpen(viewModel);

        Assert.True(viewModel.OpenProfileManagerCommand.CanExecute(null));

        viewModel.OpenProfileManagerCommand.Execute(null);

        Assert.Same(viewModel, dialogService.ShownViewModel);
        Assert.Equal("Gameplay 2", viewModel.ProfileActionName);
        Assert.False(viewModel.IsProfileMenuOpen);
    }

    private static ModProject ProjectWithDefaultProfile(string defaultProfile)
    {
        return new ModProject
        {
            Id = "project",
            Name = "Project",
            GameName = "Example Game",
            GamePath = @"C:\Games\Example",
            InstallRootDirectory = @"C:\Fluxora",
            ProjectDirectory = @"C:\Fluxora\Project",
            Template = new ResolvedTemplate
            {
                DefaultProfile = defaultProfile
            }
        };
    }

    private static void SetProjectWorkspaceOpen(MainWindowViewModel viewModel)
    {
        MethodInfo setMethod = typeof(MainWindowViewModel)
            .GetProperty(nameof(MainWindowViewModel.IsProjectWorkspaceOpen))!
            .GetSetMethod(nonPublic: true)!;
        setMethod.Invoke(viewModel, new object[] { true });
    }

    private sealed class RecordingProfileManagerDialogService : IProfileManagerDialogService
    {
        public MainWindowViewModel? ShownViewModel { get; private set; }

        public void Show(MainWindowViewModel viewModel)
        {
            ShownViewModel = viewModel;
        }
    }
}
