using System.Windows;
using System.Windows.Input;
using Fluxora.App.ViewModels;

namespace Fluxora.App.Views;

public partial class ProfileManagerWindow : Window
{
    public ProfileManagerWindow(MainWindowViewModel viewModel)
    {
        ArgumentNullException.ThrowIfNull(viewModel);

        InitializeComponent();
        DataContext = viewModel;
    }

    private void OnDragMove(object sender, MouseButtonEventArgs e)
    {
        if (e.ChangedButton != MouseButton.Left)
        {
            return;
        }

        try
        {
            DragMove();
        }
        catch (InvalidOperationException)
        {
        }
    }

    private void OnCloseClick(object sender, RoutedEventArgs e)
    {
        Close();
    }
}
