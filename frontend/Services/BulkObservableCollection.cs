using System.Collections.ObjectModel;
using System.Collections.Specialized;
using System.ComponentModel;

namespace Fluxora.App.Services;

public sealed class BulkObservableCollection<T> : ObservableCollection<T>
{
    private bool suppressNotifications;

    public void ReplaceAll(IEnumerable<T> items)
    {
        ArgumentNullException.ThrowIfNull(items);

        List<T> replacement = items as List<T> ?? items.ToList();
        if (Count == 0 && replacement.Count == 0)
        {
            return;
        }

        suppressNotifications = true;
        try
        {
            Items.Clear();
            foreach (T item in replacement)
            {
                Items.Add(item);
            }
        }
        finally
        {
            suppressNotifications = false;
        }

        OnPropertyChanged(new PropertyChangedEventArgs(nameof(Count)));
        OnPropertyChanged(new PropertyChangedEventArgs("Item[]"));
        OnCollectionChanged(new NotifyCollectionChangedEventArgs(NotifyCollectionChangedAction.Reset));
    }

    protected override void OnCollectionChanged(NotifyCollectionChangedEventArgs e)
    {
        if (!suppressNotifications)
        {
            base.OnCollectionChanged(e);
        }
    }

    protected override void OnPropertyChanged(PropertyChangedEventArgs e)
    {
        if (!suppressNotifications)
        {
            base.OnPropertyChanged(e);
        }
    }
}
