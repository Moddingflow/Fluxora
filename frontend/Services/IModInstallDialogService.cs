using Fluxora.App.Models;

namespace Fluxora.App.Services;

public interface IModInstallDialogService
{
    ModInstallDialogResult? PickModInstallOptions(string suggestedName, ContentLayoutPreview? layoutPreview = null);
    string? PickModName(string suggestedName, ContentLayoutPreview? layoutPreview = null);
    string? PickEmptyModName(string suggestedName);
    ExistingModInstallMode? PickExistingModInstallMode(string modName);
    IReadOnlyList<string>? PickFomodSelections(FomodInstallerInfo installer);
    string? PickSeparatorName(string suggestedName);
    string? PickProjectName(string suggestedName);
}
