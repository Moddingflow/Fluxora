using System.Runtime.ExceptionServices;
using System.Threading;
using System.Windows.Controls;
using System.Windows.Input;
using Fluxora.App.Services;
using Fluxora.App.ViewModels;

namespace Fluxora.App.Tests.Services;

public sealed class ContextMenuGestureServiceTests
{
    [Fact]
    public void TryExecuteDeleteGesture_ExecutesDelMenuItemCommand()
    {
        RunOnStaThread(() =>
        {
            string? received = null;
            ContextMenu menu = new();
            menu.Items.Add(new MenuItem
            {
                Header = "Open",
                InputGestureText = "Enter",
                Command = new RelayCommand(() => throw new InvalidOperationException("Wrong command executed."))
            });
            menu.Items.Add(new MenuItem
            {
                Header = "Delete",
                InputGestureText = "Del",
                Command = new RelayCommand<string>(value => received = value, value => value == "build-1"),
                CommandParameter = "build-1"
            });

            bool handled = ContextMenuGestureService.TryExecuteDeleteGesture(
                menu,
                Key.Delete,
                Key.None,
                ModifierKeys.None);

            Assert.True(handled);
            Assert.Equal("build-1", received);
        });
    }

    [Fact]
    public void TryExecuteDeleteGesture_RejectsModifiedDelete()
    {
        RunOnStaThread(() =>
        {
            bool executed = false;
            ContextMenu menu = new();
            menu.Items.Add(new MenuItem
            {
                Header = "Delete",
                InputGestureText = "Del",
                Command = new RelayCommand(() => executed = true)
            });

            bool handled = ContextMenuGestureService.TryExecuteDeleteGesture(
                menu,
                Key.Delete,
                Key.None,
                ModifierKeys.Control);

            Assert.False(handled);
            Assert.False(executed);
        });
    }

    [Fact]
    public void TryExecuteDeleteGesture_SkipsDisabledDelMenuItem()
    {
        RunOnStaThread(() =>
        {
            bool executed = false;
            ContextMenu menu = new();
            menu.Items.Add(new MenuItem
            {
                Header = "Delete",
                InputGestureText = "Del",
                Command = new RelayCommand(() => executed = true, () => false)
            });

            bool handled = ContextMenuGestureService.TryExecuteDeleteGesture(
                menu,
                Key.Delete,
                Key.None,
                ModifierKeys.None);

            Assert.False(handled);
            Assert.False(executed);
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
}
