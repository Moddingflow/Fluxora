using System.Collections.Specialized;
using Fluxora.App.Services;

namespace Fluxora.App.Tests.Services;

public sealed class BulkObservableCollectionTests
{
    [Fact]
    public void ReplaceAll_WithManyItems_RaisesSingleReset()
    {
        BulkObservableCollection<int> collection = new();
        List<NotifyCollectionChangedEventArgs> events = [];

        collection.CollectionChanged += (_, args) => events.Add(args);
        collection.ReplaceAll(Enumerable.Range(0, 10_000));

        Assert.Equal(10_000, collection.Count);
        NotifyCollectionChangedEventArgs notification = Assert.Single(events);
        Assert.Equal(NotifyCollectionChangedAction.Reset, notification.Action);
    }

    [Fact]
    public void ReplaceAll_WithEmptyItemsOnEmptyCollection_DoesNotNotify()
    {
        BulkObservableCollection<int> collection = new();
        int notificationCount = 0;

        collection.CollectionChanged += (_, _) => ++notificationCount;
        collection.ReplaceAll([]);

        Assert.Empty(collection);
        Assert.Equal(0, notificationCount);
    }
}
