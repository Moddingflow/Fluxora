using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Documents;
using System.Windows.Input;
using System.Windows.Media;
using Fluxora.App.Models;
using WpfButtonBase = System.Windows.Controls.Primitives.ButtonBase;
using WpfMouseEventArgs = System.Windows.Input.MouseEventArgs;
using WpfPoint = System.Windows.Point;
using WpfScrollBar = System.Windows.Controls.Primitives.ScrollBar;
using WpfTextBoxBase = System.Windows.Controls.Primitives.TextBoxBase;
using WpfThumb = System.Windows.Controls.Primitives.Thumb;

namespace Fluxora.App.Services;

public sealed class DownloadMarqueeSelectionService
{
    private const double BoundsUpdateEpsilon = 0.5;

    private readonly DataGrid downloadsGrid;
    private readonly Action activateDownloadSelectionScope;
    private readonly Action<DownloadEntry?> completeSelection;
    private readonly MarqueeSelectionTracker<DownloadEntry> selectionTracker;
    private readonly HashSet<DownloadEntry> hitBuffer = new();
    private readonly List<RowHitTarget> rowHitTargets = new();
    private WpfPoint? startPoint;
    private WpfPoint latestPoint;
    private Rect lastAppliedBounds = Rect.Empty;
    private RangeSelectionGesture activeGesture = RangeSelectionGesture.Replace;
    private bool isPointerDown;
    private bool isSelecting;
    private bool isSelectionSessionStarted;
    private bool isRenderingQueued;
    private bool rowHitTargetsInvalid = true;
    private bool hasSelectionChanges;
    private AdornerLayer? adornerLayer;
    private MarqueeSelectionAdorner? marqueeAdorner;
    private DownloadEntry? focusCandidate;

    public DownloadMarqueeSelectionService(
        DataGrid downloadsGrid,
        Action activateDownloadSelectionScope,
        Action<DownloadEntry?> completeSelection)
    {
        this.downloadsGrid = downloadsGrid;
        this.activateDownloadSelectionScope = activateDownloadSelectionScope;
        this.completeSelection = completeSelection;
        selectionTracker = new MarqueeSelectionTracker<DownloadEntry>(
            static download => download.IsSelected,
            static (download, selected) => download.IsSelected = selected);
    }

    public void Attach()
    {
        downloadsGrid.AddHandler(
            Mouse.PreviewMouseDownEvent,
            new MouseButtonEventHandler(OnPreviewMouseLeftButtonDown),
            true);
        downloadsGrid.PreviewMouseLeftButtonUp += OnPreviewMouseLeftButtonUp;
        downloadsGrid.MouseMove += OnMouseMove;
        downloadsGrid.LostMouseCapture += OnLostMouseCapture;
        downloadsGrid.SizeChanged += OnDownloadsGridSizeChanged;
        downloadsGrid.AddHandler(
            ScrollViewer.ScrollChangedEvent,
            new ScrollChangedEventHandler(OnDownloadsGridScrollChanged),
            true);
        downloadsGrid.Unloaded += OnUnloaded;
    }

    private void OnPreviewMouseLeftButtonDown(object sender, MouseButtonEventArgs e)
    {
        if (e.ChangedButton != MouseButton.Left || !CanStartSelection(e))
        {
            return;
        }

        activeGesture = SelectionInputService.ResolveGesture(Keyboard.Modifiers);
        activateDownloadSelectionScope();

        startPoint = ClampToGrid(e.GetPosition(downloadsGrid));
        latestPoint = startPoint.Value;
        lastAppliedBounds = Rect.Empty;
        isPointerDown = true;
        isSelecting = false;
        isSelectionSessionStarted = false;
        rowHitTargetsInvalid = true;
        hasSelectionChanges = false;
        focusCandidate = null;

        downloadsGrid.Focus();
        Mouse.Capture(downloadsGrid, CaptureMode.SubTree);
        e.Handled = true;
    }

