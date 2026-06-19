using Fluxora.App.Models;

namespace Fluxora.App.Services;

public sealed class ModInstallDialogResult
{
    public ModInstallDialogResult(string modName, IReadOnlyList<PlacementOverride>? placementOverrides = null)
    {
        ModName = modName;
        PlacementOverrides = placementOverrides ?? Array.Empty<PlacementOverride>();
    }

    public string ModName { get; }

    public IReadOnlyList<PlacementOverride> PlacementOverrides { get; }
}
