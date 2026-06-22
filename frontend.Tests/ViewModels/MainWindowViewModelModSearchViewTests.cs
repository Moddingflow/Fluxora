using System.Collections.ObjectModel;
using Fluxora.App.Models;
using Fluxora.App.ViewModels;

namespace Fluxora.App.Tests.ViewModels;

public sealed class MainWindowViewModelModSearchViewTests
{
    [Fact]
    public void ModSearchText_DebouncesFilteringAndKeepsVisibleModsCollectionStable()
    {
        MainWindowViewModel viewModel = MainWindowViewModelTestFactory.Create();
        SeedMods(viewModel, 10_000);
        viewModel.FlushPendingModSearchFilter();
        ObservableCollection<ModEntry> itemsSource = viewModel.VisibleMods;
        int visibleModsPropertyChanges = 0;
        viewModel.PropertyChanged += (_, args) =>
        {
            if (string.Equals(args.PropertyName, nameof(MainWindowViewModel.VisibleMods), StringComparison.Ordinal))
            {
                visibleModsPropertyChanges++;
            }
        };

        string query = "mod-009999";
        foreach (string prefix in QueryPrefixes(query))
        {
            viewModel.ModSearchText = prefix;

            Assert.Same(itemsSource, viewModel.VisibleMods);
        }

        Assert.InRange(
            MainWindowViewModel.ModSearchDebounceInterval,
            TimeSpan.FromMilliseconds(100),
            TimeSpan.FromMilliseconds(200));

        viewModel.FlushPendingModSearchFilter();

        Assert.Same(itemsSource, viewModel.VisibleMods);
        Assert.Equal(0, visibleModsPropertyChanges);
        ModEntry visible = Assert.Single(VisibleRows(viewModel));
        Assert.Equal("mod-009999", visible.Name);
    }

    [Fact]
    public void ModSearchText_AppliedAfterDebounceKeepsMatchingSelection()
    {
        MainWindowViewModel viewModel = MainWindowViewModelTestFactory.Create();
        SeedMods(viewModel, 10_000);
        viewModel.FlushPendingModSearchFilter();
        ModEntry selected = viewModel.VisibleMods[5_678];
        viewModel.SelectedMod = selected;

        string query = "mod-005678";
        foreach (string prefix in QueryPrefixes(query))
        {
            viewModel.ModSearchText = prefix;
        }

        viewModel.FlushPendingModSearchFilter();

        Assert.Same(selected, viewModel.SelectedMod);
        Assert.True(selected.IsSelected);
        Assert.Same(selected, Assert.Single(VisibleRows(viewModel)));
    }

    private static void SeedMods(MainWindowViewModel viewModel, int count)
    {
        for (int index = 0; index < count; index++)
        {
            ModEntry mod = Mod(index);
            viewModel.Mods.Add(mod);
            viewModel.VisibleMods.Add(mod);
        }
    }

    private static ModEntry Mod(int index)
    {
        string id = $"mod-{index:000000}";
        return new ModEntry
        {
            Id = id,
            OrderId = id,
            Name = id,
            Version = "1.0",
            FileCount = 1,
            IsEnabled = true
        };
    }

    private static IEnumerable<string> QueryPrefixes(string query)
    {
        for (int length = 1; length <= query.Length; length++)
        {
            yield return query[..length];
        }
    }

    private static ModEntry[] VisibleRows(MainWindowViewModel viewModel)
    {
        return viewModel.VisibleModsView.Cast<ModEntry>().ToArray();
    }
}