    private void OnMouseMove(object sender, WpfMouseEventArgs e)
    {
        if (!isPointerDown || startPoint is null)
        {
            return;
        }

        if (e.LeftButton != MouseButtonState.Pressed)
        {
            EndSelection(commit: true);
            return;
        }

        latestPoint = ClampToGrid(e.GetPosition(downloadsGrid));
        if (!isSelecting && !ExceedsDragThreshold(startPoint.Value, latestPoint))
        {
            return;
        }

        if (!isSelecting)
        {
            isSelecting = true;
            EnsureSelectionSessionStarted();
            InvalidateRowHitTargets();
        }

        QueueRenderingUpdate();
        e.Handled = true;
    }

    private void OnPreviewMouseLeftButtonUp(object sender, MouseButtonEventArgs e)
    {
        if (e.ChangedButton != MouseButton.Left || !isPointerDown)
        {
            return;
        }

        latestPoint = ClampToGrid(e.GetPosition(downloadsGrid));
        if (isSelecting)
        {
            UpdateSelectionFrame(force: true);
        }
        else if (activeGesture == RangeSelectionGesture.Replace)
        {
            EnsureSelectionSessionStarted();
        }

        EndSelection(commit: true);
        e.Handled = true;
    }

    private void OnLostMouseCapture(object sender, WpfMouseEventArgs e)
    {
        if (isPointerDown)
        {
            EndSelection(commit: true);
        }
    }

    private void OnUnloaded(object sender, RoutedEventArgs e)
    {
        if (isPointerDown)
        {
            EndSelection(commit: false);
        }

        RemoveAdorner();
        rowHitTargets.Clear();
        hitBuffer.Clear();
    }

    private bool CanStartSelection(MouseButtonEventArgs e)
    {
        if (!downloadsGrid.IsVisible || downloadsGrid.Items.Count == 0)
        {
            return false;
        }

        DependencyObject? source = e.OriginalSource as DependencyObject;
        if (FindVisualParent<DataGridRow>(source) is not null ||
            FindVisualParent<DataGridColumnHeader>(source) is not null ||
            IsBlockedByInteractiveElement(source))
        {
            return false;
        }

        return IsInsideGrid(e.GetPosition(downloadsGrid));
    }

    private void QueueRenderingUpdate()
    {
        if (isRenderingQueued)
        {
            return;
        }

        isRenderingQueued = true;
        CompositionTarget.Rendering += OnRendering;
    }

    private void OnRendering(object? sender, EventArgs e)
    {
        CompositionTarget.Rendering -= OnRendering;
        isRenderingQueued = false;

        if (isPointerDown && isSelecting && startPoint is not null)
        {
            UpdateSelectionFrame();
        }
    }

    private void UpdateSelectionFrame(bool force = false)
    {
        if (startPoint is null)
        {
            return;
        }

        EnsureSelectionSessionStarted();
        Rect selectionBounds = CreateSelectionBounds(startPoint.Value, latestPoint);
        EnsureAdorner();
        marqueeAdorner?.Update(selectionBounds, force);
        if (force || IsBoundsMeaningfullyDifferent(selectionBounds, lastAppliedBounds))
        {
            ApplySelectionBounds(selectionBounds);
            lastAppliedBounds = selectionBounds;
        }
    }

    private void ApplySelectionBounds(Rect selectionBounds)
    {
        RefreshRowHitTargetsIfNeeded();
        hitBuffer.Clear();

        foreach (RowHitTarget target in rowHitTargets)
        {
            if (selectionBounds.IntersectsWith(target.Bounds))
            {
                hitBuffer.Add(target.Download);
            }
        }

        hasSelectionChanges |= selectionTracker.Apply(hitBuffer);
        focusCandidate = ResolveFocusCandidate(hitBuffer);
    }

