using System.Diagnostics;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Documents;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Media3D;
using WpfButtonBase = System.Windows.Controls.Primitives.ButtonBase;
using WpfComboBox = System.Windows.Controls.ComboBox;
using WpfCursor = System.Windows.Input.Cursor;
using WpfCursors = System.Windows.Input.Cursors;
using WpfKeyEventArgs = System.Windows.Input.KeyEventArgs;
using WpfMouseEventArgs = System.Windows.Input.MouseEventArgs;
using WpfPoint = System.Windows.Point;
using WpfScrollBar = System.Windows.Controls.Primitives.ScrollBar;
using WpfTextBoxBase = System.Windows.Controls.Primitives.TextBoxBase;

namespace Fluxora.App.Services;

public static class MiddleClickAutoScrollService
{
    private const double OffsetEpsilon = 0.01;

    private static bool areClassHandlersRegistered;
    private static bool isAttached;
    private static bool isStopping;
    private static AutoScrollSession? activeSession;
    private static WpfCursor? previousOverrideCursor;

    public static readonly DependencyProperty IsEnabledProperty =
        DependencyProperty.RegisterAttached(
            "IsEnabled",
            typeof(bool),
            typeof(MiddleClickAutoScrollService),
            new FrameworkPropertyMetadata(true, FrameworkPropertyMetadataOptions.Inherits));

    public static void SetIsEnabled(DependencyObject element, bool value)
    {
        element.SetValue(IsEnabledProperty, value);
    }

    public static bool GetIsEnabled(DependencyObject element)
    {
        return (bool)element.GetValue(IsEnabledProperty);
    }

    public static void Attach()
    {
        if (!areClassHandlersRegistered)
        {
            EventManager.RegisterClassHandler(
                typeof(ScrollViewer),
                Mouse.PreviewMouseDownEvent,
                new MouseButtonEventHandler(OnScrollViewerPreviewMouseDown),
                false);
            EventManager.RegisterClassHandler(
                typeof(Window),
                Mouse.PreviewMouseDownEvent,
                new MouseButtonEventHandler(OnWindowPreviewMouseDown),
                true);
            areClassHandlersRegistered = true;
        }

        if (isAttached)
        {
            return;
        }

        InputManager.Current.PreProcessInput += OnPreProcessInput;
        isAttached = true;
    }

    public static void Detach()
    {
        if (!isAttached)
        {
            return;
        }

        StopActiveSession();
        InputManager.Current.PreProcessInput -= OnPreProcessInput;
        isAttached = false;
    }

    private static void OnWindowPreviewMouseDown(object sender, MouseButtonEventArgs e)
    {
        if (!isAttached || activeSession is null)
        {
            return;
        }

        StopActiveSession();
        e.Handled = true;
    }

    private static void OnScrollViewerPreviewMouseDown(object sender, MouseButtonEventArgs e)
    {
        if (!isAttached || activeSession is not null)
        {
            return;
        }

        if (e.ChangedButton != MouseButton.Middle ||
            e.ButtonState != MouseButtonState.Pressed)
        {
            return;
        }

        if (TryStartSession(e.OriginalSource as DependencyObject))
        {
            e.Handled = true;
        }
    }

    private static void OnPreProcessInput(object sender, PreProcessInputEventArgs e)
    {
        if (activeSession is null)
        {
            return;
        }

        if (e.StagingItem.Input is WpfKeyEventArgs keyEventArgs &&
            keyEventArgs.RoutedEvent == Keyboard.PreviewKeyDownEvent &&
            keyEventArgs.Key == Key.Escape)
        {
            StopActiveSession();
            keyEventArgs.Handled = true;
            return;
        }

        if (e.StagingItem.Input is MouseWheelEventArgs wheelEventArgs &&
            (wheelEventArgs.RoutedEvent == Mouse.PreviewMouseWheelEvent ||
             wheelEventArgs.RoutedEvent == Mouse.MouseWheelEvent))
        {
            wheelEventArgs.Handled = true;
            return;
        }

        if (e.StagingItem.Input is MouseButtonEventArgs buttonEventArgs &&
            buttonEventArgs.RoutedEvent == Mouse.PreviewMouseUpEvent &&
            buttonEventArgs.ChangedButton == MouseButton.Middle)
        {
            buttonEventArgs.Handled = true;
        }
    }

