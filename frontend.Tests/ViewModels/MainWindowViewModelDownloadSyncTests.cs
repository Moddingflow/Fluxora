using Fluxora.App.Models;
using Fluxora.App.ViewModels;

namespace Fluxora.App.Tests.ViewModels;

public sealed class MainWindowViewModelDownloadSyncTests
{
    [Fact]
    public void AreEquivalentDownloadEntries_IgnoresSelectionState()
    {
        DownloadEntry selected = CreateDownload();
        selected.IsSelected = true;
        DownloadEntry incoming = CreateDownload();

        Assert.True(MainWindowViewModel.AreEquivalentDownloadEntries(selected, incoming));
    }

    [Fact]
    public void AreEquivalentDownloadEntries_DetectsProgressChanges()
    {
        DownloadEntry current = CreateDownload(progressPercent: 12);
        DownloadEntry incoming = CreateDownload(progressPercent: 48);

        Assert.False(MainWindowViewModel.AreEquivalentDownloadEntries(current, incoming));
    }

    private static DownloadEntry CreateDownload(int progressPercent = 12)
    {
        return new DownloadEntry
        {
            Id = @"C:\Fluxora\downloads\mod.zip",
            Name = "Mod",
            FileName = "mod.zip",
            LocalPath = @"C:\Fluxora\downloads\mod.zip",
            Source = "Nexus",
            Status = "Downloading",
            SizeText = "12 MB",
            CreatedAtText = "today",
            ProgressPercent = progressPercent,
            ProgressText = $"{progressPercent}%",
            EtaText = "1 min",
            DownloadSpeedText = "2 MB/s",
            IsDownloading = true,
            HasKnownProgress = true,
            CanResume = false,
            CanInstall = false,
            CanDelete = true
        };
    }
}
