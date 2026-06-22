using System.Collections.ObjectModel;
using System.Collections.Specialized;
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

    [Fact]
    public void Sync_AppliesSmallMixedDiffIncrementally()
    {
        SyncItem first = new("a", "Ready");
        SyncItem second = new("b", "Ready");
        SyncItem third = new("c", "Ready");
        SyncItem fourth = new("d", "Ready");
        ObservableCollection<SyncItem> target = new([first, second, third, fourth]);
        SyncItem inserted = new("x", "Ready");
        SyncItem changedFirst = new("a", "Downloading");
        SyncItem appended = new("e", "Ready");

        OrderedCollectionSyncService.Sync(
            target,
            [inserted, third, changedFirst, appended],
            static item => item.Id,
            static (left, right) => left.Status == right.Status);

        Assert.Collection(
            target,
            item => Assert.Same(inserted, item),
            item => Assert.Same(third, item),
            item => Assert.Same(changedFirst, item),
            item => Assert.Same(appended, item));
    }

    [Fact]
    public void Sync_WithLargeReversedCollection_UsesSingleReset()
    {
        List<SyncItem> items = CreateItems(10_000);
        BulkObservableCollection<SyncItem> target = new();
        target.ReplaceAll(items);
        List<NotifyCollectionChangedEventArgs> events = [];

        target.CollectionChanged += (_, args) => events.Add(args);
        List<SyncItem> source = items
            .Select(item => new SyncItem(item.Id, item.Status))
            .Reverse()
            .ToList();

        OrderedCollectionSyncService.Sync(
            target,
            source,
            static item => item.Id,
            static (left, right) => left.Status == right.Status);

        Assert.Equal(source.Select(item => item.Id), target.Select(item => item.Id));
        Assert.Same(items[^1], target[0]);
        NotifyCollectionChangedEventArgs notification = Assert.Single(events);
        Assert.Equal(NotifyCollectionChangedAction.Reset, notification.Action);
    }

    [Fact]
    public void Sync_WithLargeShuffledCollection_UsesSingleReset()
    {
        List<SyncItem> items = CreateItems(10_000);
        BulkObservableCollection<SyncItem> target = new();
        target.ReplaceAll(items);
        List<NotifyCollectionChangedEventArgs> events = [];

        target.CollectionChanged += (_, args) => events.Add(args);
        List<SyncItem> source = items
            .Select((_, index) => items[(index * 7_919) % items.Count])
            .Select(item => new SyncItem(item.Id, item.Status))
            .ToList();

        OrderedCollectionSyncService.Sync(
            target,
            source,
            static item => item.Id,
            static (left, right) => left.Status == right.Status);

        Assert.Equal(source.Select(item => item.Id), target.Select(item => item.Id));
        Assert.Same(items[7_919], target[1]);
        NotifyCollectionChangedEventArgs notification = Assert.Single(events);
        Assert.Equal(NotifyCollectionChangedAction.Reset, notification.Action);
    }

    private static List<SyncItem> CreateItems(int count)
    {
        return Enumerable.Range(0, count)
            .Select(index => new SyncItem($"item-{index}", "Ready"))
            .ToList();
    }

    private sealed record SyncItem(string Id, string Status);
}