    private static bool TryStartSession(DependencyObject? source)
    {
        ScrollViewer? scrollViewer = FindScrollableScrollViewer(source);
        if (scrollViewer is null)
        {
            return false;
        }

        if (IsBlockedStartSource(source, scrollViewer))
        {
            return false;
        }

        Window? root = Window.GetWindow(scrollViewer);
        if (root is null || !root.IsVisible)
        {
            return false;
        }

        WpfPoint origin = Mouse.GetPosition(root);
        previousOverrideCursor = Mouse.OverrideCursor;

        AutoScrollSession session = new(root, scrollViewer, origin, Stopwatch.GetTimestamp());
        activeSession = session;

        root.Deactivated += OnRootDeactivated;
        root.Closed += OnRootClosed;
        root.LostMouseCapture += OnRootLostMouseCapture;
        scrollViewer.Unloaded += OnScrollViewerUnloaded;

        if (!Mouse.Capture(root, CaptureMode.SubTree))
        {
            StopActiveSession();
            return false;
        }

        Mouse.OverrideCursor = WpfCursors.ScrollNS;
        CompositionTarget.Rendering += OnRendering;
        return true;
    }

    private static void StopActiveSession()
    {
        AutoScrollSession? session = activeSession;
        if (session is null || isStopping)
        {
            return;
        }

        isStopping = true;
        activeSession = null;

        try
        {
            CompositionTarget.Rendering -= OnRendering;
            session.Root.Deactivated -= OnRootDeactivated;
            session.Root.Closed -= OnRootClosed;
            session.Root.LostMouseCapture -= OnRootLostMouseCapture;
            session.ScrollViewer.Unloaded -= OnScrollViewerUnloaded;

            if (Mouse.Captured == session.Root)
            {
                Mouse.Capture(null);
            }

            Mouse.OverrideCursor = previousOverrideCursor;
            previousOverrideCursor = null;
        }
        finally
        {
            isStopping = false;
        }
    }

    private static void OnRendering(object? sender, EventArgs e)
    {
        AutoScrollSession? session = activeSession;
        if (session is null)
        {
            return;
        }

        ScrollViewer scrollViewer = session.ScrollViewer;
        if (!CanAutoScroll(scrollViewer))
        {
            StopActiveSession();
            return;
        }

        long now = Stopwatch.GetTimestamp();
        TimeSpan elapsed = Stopwatch.GetElapsedTime(session.LastFrameTimestamp, now);
        session.LastFrameTimestamp = now;

        double pointerOffset = Mouse.GetPosition(session.Root).Y - session.Origin.Y;
        double deltaPixels = MiddleClickAutoScrollCalculator.CalculateDelta(pointerOffset, elapsed);
        if (Math.Abs(deltaPixels) < OffsetEpsilon)
        {
            return;
        }

        double offsetScale = GetVerticalOffsetScale(scrollViewer);
        double requestedOffset = scrollViewer.VerticalOffset + (deltaPixels * offsetScale);
        double clampedOffset = Math.Clamp(requestedOffset, 0, scrollViewer.ScrollableHeight);

        if (Math.Abs(clampedOffset - scrollViewer.VerticalOffset) >= OffsetEpsilon)
        {
            scrollViewer.ScrollToVerticalOffset(clampedOffset);
        }
    }

