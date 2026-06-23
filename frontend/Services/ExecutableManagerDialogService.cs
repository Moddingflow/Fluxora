using Fluxora.App.Models;

namespace Fluxora.App.Services;

public sealed class ExecutableManagerDialogService : IExecutableManagerDialogService
{
    private readonly CoreBridgeService coreBridgeService;
    private readonly ThemeService themeService;

    public ExecutableManagerDialogService(CoreBridgeService coreBridgeService, ThemeService themeService)
    {
        this.coreBridgeService = coreBridgeService;
        this.themeService = themeService;
    }

    public IReadOnlyList<GameExecutableEntry>? EditExecutables(
        IReadOnlyList<GameExecutableEntry> executables,
        string gamePath,
        string projectDirectory)
    {
        ExecutableManagerWindow dialog = new(
            executables,
            gamePath,
            projectDirectory,
            coreBridgeService.ResolveExecutableIconPath)
        {
            Owner = System.Windows.Application.Current?.MainWindow
        };
        themeService.ApplyCurrentThemeTo(dialog);

        return dialog.ShowDialog() == true ? dialog.ResultExecutables : null;
    }
}
