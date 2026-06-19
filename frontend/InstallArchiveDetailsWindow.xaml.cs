using System.Windows;
using System.Windows.Controls;
using System.Windows.Documents;
using System.Windows.Input;
using Fluxora.App.Services;
using Fluxora.App.ViewModels;
using WpfDataObject = System.Windows.DataObject;
using WpfDragDrop = System.Windows.DragDrop;
using WpfDragDropEffects = System.Windows.DragDropEffects;
using WpfDragEventArgs = System.Windows.DragEventArgs;
using WpfMouseEventArgs = System.Windows.Input.MouseEventArgs;
using WpfPoint = System.Windows.Point;

namespace Fluxora.App;

public partial class InstallArchiveDetailsWindow : Window
{
    private const string ArchiveNodeDataFormat = "Fluxora.InstallArchiveFileNode";

    private readonly InstallArchiveDetailsViewModel viewModel;
    private readonly WindowChromeService windowChromeService;
    private WpfPoint? dragStartPoint;
    private InstallArchiveFileNode? pendingDragNode;
    private DragVisualAdorner? dragVisual;
    private AdornerLayer? dragAdornerLayer;

    public InstallArchiveDetailsWindow(InstallArchiveDetailsViewModel viewModel)
    {
        InitializeComponent();
        this.viewModel = viewModel;
        DataContext = viewModel;
        windowChromeService = new WindowChromeService(this);
        windowChromeService.Attach();
    }

    private void OnResetClick(object sender, RoutedEventArgs e)
    {
        viewModel.ResetTargets();
    }

    private void OnCloseClick(object sender, RoutedEventArgs e)
    {
        DialogResult = true;
        Close();
    }

    private void OnArchiveNodePreviewMouseLeftButtonDown(object sender, MouseButtonEventArgs e)
    {
        if (e.ChangedButton != MouseButton.Left)
        {
            return;
        }

        if (sender is TreeViewItem { DataContext: InstallArchiveFileNode node } &&
            viewModel.CanStartDrag(node))
        {
            pendingDragNode = node;
            dragStartPoint = e.GetPosition(DialogSurface);
            return;
        }

        pendingDragNode = null;
        dragStartPoint = null;
    }

    private void OnArchiveNodeMouseMove(object sender, WpfMouseEventArgs e)
    {
        if (e.LeftButton != MouseButtonState.Pressed ||
            pendingDragNode is null ||
            dragStartPoint is null ||
            !viewModel.CanStartDrag(pendingDragNode))
        {
            return;
        }

        WpfPoint currentPoint = e.GetPosition(DialogSurface);
        if (Math.Abs(currentPoint.X - dragStartPoint.Value.X) < SystemParameters.MinimumHorizontalDragDistance &&
            Math.Abs(currentPoint.Y - dragStartPoint.Value.Y) < SystemParameters.MinimumVerticalDragDistance)
        {
            return;
        }

        StartArchiveNodeDrag(pendingDragNode, currentPoint);
    }

    private void StartArchiveNodeDrag(InstallArchiveFileNode node, WpfPoint currentPoint)
    {
        EnsureDragVisual(node, currentPoint);

        WpfDataObject data = new();
        data.SetData(ArchiveNodeDataFormat, node);
        try
        {
            WpfDragDrop.DoDragDrop(ArchiveTreeView, data, WpfDragDropEffects.Move);
        }
        finally
        {
            CleanupDragState();
        }
    }

    private void OnDialogDragOver(object sender, WpfDragEventArgs e)
    {
        if (TryGetDraggedNode(e, out _))
        {
            dragVisual?.Move(e.GetPosition(DialogSurface));
        }

        e.Effects = WpfDragDropEffects.None;
        e.Handled = true;
    }

    private void OnDialogDragLeave(object sender, WpfDragEventArgs e)
    {
        WpfPoint point = e.GetPosition(DialogSurface);
        if (point.X < 0 ||
            point.Y < 0 ||
            point.X > DialogSurface.ActualWidth ||
            point.Y > DialogSurface.ActualHeight)
        {
            viewModel.ClearFolderDropHover();
        }
    }

