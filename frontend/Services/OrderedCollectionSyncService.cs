using System.Collections.ObjectModel;

namespace Fluxora.App.Services;

public static class OrderedCollectionSyncService
{
    private const int BatchResetItemThreshold = 1_024;
    private const int BatchResetChangeThreshold = 128;

    public static void Sync<T>(
        ObservableCollection<T> target,
        IReadOnlyList<T> source,
        Func<T, string> keySelector,
        Func<T, T, bool> areEquivalent,
        StringComparer? keyComparer = null)
    {
        keyComparer ??= StringComparer.OrdinalIgnoreCase;

        if (IsAlreadySynced(target, source, keySelector, areEquivalent, keyComparer))
        {
            return;
        }

        SyncPlan<T> plan = BuildSyncPlan(target, source, keySelector, areEquivalent, keyComparer);
        if (ShouldUseBatchReset(target, plan))
        {
            ((BulkObservableCollection<T>)target).ReplaceAll(plan.Items);
            return;
        }

        HashSet<string> sourceKeys = new(keyComparer);
        foreach (T item in source)
        {
            sourceKeys.Add(keySelector(item));
        }

        for (int index = target.Count - 1; index >= 0; --index)
        {
            if (!sourceKeys.Contains(keySelector(target[index])))
            {
                target.RemoveAt(index);
            }
        }

        Dictionary<string, int> targetIndexes = BuildTargetIndexes(target, keySelector, keyComparer);
        for (int index = 0; index < source.Count; ++index)
        {
            T incoming = source[index];
            string key = keySelector(incoming);
            T targetItem = plan.Items[index];
            if (index < target.Count && keyComparer.Equals(keySelector(target[index]), key))
            {
                if (!ReferenceEquals(target[index], targetItem))
                {
                    target[index] = targetItem;
                }

                targetIndexes[key] = index;
                continue;
            }

            if (!targetIndexes.TryGetValue(key, out int existingIndex))
            {
                if (index == target.Count)
                {
                    target.Add(targetItem);
                }
                else
                {
                    target.Insert(index, targetItem);
                    ShiftIndexesAfterInsert(targetIndexes, index);
                }

                targetIndexes[key] = index;
                continue;
            }

            target.Move(existingIndex, index);
            ShiftIndexesAfterMove(targetIndexes, existingIndex, index);

            if (!ReferenceEquals(target[index], targetItem))
            {
                target[index] = targetItem;
            }

            targetIndexes[key] = index;
        }
    }

    private static bool IsAlreadySynced<T>(
        ObservableCollection<T> target,
        IReadOnlyList<T> source,
        Func<T, string> keySelector,
        Func<T, T, bool> areEquivalent,
        StringComparer keyComparer)
    {
        if (target.Count != source.Count)
        {
            return false;
        }

        for (int index = 0; index < target.Count; ++index)
        {
            if (!keyComparer.Equals(keySelector(target[index]), keySelector(source[index])) ||
                !areEquivalent(target[index], source[index]))
            {
                return false;
            }
        }

        return true;
    }

    private static SyncPlan<T> BuildSyncPlan<T>(
        ObservableCollection<T> target,
        IReadOnlyList<T> source,
        Func<T, string> keySelector,
        Func<T, T, bool> areEquivalent,
        StringComparer keyComparer)
    {
        Dictionary<string, ExistingItem<T>> existingItems = new(keyComparer);
        List<int> retainedIndexes = new(source.Count);
        for (int index = 0; index < target.Count; ++index)
        {
            string key = keySelector(target[index]);
            existingItems[key] = new ExistingItem<T>(target[index], index);
        }

        List<T> items = new(source.Count);
        int replacementCount = 0;
        foreach (T incoming in source)
        {
            string key = keySelector(incoming);
            if (!existingItems.TryGetValue(key, out ExistingItem<T> existing))
            {
                items.Add(incoming);
                continue;
            }

            retainedIndexes.Add(existing.Index);
            if (areEquivalent(existing.Item, incoming))
            {
                items.Add(existing.Item);
            }
            else
            {
                items.Add(incoming);
                ++replacementCount;
            }
        }

        int retainedCount = retainedIndexes.Count;
        int additionCount = source.Count - retainedCount;
        int removalCount = target.Count - retainedCount;
        int moveCount = retainedCount - CountLongestIncreasingSubsequence(retainedIndexes);
        int changeCount = additionCount + removalCount + moveCount + replacementCount;

        return new SyncPlan<T>(items, changeCount, Math.Max(target.Count, source.Count));
    }

    private static bool ShouldUseBatchReset<T>(
        ObservableCollection<T> target,
        SyncPlan<T> plan)
    {
        if (target is not BulkObservableCollection<T>)
        {
            return false;
        }

        if (plan.MaxItemCount < BatchResetItemThreshold)
        {
            return false;
        }

        return plan.ChangeCount >= BatchResetChangeThreshold;
    }

    private static Dictionary<string, int> BuildTargetIndexes<T>(
        ObservableCollection<T> target,
        Func<T, string> keySelector,
        StringComparer keyComparer)
    {
        Dictionary<string, int> indexes = new(keyComparer);
        for (int index = 0; index < target.Count; ++index)
        {
            indexes[keySelector(target[index])] = index;
        }

        return indexes;
    }

    private static int CountLongestIncreasingSubsequence(IReadOnlyList<int> values)
    {
        if (values.Count == 0)
        {
            return 0;
        }

        List<int> tails = new(values.Count);
        foreach (int value in values)
        {
            int index = tails.BinarySearch(value);
            if (index < 0)
            {
                index = ~index;
            }

            if (index == tails.Count)
            {
                tails.Add(value);
            }
            else
            {
                tails[index] = value;
            }
        }

        return tails.Count;
    }

    private static void ShiftIndexesAfterInsert(
        Dictionary<string, int> targetIndexes,
        int insertIndex)
    {
        foreach (string key in KeysWhere(targetIndexes, index => index >= insertIndex))
        {
            ++targetIndexes[key];
        }
    }

    private static void ShiftIndexesAfterMove(
        Dictionary<string, int> targetIndexes,
        int oldIndex,
        int newIndex)
    {
        if (oldIndex == newIndex)
        {
            return;
        }

        if (oldIndex > newIndex)
        {
            foreach (string key in KeysWhere(targetIndexes, index => index >= newIndex && index < oldIndex))
            {
                ++targetIndexes[key];
            }

            return;
        }

        foreach (string key in KeysWhere(targetIndexes, index => index > oldIndex && index <= newIndex))
        {
            --targetIndexes[key];
        }
    }

    private static List<string> KeysWhere(
        Dictionary<string, int> targetIndexes,
        Func<int, bool> predicate)
    {
        List<string> keys = [];
        foreach (KeyValuePair<string, int> item in targetIndexes)
        {
            if (predicate(item.Value))
            {
                keys.Add(item.Key);
            }
        }

        return keys;
    }

    private readonly record struct ExistingItem<T>(T Item, int Index);

    private sealed record SyncPlan<T>(List<T> Items, int ChangeCount, int MaxItemCount);
}
