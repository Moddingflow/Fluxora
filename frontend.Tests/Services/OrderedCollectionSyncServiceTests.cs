using System.Collections.ObjectModel;
using Fluxora.App.Services;

namespace Fluxora.App.Tests.Services;

public sealed class OrderedCollectionSyncServiceTests
{
    [Fact]
    public void Sync_KeepsExistingItemWhenIncomingItemIsEquivalent()
    {
        SyncItem existing = new("download-1", "Ready");
        ObservableCollection<SyncItem> target = new([existing]);
        SyncItem incoming = new("download-1", "Ready");

        OrderedCollectionSyncService.Sync(
            target,
            [incoming],
            static item => item.Id,
            static (left, right) => left.Status == right.Status);

        Assert.Same(existing, target[0]);
    }

    [Fact]
    public void Sync_ReordersAndReplacesOnlyChangedItems()
    {
        SyncItem first = new("a", "Ready");
        SyncItem second = new("b", "Ready");
        ObservableCollection<SyncItem> target = new([first, second]);
        SyncItem changedFirst = new("a", "Downloading");

        OrderedCollectionSyncService.Sync(
            target,
            [second, changedFirst],
            static item => item.Id,
            static (left, right) => left.Status == right.Status);

        Assert.Same(second, target[0]);
        Assert.Same(changedFirst, target[1]);
    }

    private sealed record SyncItem(string Id, string Status);
}
