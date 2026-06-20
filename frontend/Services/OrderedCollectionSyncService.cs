using System.Collections.ObjectModel;

namespace Fluxora.App.Services;

public static class OrderedCollectionSyncService
{
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
            if (index < target.Count && keyComparer.Equals(keySelector(target[index]), key))
            {
                if (!areEquivalent(target[index], incoming))
                {
                    target[index] = incoming;
                }

                targetIndexes[key] = index;
                continue;
            }

            if (!targetIndexes.TryGetValue(key, out int existingIndex))
            {
                if (index == target.Count)
                {
                    target.Add(incoming);
                }
                else
                {
                    target.Insert(index, incoming);
                    RefreshTargetIndexes(target, keySelector, targetIndexes, index + 1);
                }

                targetIndexes[key] = index;
                continue;
            }

            target.Move(existingIndex, index);
            RefreshTargetIndexes(target, keySelector, targetIndexes, Math.Min(existingIndex, index));

            if (!areEquivalent(target[index], incoming))
            {
                target[index] = incoming;
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

    private static void RefreshTargetIndexes<T>(
        ObservableCollection<T> target,
        Func<T, string> keySelector,
        Dictionary<string, int> targetIndexes,
        int startIndex)
    {
        for (int index = Math.Max(0, startIndex); index < target.Count; ++index)
        {
            targetIndexes[keySelector(target[index])] = index;
        }
    }
}