    private void OnArchiveFolderDragEnter(object sender, WpfDragEventArgs e)
    {
        UpdateArchiveFolderDragState(sender, e);
    }

    private void OnArchiveFolderDragOver(object sender, WpfDragEventArgs e)
    {
        UpdateArchiveFolderDragState(sender, e);
    }

    private void OnArchiveFolderDragLeave(object sender, WpfDragEventArgs e)
    {
        if (sender is not FrameworkElement element ||
            element.DataContext is not InstallArchiveFileNode folder)
        {
            return;
        }

        WpfPoint point = e.GetPosition(element);
        if (point.X < 0 ||
            point.Y < 0 ||
            point.X > element.ActualWidth ||
            point.Y > element.ActualHeight)
        {
            folder.IsDragOver = false;
        }
    }

    private void OnArchiveFolderDrop(object sender, WpfDragEventArgs e)
    {
        e.Handled = true;
        try
        {
            if (TryGetFolderDropContext(sender, e, out InstallArchiveFileNode? node, out InstallArchiveFileNode? folder) &&
                node is not null &&
                folder is not null &&
                viewModel.MoveNodeToFolder(node, folder))
            {
                e.Effects = WpfDragDropEffects.Move;
                return;
            }

            e.Effects = WpfDragDropEffects.None;
        }
        finally
        {
            viewModel.ClearFolderDropHover();
            CleanupDragState();
        }
    }

    private void UpdateArchiveFolderDragState(object sender, WpfDragEventArgs e)
    {
        dragVisual?.Move(e.GetPosition(DialogSurface));

        if (TryGetFolderDropContext(sender, e, out _, out InstallArchiveFileNode? folder) &&
            folder is not null)
        {
            viewModel.SetFolderDropHover(folder);
            e.Effects = WpfDragDropEffects.Move;
        }
        else
        {
            viewModel.ClearFolderDropHover();
            e.Effects = WpfDragDropEffects.None;
        }

        e.Handled = true;
    }

    private bool TryGetFolderDropContext(
        object sender,
        WpfDragEventArgs e,
        out InstallArchiveFileNode? node,
        out InstallArchiveFileNode? folder)
    {
        node = null;
        folder = null;
        if (!TryGetDraggedNode(e, out InstallArchiveFileNode? draggedNode) ||
            draggedNode is null ||
            sender is not FrameworkElement { DataContext: InstallArchiveFileNode targetFolder } ||
            !viewModel.CanMoveNodeToFolder(draggedNode, targetFolder))
        {
            return false;
        }

        node = draggedNode;
        folder = targetFolder;
        return true;
    }

    private static bool TryGetDraggedNode(WpfDragEventArgs e, out InstallArchiveFileNode? node)
    {
        node = null;
        if (!e.Data.GetDataPresent(ArchiveNodeDataFormat))
        {
            return false;
        }

        node = e.Data.GetData(ArchiveNodeDataFormat) as InstallArchiveFileNode;
        return node is not null;
    }

    private void EnsureDragVisual(InstallArchiveFileNode node, WpfPoint currentPoint)
    {
        dragAdornerLayer ??= AdornerLayer.GetAdornerLayer(DialogSurface);
        if (dragAdornerLayer is null)
        {
            return;
        }

        dragVisual = new DragVisualAdorner(DialogSurface, "Файл архива", node.Name);
        dragAdornerLayer.Add(dragVisual);
        dragVisual.Move(currentPoint);
    }

    private void CleanupDragState()
    {
        pendingDragNode = null;
        dragStartPoint = null;
        viewModel.ClearFolderDropHover();

        if (dragAdornerLayer is not null && dragVisual is not null)
        {
            dragAdornerLayer.Remove(dragVisual);
        }

        dragVisual = null;
    }
}
