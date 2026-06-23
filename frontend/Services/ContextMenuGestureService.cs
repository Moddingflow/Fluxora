using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;

namespace Fluxora.App.Services;

public static class ContextMenuGestureService
{
    private const string DeleteGestureText = "Del";

    public static bool TryExecuteDeleteGesture(
        ItemsControl menu,
        Key key,
        Key systemKey,
        ModifierKeys modifiers)
    {
        if (!SelectionInputService.IsDeleteGesture(key, systemKey, modifiers))
        {
            return false;
        }

        MenuItem? deleteItem = FindExecutableGestureItem(menu, DeleteGestureText);
        if (deleteItem is null)
        {
            return false;
        }

        Execute(deleteItem);
        if (menu is ContextMenu contextMenu)
        {
            contextMenu.IsOpen = false;
        }

        return true;
    }

    private static MenuItem? FindExecutableGestureItem(ItemsControl menu, string inputGestureText)
    {
        foreach (object item in menu.Items)
        {
            MenuItem? match = FindExecutableGestureItem(item, inputGestureText);
            if (match is not null)
            {
                return match;
            }
        }

        return null;
    }

    private static MenuItem? FindExecutableGestureItem(object item, string inputGestureText)
    {
        if (item is not MenuItem menuItem)
        {
            return null;
        }

        if (string.Equals(menuItem.InputGestureText, inputGestureText, StringComparison.OrdinalIgnoreCase) &&
            CanExecute(menuItem))
        {
            return menuItem;
        }

        return FindExecutableGestureItem(menuItem, inputGestureText);
    }

    private static bool CanExecute(MenuItem menuItem)
    {
        if (!menuItem.IsEnabled || menuItem.Command is null)
        {
            return false;
        }

        object? parameter = menuItem.CommandParameter;
        IInputElement commandTarget = menuItem.CommandTarget ?? menuItem;
        return menuItem.Command is RoutedCommand routedCommand
            ? routedCommand.CanExecute(parameter, commandTarget)
            : menuItem.Command.CanExecute(parameter);
    }

    private static void Execute(MenuItem menuItem)
    {
        object? parameter = menuItem.CommandParameter;
        IInputElement commandTarget = menuItem.CommandTarget ?? menuItem;
        if (menuItem.Command is RoutedCommand routedCommand)
        {
            routedCommand.Execute(parameter, commandTarget);
            return;
        }

        menuItem.Command?.Execute(parameter);
    }
}
