using System.IO;
using Fluxora.App.ViewModels;

namespace Fluxora.App.Tests.ViewModels;

public sealed class MainWindowViewModelProjectDirectoryPreviewTests
{
    [Fact]
    public async Task TargetProjectDirectoryGetterReturnsLastPreviewWithoutCallingBuilder()
    {
        int previewCalls = 0;
        MainWindowViewModel viewModel = MainWindowViewModelTestFactory.Create(
            (projectName, installRootDirectory, _) =>
            {
                previewCalls++;
                return Task.FromResult(Path.Combine(installRootDirectory, projectName));
            });

        viewModel.ProjectName = "Foundation Edition";
        viewModel.InstallRootDirectory = @"C:\Fluxora\Builds";

        Assert.Equal(string.Empty, viewModel.TargetProjectDirectory);
        _ = viewModel.TargetProjectDirectory;
        _ = viewModel.TargetProjectDirectory;
        Assert.Equal(0, previewCalls);

        await viewModel.FlushPendingTargetProjectDirectoryPreviewAsync();

        Assert.Equal(1, previewCalls);
        Assert.Equal(@"C:\Fluxora\Builds\Foundation Edition", viewModel.TargetProjectDirectory);
        _ = viewModel.TargetProjectDirectory;
        Assert.Equal(1, previewCalls);
    }

    [Fact]
    public async Task TargetProjectDirectoryPreviewDebouncesChangesAndUsesLatestInputs()
    {
        List<string> requestedNames = new();
        MainWindowViewModel viewModel = MainWindowViewModelTestFactory.Create(
            (projectName, installRootDirectory, _) =>
            {
                requestedNames.Add(projectName);
                return Task.FromResult(Path.Combine(installRootDirectory, projectName));
            });

        viewModel.InstallRootDirectory = @"C:\Fluxora\Builds";
        foreach (string projectName in new[] { "F", "Fo", "Fou", "Foundation Edition" })
        {
            viewModel.ProjectName = projectName;
        }

        Assert.Empty(requestedNames);
        Assert.InRange(
            MainWindowViewModel.TargetProjectDirectoryPreviewDebounceInterval,
            TimeSpan.FromMilliseconds(100),
            TimeSpan.FromMilliseconds(200));

        await viewModel.FlushPendingTargetProjectDirectoryPreviewAsync();

        string requestedName = Assert.Single(requestedNames);
        Assert.Equal("Foundation Edition", requestedName);
        Assert.Equal(@"C:\Fluxora\Builds\Foundation Edition", viewModel.TargetProjectDirectory);
    }

    [Fact]
    public async Task TargetProjectDirectoryPreviewReusesCachedResultForSameInputs()
    {
        int previewCalls = 0;
        MainWindowViewModel viewModel = MainWindowViewModelTestFactory.Create(
            (projectName, installRootDirectory, _) =>
            {
                previewCalls++;
                return Task.FromResult(Path.Combine(installRootDirectory, projectName));
            });

        viewModel.ProjectName = "Foundation Edition";
        viewModel.InstallRootDirectory = @"C:\Fluxora\Builds";
        await viewModel.FlushPendingTargetProjectDirectoryPreviewAsync();

        Assert.Equal(1, previewCalls);
        Assert.Equal(@"C:\Fluxora\Builds\Foundation Edition", viewModel.TargetProjectDirectory);

        viewModel.ProjectName = string.Empty;
        Assert.Equal(string.Empty, viewModel.TargetProjectDirectory);

        viewModel.ProjectName = "Foundation Edition";

        Assert.Equal(1, previewCalls);
        Assert.Equal(@"C:\Fluxora\Builds\Foundation Edition", viewModel.TargetProjectDirectory);
    }
}
