using Fluxora.App.Models;

namespace Fluxora.App.Services;

public sealed class BuildSettingsDialogService : IBuildSettingsDialogService
{
    private readonly CoreBridgeService coreBridgeService;
    private readonly IFolderPickerService folderPickerService;
    private readonly IExecutablePickerService executablePickerService;
    private readonly ThemeService themeService;

    public BuildSettingsDialogService(
        CoreBridgeService coreBridgeService,
        IFolderPickerService folderPickerService,
        IExecutablePickerService executablePickerService,
        ThemeService themeService)
    {
        this.coreBridgeService = coreBridgeService;
        this.folderPickerService = folderPickerService;
        this.executablePickerService = executablePickerService;
        this.themeService = themeService;
    }

    public BuildSettingsResult? EditBuildPaths(ModProject project)
    {
        BuildSettingsWindow dialog = new(
            coreBridgeService,
            folderPickerService,
            executablePickerService,
            project)
        {
            Owner = System.Windows.Application.Current?.MainWindow
        };
        themeService.ApplyCurrentThemeTo(dialog);

        return dialog.ShowDialog() == true ? dialog.SavedResult : null;
    }
}
