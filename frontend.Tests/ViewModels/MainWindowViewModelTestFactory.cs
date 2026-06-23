using Fluxora.App.Models;
using Fluxora.App.Services;
using Fluxora.App.ViewModels;

namespace Fluxora.App.Tests.ViewModels;

internal static class MainWindowViewModelTestFactory
{
    public static MainWindowViewModel Create(
        Func<string, string, CancellationToken, Task<string>>? projectDirectoryPreviewBuilder = null,
        IBuildDeletionDialogService? buildDeletionDialogService = null,
        IProfileManagerDialogService? profileManagerDialogService = null)
    {
        ApplicationLogService logService = new();
        CoreBridgeService coreBridgeService = new(logService);
        SettingsService settingsService = new();
        LanguageCatalogService languageCatalogService = new(coreBridgeService);
        ProjectCatalogService projectCatalogService = projectDirectoryPreviewBuilder is null
            ? new ProjectCatalogService(coreBridgeService, settingsService)
            : new ProjectCatalogService(coreBridgeService, settingsService, projectDirectoryPreviewBuilder);
        ProjectOpenService projectOpenService = new(projectCatalogService, coreBridgeService);
        ModCatalogService modCatalogService = new(coreBridgeService);
        PluginCatalogService pluginCatalogService = new(coreBridgeService);
        DownloadCatalogService downloadCatalogService = new(coreBridgeService);
        ProjectWorkspaceLoadService workspaceLoadService = new(
            modCatalogService,
            pluginCatalogService,
            downloadCatalogService);
        NxmProtocolService nxmProtocolService = new(coreBridgeService);
        TemplateCatalogService templateCatalogService = new(coreBridgeService);

        return new MainWindowViewModel(
            projectCatalogService,
            projectOpenService,
            modCatalogService,
            pluginCatalogService,
            downloadCatalogService,
            workspaceLoadService,
            nxmProtocolService,
            templateCatalogService,
            coreBridgeService,
            settingsService,
            languageCatalogService,
            logService,
            new NullFolderPickerService(),
            new NullExecutablePickerService(),
            new NullBuildConfigPickerService(),
            new NullModArchivePickerService(),
            new NullModInstallDialogService(),
            new NullExecutableManagerDialogService(),
            new NullBuildSettingsDialogService(),
            buildDeletionDialogService ?? new NullBuildDeletionDialogService(),
            profileManagerDialogService: profileManagerDialogService);
    }

    private sealed class NullFolderPickerService : IFolderPickerService
    {
        public string? PickFolder(string title, string selectedPath) => null;
    }

    private sealed class NullExecutablePickerService : IExecutablePickerService
    {
        public string? PickExecutable(string title, string selectedPath) => null;
    }

    private sealed class NullBuildConfigPickerService : IBuildConfigPickerService
    {
        public string? PickBuildConfig(string selectedDirectory) => null;
    }

    private sealed class NullModArchivePickerService : IModArchivePickerService
    {
        public string? PickArchive(string selectedDirectory) => null;
    }

    private sealed class NullModInstallDialogService : IModInstallDialogService
    {
        public ModInstallDialogResult? PickModInstallOptions(string suggestedName, ContentLayoutPreview? layoutPreview = null) => null;
        public string? PickModName(string suggestedName, ContentLayoutPreview? layoutPreview = null) => null;
        public string? PickEmptyModName(string suggestedName) => null;
        public ExistingModInstallMode? PickExistingModInstallMode(string modName) => null;
        public IReadOnlyList<string>? PickFomodSelections(FomodInstallerInfo installer) => null;
        public string? PickSeparatorName(string suggestedName) => null;
        public string? PickProjectName(string suggestedName) => null;
    }

    private sealed class NullExecutableManagerDialogService : IExecutableManagerDialogService
    {
        public IReadOnlyList<GameExecutableEntry>? EditExecutables(
            IReadOnlyList<GameExecutableEntry> executables,
            string gamePath,
            string projectDirectory) => null;
    }

    private sealed class NullBuildSettingsDialogService : IBuildSettingsDialogService
    {
        public BuildSettingsResult? EditBuildPaths(ModProject project) => null;
    }

    private sealed class NullBuildDeletionDialogService : IBuildDeletionDialogService
    {
        public bool Confirm(ConfirmDialogOptions options) => false;
    }
}