    private DownloadEntry? ResolveFocusCandidate(IReadOnlySet<DownloadEntry> hits)
    {
        if (hits.Count == 0 || startPoint is null)
        {
            return null;
        }

        bool draggingDown = latestPoint.Y >= startPoint.Value.Y;
        int bestIndex = draggingDown ? int.MinValue : int.MaxValue;
        DownloadEntry? bestDownload = null;
        foreach (RowHitTarget target in rowHitTargets)
        {
            if (!hits.Contains(target.Download) || !target.Download.IsSelected)
            {
                continue;
            }

            if ((draggingDown && target.Index > bestIndex) ||
                (!draggingDown && target.Index < bestIndex))
            {
                bestIndex = target.Index;
                bestDownload = target.Download;
            }
        }

        return bestDownload;
    }

    private void EndSelection(bool commit)
    {
        bool shouldComplete = commit && (hasSelectionChanges || isSelecting);
        DownloadEntry? completedFocus = focusCandidate is { IsSelected: true } ? focusCandidate : null;

        isPointerDown = false;
        isSelecting = false;
        isSelectionSessionStarted = false;
        startPoint = null;
        lastAppliedBounds = Rect.Empty;
        focusCandidate = null;
        hasSelectionChanges = false;
        rowHitTargetsInvalid = true;
        CancelRenderingUpdate();
        RemoveAdorner();
        selectionTracker.Reset();
        hitBuffer.Clear();
        rowHitTargets.Clear();

        if (Mouse.Captured == downloadsGrid)
        {
            Mouse.Capture(null);
        }

        if (shouldComplete)
        {
            completeSelection(completedFocus);
        }
    }

    private void EnsureSelectionSessionStarted()
    {
        if (isSelectionSessionStarted)
        {
            return;
        }

        isSelectionSessionStarted = true;
        hasSelectionChanges |= selectionTracker.Begin(downloadsGrid.Items.OfType<DownloadEntry>(), activeGesture);
    }

    private void OnDownloadsGridSizeChanged(object sender, SizeChangedEventArgs e)
    {
        if (isPointerDown)
        {
            InvalidateRowHitTargets();
        }
    }

    private void OnDownloadsGridScrollChanged(object sender, ScrollChangedEventArgs e)
    {
        if (isPointerDown)
        {
            InvalidateRowHitTargets();
        }
    }

    private void InvalidateRowHitTargets()
    {
        rowHitTargetsInvalid = true;
        lastAppliedBounds = Rect.Empty;
    }

    private void RefreshRowHitTargetsIfNeeded()
    {
        if (!rowHitTargetsInvalid)
        {
            return;
        }

        rowHitTargets.Clear();
        DependencyObject searchRoot = FindVisualChild<DataGridRowsPresenter>(downloadsGrid) is { } rowsPresenter
            ? rowsPresenter
            : downloadsGrid;
        foreach (DataGridRow row in FindVisualRows(searchRoot))
        {
            if (row.Item is not DownloadEntry download ||
                row.Visibility != Visibility.Visible ||
                row.ActualHeight <= 0.5 ||
                row.ActualWidth <= 0.5)
            {
                continue;
            }

            int rowIndex = downloadsGrid.ItemContainerGenerator.IndexFromContainer(row);
            if (rowIndex < 0)
            {
                continue;
            }

            WpfPoint rowPoint = row.TranslatePoint(new WpfPoint(0, 0), downloadsGrid);
            Rect rowBounds = new(rowPoint.X, rowPoint.Y, row.ActualWidth, row.ActualHeight);
            rowHitTargets.Add(new RowHitTarget(rowIndex, download, rowBounds));
        }

        rowHitTargets.Sort(static (left, right) => left.Index.CompareTo(right.Index));
        rowHitTargetsInvalid = false;
    }

    private void CancelRenderingUpdate()
    {
        if (!isRenderingQueued)
        {
            return;
        }

        CompositionTarget.Rendering -= OnRendering;
        isRenderingQueued = false;
    }

    private void EnsureAdorner()
    {
        if (marqueeAdorner is not null)
        {
            return;
        }

        adornerLayer ??= AdornerLayer.GetAdornerLayer(downloadsGrid);
        if (adornerLayer is null)
        {
            return;
        }

        marqueeAdorner = new MarqueeSelectionAdorner(downloadsGrid);
        adornerLayer.Add(marqueeAdorner);
    }

