using System.Runtime.ExceptionServices;
using System.Threading;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Data;
using Fluxora.App.Models;
using Fluxora.App.Tests.ViewModels;
using Fluxora.App.ViewModels;

namespace Fluxora.App.Tests.Views;

public sealed class MainWindowModSearchUiSmokeTests
{
    [Fact]
    [Trait("Category", "UiSmoke")]
    public void ModsGrid_FilteredSearchKeepsSelectedItemAndItemsSource()
    {
        RunOnStaThread(() =>
        {
            MainWindowViewModel viewModel = MainWindowViewModelTestFactory.Create();
            SeedMods(viewModel, 250);
            viewModel.FlushPendingModSearchFilter();

            DataGrid grid = new()
            {
                DataContext = viewModel,
                CanUserAddRows = false,
                SelectionMode = DataGridSelectionMode.Extended,
                SelectionUnit = DataGridSelectionUnit.FullRow
            };
            BindingOperations.SetBinding(
                grid,
                ItemsControl.ItemsSourceProperty,
                new Binding(nameof(MainWindowViewModel.VisibleMods)));
            BindingOperations.SetBinding(
                grid,
                Selector.SelectedItemProperty,
                new Binding(nameof(MainWindowViewModel.SelectedMod))
                {
                    Mode = BindingMode.TwoWay
                });

            object initialItemsSource = grid.ItemsSource;
            ModEntry selected = viewModel.VisibleMods[123];
            grid.SelectedItem = selected;

            Assert.Same(selected, viewModel.SelectedMod);

            foreach (string prefix in QueryPrefixes("mod-000123"))
            {
                viewModel.ModSearchText = prefix;
            }

            viewModel.FlushPendingModSearchFilter();

            Assert.Same(initialItemsSource, grid.ItemsSource);
            Assert.Same(selected, grid.SelectedItem);
            Assert.Same(selected, viewModel.SelectedMod);
            Assert.Single(grid.Items);
        });
    }

    private static void RunOnStaThread(Action test)
    {
        Exception? exception = null;
        Thread thread = new(() =>
        {
            try
            {
                test();
            }
            catch (Exception caught)
            {
                exception = caught;
            }
        });
        thread.SetApartmentState(ApartmentState.STA);
        thread.IsBackground = true;
        thread.Start();
        thread.Join();

        if (exception is not null)
        {
            ExceptionDispatchInfo.Capture(exception).Throw();
        }
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
}
