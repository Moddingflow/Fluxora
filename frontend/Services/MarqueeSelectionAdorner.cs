using System.Windows;
using System.Windows.Documents;
using System.Windows.Media;
using WpfBrush = System.Windows.Media.Brush;
using WpfColor = System.Windows.Media.Color;
using WpfPen = System.Windows.Media.Pen;

namespace Fluxora.App.Services;

internal sealed class MarqueeSelectionAdorner : Adorner
{
    private static readonly WpfBrush FillBrush = CreateFrozenBrush(WpfColor.FromArgb(42, 77, 141, 247));
    private static readonly WpfPen StrokePen = CreateFrozenPen(WpfColor.FromArgb(190, 168, 202, 255), 1.25);
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

        drawingContext.DrawRectangle(FillBrush, StrokePen, bounds);
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

    private static WpfBrush CreateFrozenBrush(WpfColor color)
    {
        SolidColorBrush brush = new(color);
        brush.Freeze();
        return brush;
    }

    private static WpfPen CreateFrozenPen(WpfColor color, double thickness)
    {
        WpfPen pen = new(CreateFrozenBrush(color), thickness);
        pen.Freeze();
        return pen;
    }
}
