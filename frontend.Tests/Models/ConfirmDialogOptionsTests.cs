using Fluxora.App.Models;

namespace Fluxora.App.Tests.Models;

public sealed class ConfirmDialogOptionsTests
{
    [Fact]
    public void DeleteModItems_SingleModWarnsAboutPermanentFileDeletion()
    {
        ModEntry mod = new()
        {
            Id = @"C:\Fluxora\Build\mods\SkyUI",
            Name = "SkyUI"
        };

        ConfirmDialogOptions options = ConfirmDialogOptions.DeleteModItems([mod]);

        Assert.Equal("Удалить мод?", options.Heading);
        Assert.Equal("«SkyUI»", options.Highlight);
        Assert.Contains("безвозвратно удалены с диска", options.Message);
        Assert.Equal("Удалить мод", options.ConfirmText);
        Assert.True(options.IsDestructive);
        Assert.Contains(options.Details, detail => detail.Label == "Мод" && detail.Value == "SkyUI");
    }

    [Fact]
    public void DeleteModItems_MixedSelectionExplainsBothDeletionTypes()
    {
        ModEntry mod = new()
        {
            Id = @"C:\Fluxora\Build\mods\USSEP",
            Name = "USSEP"
        };
        ModEntry separator = new()
        {
            Id = "separator-gameplay",
            Kind = "separator",
            Name = "Gameplay",
            SeparatorTitle = "Gameplay"
        };

        ConfirmDialogOptions options = ConfirmDialogOptions.DeleteModItems([mod, separator]);

        Assert.Equal("Удалить выбранные элементы?", options.Heading);
        Assert.Equal("2 элемента", options.Highlight);
        Assert.Contains("моды будут удалены с диска", options.Message);
        Assert.Contains("разделители удалены из порядка модов", options.Message);
        Assert.Equal("Удалить выбранное", options.ConfirmText);
        Assert.Contains(options.Details, detail => detail.Label == "Моды" && detail.Value == "1");
        Assert.Contains(options.Details, detail => detail.Label == "Разделители" && detail.Value == "1");
    }

    [Fact]
    public void DeleteDownloads_SingleDownloadShowsFileAndPath()
    {
        DownloadEntry download = new()
        {
            Id = @"C:\Fluxora\Build\downloads\skyui.7z",
            Name = "SkyUI",
            FileName = "skyui.7z",
            LocalPath = @"C:\Fluxora\Build\downloads\skyui.7z"
        };

        ConfirmDialogOptions options = ConfirmDialogOptions.DeleteDownloads([download]);

        Assert.Equal("Удалить файл загрузки?", options.Heading);
        Assert.Equal("«skyui.7z»", options.Highlight);
        Assert.Contains("безвозвратно удалён из загрузок", options.Message);
        Assert.Equal("Удалить файл", options.ConfirmText);
        Assert.True(options.IsDestructive);
        Assert.Contains(options.Details, detail => detail.Label == "Файл" && detail.Value == "skyui.7z");
        Assert.Contains(options.Details, detail => detail.Label == "Путь" && detail.Value == download.LocalPath);
    }
}
