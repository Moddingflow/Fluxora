using Fluxora.App.Models;
using Fluxora.App.Services;
using Fluxora.App.ViewModels;

namespace Fluxora.App.Tests.ViewModels;

public sealed class MainWindowViewModelProjectDeletionTests
{
    [Fact]
    public void DeleteProjectCommand_BlocksReentryWhileConfirmationIsOpen()
    {
        ModProject project = CreateProject();
        MainWindowViewModel? viewModel = null;
        bool canExecuteDuringConfirmation = true;
        InspectingBuildDeletionDialogService deletionDialog = new(_ =>
        {
            canExecuteDuringConfirmation = viewModel!.DeleteProjectCommand.CanExecute(project);
            return false;
        });

        viewModel = MainWindowViewModelTestFactory.Create(buildDeletionDialogService: deletionDialog);
        viewModel.Projects.Add(project);
        viewModel.SelectedProject = project;

        Assert.True(viewModel.DeleteProjectCommand.CanExecute(project));

        viewModel.DeleteProjectCommand.Execute(project);

        Assert.Equal(1, deletionDialog.ConfirmCallCount);
        Assert.False(canExecuteDuringConfirmation);
        Assert.True(viewModel.DeleteProjectCommand.CanExecute(project));
    }

    [Fact]
    public void DeleteProjectCommand_IgnoresNestedExecuteWhileConfirmationIsOpen()
    {
        ModProject project = CreateProject();
        MainWindowViewModel? viewModel = null;
        InspectingBuildDeletionDialogService deletionDialog = new(_ =>
        {
            viewModel!.DeleteProjectCommand.Execute(project);
            return false;
        });

        viewModel = MainWindowViewModelTestFactory.Create(buildDeletionDialogService: deletionDialog);
        viewModel.Projects.Add(project);
        viewModel.SelectedProject = project;

        viewModel.DeleteProjectCommand.Execute(project);

        Assert.Equal(1, deletionDialog.ConfirmCallCount);
        Assert.True(viewModel.DeleteProjectCommand.CanExecute(project));
    }

    private static ModProject CreateProject()
    {
        return new ModProject
        {
            Id = @"C:\Fluxora\Tests\Example\fluxora.build.json",
            Name = "Example Build",
            GameName = "Example Game",
            GamePath = @"C:\Fluxora\Tests\Example\Game",
            InstallRootDirectory = @"C:\Fluxora\Tests",
            ProjectDirectory = @"C:\Fluxora\Tests\Example",
            ConfigPath = @"C:\Fluxora\Tests\Example\fluxora.build.json"
        };
    }

    private sealed class InspectingBuildDeletionDialogService : IBuildDeletionDialogService
    {
        private readonly Func<ConfirmDialogOptions, bool> confirm;

        public InspectingBuildDeletionDialogService(Func<ConfirmDialogOptions, bool> confirm)
        {
            this.confirm = confirm;
        }

        public int ConfirmCallCount { get; private set; }

        public bool Confirm(ConfirmDialogOptions options)
        {
            ConfirmCallCount++;
            return confirm(options);
        }
    }
}
