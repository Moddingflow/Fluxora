using Fluxora.App.ViewModels;
using Fluxora.App.Views;

namespace Fluxora.App.Services;

public sealed class ProfileManagerDialogService : IProfileManagerDialogService
{
    public void Show(MainWindowViewModel viewModel)
    {
        ProfileManagerWindow dialog = new(viewModel)
        {
            Owner = System.Windows.Application.Current?.MainWindow
        };

        dialog.ShowDialog();
    }
}
