namespace Fluxora.App.Services;

public sealed class MarqueeSelectionTracker<T> where T : class
{
    private readonly Func<T, bool> isSelected;
    private readonly Action<T, bool> setSelected;
    private readonly HashSet<T> baselineSelection = new();
    private readonly HashSet<T> currentHits = new();
    private RangeSelectionGesture gesture = RangeSelectionGesture.Replace;

    public MarqueeSelectionTracker(
        Func<T, bool> isSelected,
        Action<T, bool> setSelected)
    {
        this.isSelected = isSelected;
        this.setSelected = setSelected;
    }

    public bool Begin(IEnumerable<T> items, RangeSelectionGesture selectionGesture)
    {
        baselineSelection.Clear();
        currentHits.Clear();
        gesture = selectionGesture;
        bool changed = false;

        foreach (T item in items)
        {
            if (!isSelected(item))
            {
                continue;
            }

            baselineSelection.Add(item);
            if (gesture == RangeSelectionGesture.Replace)
            {
                changed = true;
                setSelected(item, false);
            }
        }

        return changed;
    }

    public bool Apply(IReadOnlySet<T> nextHits)
    {
        if (currentHits.SetEquals(nextHits))
        {
            return false;
        }

        foreach (T item in currentHits)
        {
            if (!nextHits.Contains(item))
            {
                SetSelected(item, ResolveSelection(item, isHit: false));
            }
        }

        foreach (T item in nextHits)
        {
            if (!currentHits.Contains(item))
            {
                SetSelected(item, ResolveSelection(item, isHit: true));
            }
        }

        currentHits.Clear();
        currentHits.UnionWith(nextHits);
        return true;
    }

    public void Reset()
    {
        baselineSelection.Clear();
        currentHits.Clear();
        gesture = RangeSelectionGesture.Replace;
    }

    private bool ResolveSelection(T item, bool isHit)
    {
        return gesture switch
        {
            RangeSelectionGesture.Toggle => isHit
                ? !baselineSelection.Contains(item)
                : baselineSelection.Contains(item),
            RangeSelectionGesture.Extend => isHit || baselineSelection.Contains(item),
            _ => isHit
        };
    }

    private void SetSelected(T item, bool selected)
    {
        if (isSelected(item) != selected)
        {
            setSelected(item, selected);
        }
    }
}