    private void RemoveAdorner()
    {
        if (adornerLayer is not null && marqueeAdorner is not null)
        {
            adornerLayer.Remove(marqueeAdorner);
        }

        marqueeAdorner = null;
    }

    private static bool IsBoundsMeaningfullyDifferent(Rect first, Rect second)
    {
        if (first.IsEmpty || second.IsEmpty)
        {
            return first.IsEmpty != second.IsEmpty;
        }

        return Math.Abs(first.X - second.X) > BoundsUpdateEpsilon ||
            Math.Abs(first.Y - second.Y) > BoundsUpdateEpsilon ||
            Math.Abs(first.Width - second.Width) > BoundsUpdateEpsilon ||
            Math.Abs(first.Height - second.Height) > BoundsUpdateEpsilon;
    }

    private Rect CreateSelectionBounds(WpfPoint first, WpfPoint second)
    {
        double left = Math.Min(first.X, second.X);
        double top = Math.Min(first.Y, second.Y);
        double right = Math.Max(first.X, second.X);
        double bottom = Math.Max(first.Y, second.Y);
        return new Rect(
            left,
            top,
            Math.Max(1, right - left),
            Math.Max(1, bottom - top));
    }

    private WpfPoint ClampToGrid(WpfPoint point)
    {
        double width = Math.Max(0, downloadsGrid.ActualWidth);
        double height = Math.Max(0, downloadsGrid.ActualHeight);
        return new WpfPoint(
            Math.Clamp(point.X, 0, width),
            Math.Clamp(point.Y, 0, height));
    }

    private bool IsInsideGrid(WpfPoint point)
    {
        return point.X >= 0 &&
            point.Y >= 0 &&
            point.X <= downloadsGrid.ActualWidth &&
            point.Y <= downloadsGrid.ActualHeight;
    }

    private static bool ExceedsDragThreshold(WpfPoint first, WpfPoint second)
    {
        return Math.Abs(second.X - first.X) >= SystemParameters.MinimumHorizontalDragDistance ||
            Math.Abs(second.Y - first.Y) >= SystemParameters.MinimumVerticalDragDistance;
    }

    private static bool IsBlockedByInteractiveElement(DependencyObject? current)
    {
        while (current is not null)
        {
            if (current is WpfButtonBase or WpfTextBoxBase or WpfScrollBar or WpfThumb)
            {
                return true;
            }

            if (current is DataGrid)
            {
                return false;
            }

            current = VisualTreeHelper.GetParent(current);
        }

        return false;
    }

    private static T? FindVisualParent<T>(DependencyObject? current) where T : DependencyObject
    {
        while (current is not null)
        {
            if (current is T match)
            {
                return match;
            }

            current = VisualTreeHelper.GetParent(current);
        }

        return null;
    }

    private static T? FindVisualChild<T>(DependencyObject current) where T : DependencyObject
    {
        for (int index = 0; index < VisualTreeHelper.GetChildrenCount(current); ++index)
        {
            DependencyObject child = VisualTreeHelper.GetChild(current, index);
            if (child is T match)
            {
                return match;
            }

            T? descendant = FindVisualChild<T>(child);
            if (descendant is not null)
            {
                return descendant;
            }
        }

        return null;
    }

    private static IEnumerable<DataGridRow> FindVisualRows(DependencyObject current)
    {
        for (int index = 0; index < VisualTreeHelper.GetChildrenCount(current); ++index)
        {
            DependencyObject child = VisualTreeHelper.GetChild(current, index);
            if (child is DataGridRow row)
            {
                yield return row;
                continue;
            }

            foreach (DataGridRow descendant in FindVisualRows(child))
            {
                yield return descendant;
            }
        }
    }

    private readonly struct RowHitTarget
    {
        public RowHitTarget(int index, DownloadEntry download, Rect bounds)
        {
            Index = index;
            Download = download;
            Bounds = bounds;
        }

        public int Index { get; }
        public DownloadEntry Download { get; }
        public Rect Bounds { get; }
    }
}