    private static ScrollViewer? FindScrollableScrollViewer(DependencyObject? source)
    {
        DependencyObject? current = source;
        while (current is not null)
        {
            if (current is ScrollViewer ancestorScrollViewer && CanAutoScroll(ancestorScrollViewer))
            {
                return ancestorScrollViewer;
            }

            current = GetParent(current);
        }

        current = source;
        while (current is not null and not Window)
        {
            if (FindScrollableDescendant(current) is { } descendantScrollViewer)
            {
                return descendantScrollViewer;
            }

            current = GetParent(current);
        }

        return null;
    }

    private static ScrollViewer? FindScrollableDescendant(DependencyObject source)
    {
        if (source is ScrollViewer scrollViewer && CanAutoScroll(scrollViewer))
        {
            return scrollViewer;
        }

        if (source is not Visual and not Visual3D)
        {
            return null;
        }

        int childCount = VisualTreeHelper.GetChildrenCount(source);
        for (int index = 0; index < childCount; index++)
        {
            DependencyObject child = VisualTreeHelper.GetChild(source, index);
            if (FindScrollableDescendant(child) is { } descendantScrollViewer)
            {
                return descendantScrollViewer;
            }
        }

        return null;
    }

    private static bool CanAutoScroll(ScrollViewer scrollViewer)
    {
        return scrollViewer.IsVisible &&
            scrollViewer.IsEnabled &&
            scrollViewer.VerticalScrollBarVisibility != ScrollBarVisibility.Disabled &&
            scrollViewer.ScrollableHeight > 0 &&
            double.IsFinite(scrollViewer.ScrollableHeight);
    }

    private static double GetVerticalOffsetScale(ScrollViewer scrollViewer)
    {
        if (scrollViewer.ActualHeight <= 0 ||
            scrollViewer.ViewportHeight <= 0 ||
            !double.IsFinite(scrollViewer.ActualHeight) ||
            !double.IsFinite(scrollViewer.ViewportHeight))
        {
            return 1;
        }

        return Math.Clamp(scrollViewer.ViewportHeight / scrollViewer.ActualHeight, 0.02, 1);
    }

    private static bool IsBlockedStartSource(DependencyObject? source, ScrollViewer scrollViewer)
    {
        if (source is null || !GetIsEnabled(source))
        {
            return true;
        }

        DependencyObject? current = source;
        while (current is not null)
        {
            if (current is WpfButtonBase or
                WpfTextBoxBase or
                PasswordBox or
                WpfComboBox or
                Slider or
                WpfScrollBar or
                Thumb or
                Hyperlink)
            {
                return true;
            }

            if (ReferenceEquals(current, scrollViewer))
            {
                return false;
            }

            current = GetParent(current);
        }

        return false;
    }

    private static DependencyObject? GetParent(DependencyObject source)
    {
        DependencyObject? visualParent = source is Visual or Visual3D
            ? VisualTreeHelper.GetParent(source)
            : null;

        return visualParent ?? LogicalTreeHelper.GetParent(source);
    }

    private static void OnRootDeactivated(object? sender, EventArgs e)
    {
        StopActiveSession();
    }

    private static void OnRootClosed(object? sender, EventArgs e)
    {
        StopActiveSession();
    }

    private static void OnRootLostMouseCapture(object sender, WpfMouseEventArgs e)
    {
        if (!isStopping)
        {
            StopActiveSession();
        }
    }

    private static void OnScrollViewerUnloaded(object sender, RoutedEventArgs e)
    {
        StopActiveSession();
    }

    private sealed class AutoScrollSession
    {
        public AutoScrollSession(Window root, ScrollViewer scrollViewer, WpfPoint origin, long lastFrameTimestamp)
        {
            Root = root;
            ScrollViewer = scrollViewer;
            Origin = origin;
            LastFrameTimestamp = lastFrameTimestamp;
        }

        public Window Root { get; }
        public ScrollViewer ScrollViewer { get; }
        public WpfPoint Origin { get; }
        public long LastFrameTimestamp { get; set; }
    }
}
