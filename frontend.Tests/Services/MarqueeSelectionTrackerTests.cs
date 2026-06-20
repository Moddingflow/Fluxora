using Fluxora.App.Services;

namespace Fluxora.App.Tests.Services;

public sealed class MarqueeSelectionTrackerTests
{
    [Fact]
    public void Replace_SelectsOnlyCurrentHitsAndClearsHitsThatLeave()
    {
        List<SelectableItem> items = [new("a"), new("b"), new("c")];
        items[0].IsSelected = true;
        MarqueeSelectionTracker<SelectableItem> tracker = CreateTracker();

        tracker.Begin(items, RangeSelectionGesture.Replace);
        tracker.Apply(new HashSet<SelectableItem> { items[1], items[2] });

        Assert.Equal(["b", "c"], SelectedIds(items));

        tracker.Apply(new HashSet<SelectableItem> { items[2] });

        Assert.Equal(["c"], SelectedIds(items));
    }

    [Fact]
    public void Extend_PreservesBaselineSelectionAndAddsCurrentHits()
    {
        List<SelectableItem> items = [new("a"), new("b"), new("c"), new("d")];
        items[0].IsSelected = true;
        MarqueeSelectionTracker<SelectableItem> tracker = CreateTracker();

        tracker.Begin(items, RangeSelectionGesture.Extend);
        tracker.Apply(new HashSet<SelectableItem> { items[2], items[3] });

        Assert.Equal(["a", "c", "d"], SelectedIds(items));

        tracker.Apply(new HashSet<SelectableItem> { items[3] });

        Assert.Equal(["a", "d"], SelectedIds(items));
    }

    [Fact]
    public void Toggle_InvertsCurrentHitsAndRestoresBaselineWhenHitsLeave()
    {
        List<SelectableItem> items = [new("a"), new("b"), new("c")];
        items[0].IsSelected = true;
        items[1].IsSelected = true;
        MarqueeSelectionTracker<SelectableItem> tracker = CreateTracker();

        tracker.Begin(items, RangeSelectionGesture.Toggle);
        tracker.Apply(new HashSet<SelectableItem> { items[1], items[2] });

        Assert.Equal(["a", "c"], SelectedIds(items));

        tracker.Apply(new HashSet<SelectableItem> { items[2] });

        Assert.Equal(["a", "b", "c"], SelectedIds(items));

        tracker.Apply(new HashSet<SelectableItem>());

        Assert.Equal(["a", "b"], SelectedIds(items));
    }

    [Fact]
    public void Apply_ReturnsFalseWhenHitSetDidNotChange()
    {
        List<SelectableItem> items = [new("a"), new("b")];
        MarqueeSelectionTracker<SelectableItem> tracker = CreateTracker();
        HashSet<SelectableItem> hits = [items[1]];

        tracker.Begin(items, RangeSelectionGesture.Replace);
        bool firstApplyChanged = tracker.Apply(hits);
        bool secondApplyChanged = tracker.Apply(hits);

        Assert.True(firstApplyChanged);
        Assert.False(secondApplyChanged);
        Assert.Equal(["b"], SelectedIds(items));
    }

    [Fact]
    public void Begin_ReturnsTrueWhenReplaceClearsExistingSelection()
    {
        List<SelectableItem> items = [new("a"), new("b")];
        items[0].IsSelected = true;
        MarqueeSelectionTracker<SelectableItem> tracker = CreateTracker();

        bool changed = tracker.Begin(items, RangeSelectionGesture.Replace);

        Assert.True(changed);
        Assert.Empty(SelectedIds(items));
    }

    [Fact]
    public void Begin_ReturnsFalseWhenGestureKeepsBaselineSelection()
    {
        List<SelectableItem> items = [new("a"), new("b")];
        items[0].IsSelected = true;
        MarqueeSelectionTracker<SelectableItem> tracker = CreateTracker();

        bool changed = tracker.Begin(items, RangeSelectionGesture.Extend);

        Assert.False(changed);
        Assert.Equal(["a"], SelectedIds(items));
    }

    private static MarqueeSelectionTracker<SelectableItem> CreateTracker()
    {
        return new MarqueeSelectionTracker<SelectableItem>(
            static item => item.IsSelected,
            static (item, selected) => item.IsSelected = selected);
    }

    private static string[] SelectedIds(IEnumerable<SelectableItem> items)
    {
        return items.Where(item => item.IsSelected).Select(item => item.Id).ToArray();
    }

    private sealed class SelectableItem
    {
        public SelectableItem(string id)
        {
            Id = id;
        }

        public string Id { get; }
        public bool IsSelected { get; set; }
    }
}
