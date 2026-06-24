using Fluxora.App.Models;

namespace Fluxora.App.Tests.Models;

public sealed class PluginEntryTests
{
    [Fact]
    public void MissingMasters_CreateWarningTooltip()
    {
        PluginEntry entry = new()
        {
            Id = "Patch.esp",
            Name = "Patch.esp",
            MissingMasters = ["Missing.esm", "Disabled.esm"]
        };

        Assert.True(entry.HasMissingMasters);
        Assert.Contains("Отсутствуют мастер-файлы", entry.MissingMastersTooltip);
        Assert.Contains("- Missing.esm", entry.MissingMastersTooltip);
        Assert.Contains("- Disabled.esm", entry.MissingMastersTooltip);
    }

    [Fact]
    public void SeparatorWithMissingMasters_DoesNotShowPluginWarning()
    {
        PluginEntry entry = new()
        {
            Id = "separator-1",
            Kind = "separator",
            Name = "Gameplay",
            MissingMasters = ["Missing.esm"]
        };

        Assert.False(entry.HasMissingMasters);
        Assert.Equal(string.Empty, entry.MissingMastersTooltip);
    }
}
