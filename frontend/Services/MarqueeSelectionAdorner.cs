using System.Windows;
using System.Windows.Documents;
using System.Windows.Media;
using WpfApplication = System.Windows.Application;
using WpfBrush = System.Windows.Media.Brush;
using WpfPen = System.Windows.Media.Pen;
using WpfSystemColors = System.Windows.SystemColors;

namespace Fluxora.App.Services;

internal sealed class MarqueeSelectionAdorner : Adorner
{
    private const double BoundsEpsilon = 0.25;

    private Rect bounds = Rect.Empty;

    public MarqueeSelectionAdorner(UIElement adornedElement)
        : base(adornedElement)
    {
        IsHitTestVisible = false;
        SnapsToDevicePixels = true;
        UseLayoutRounding = true;
    }

    public bool Update(Rect selectionBounds, bool force = false)
    {
        if (!force && AreClose(bounds, selectionBounds))
        {
            return false;
        }

        bounds = selectionBounds;
        InvalidateVisual();
        return true;
    }

    protected override void OnRender(DrawingContext drawingContext)
    {
        base.OnRender(drawingContext);
        if (bounds.IsEmpty || bounds.Width < 1 || bounds.Height < 1)
        {
            return;
        }

        drawingContext.DrawRectangle(
            ThemeBrush("SelectionBrush", WpfSystemColors.HighlightBrush, 0.18),
            new WpfPen(ThemeBrush("AccentHoverBrush", WpfSystemColors.HighlightBrush, 0.78), 1.25),
            bounds);
    }

    private static bool AreClose(Rect first, Rect second)
    {
        if (first.IsEmpty || second.IsEmpty)
        {
            return first.IsEmpty == second.IsEmpty;
        }

        return Math.Abs(first.X - second.X) <= BoundsEpsilon &&
            Math.Abs(first.Y - second.Y) <= BoundsEpsilon &&
            Math.Abs(first.Width - second.Width) <= BoundsEpsilon &&
            Math.Abs(first.Height - second.Height) <= BoundsEpsilon;
    }

    private static WpfBrush ThemeBrush(string resourceKey, WpfBrush fallback, double opacity)
    {
        WpfBrush brush = WpfApplication.Current?.TryFindResource(resourceKey) as WpfBrush ?? fallback;
        WpfBrush renderBrush = brush.CloneCurrentValue();
        renderBrush.Opacity = opacity;
        if (renderBrush.CanFreeze)
        {
            renderBrush.Freeze();
        }

        return renderBrush;
    }
}
