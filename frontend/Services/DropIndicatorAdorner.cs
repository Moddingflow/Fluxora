using System.Globalization;
using System.Windows;
using System.Windows.Documents;
using System.Windows.Media;
using WpfApplication = System.Windows.Application;
using WpfBrush = System.Windows.Media.Brush;
using WpfFontFamily = System.Windows.Media.FontFamily;
using WpfPen = System.Windows.Media.Pen;
using WpfPoint = System.Windows.Point;
using WpfSystemColors = System.Windows.SystemColors;

namespace Fluxora.App.Services;

internal sealed class DropIndicatorAdorner : Adorner
{
    private static readonly WpfFontFamily FallbackFontFamily = new(new Uri("pack://application:,,,/"), "./Fonts/#Onest");

    private readonly string label;
    private double y;
    private bool isVisible;

    public DropIndicatorAdorner(UIElement adornedElement, string label = "Вставить сюда")
        : base(adornedElement)
    {
        IsHitTestVisible = false;
        this.label = label;
    }

    public void Update(double indicatorY)
    {
        y = Math.Clamp(indicatorY, 4, Math.Max(4, RenderSize.Height - 4));
        isVisible = true;
        InvalidateVisual();
    }

    public void Hide()
    {
        if (!isVisible)
        {
            return;
        }

        isVisible = false;
        InvalidateVisual();
    }

    protected override void OnRender(DrawingContext drawingContext)
    {
        base.OnRender(drawingContext);
        if (!isVisible)
        {
            return;
        }

        double right = Math.Max(24, RenderSize.Width - 8);
        WpfBrush accentBrush = ThemeBrush("AccentBrush", WpfSystemColors.HighlightBrush);
        WpfBrush labelBackgroundBrush = ThemeBrush("AccentSoftBrush", WpfSystemColors.ControlBrush);
        WpfBrush labelTextBrush = ThemeBrush("TextBrush", WpfSystemColors.ControlTextBrush);
        FormattedText labelText = CreateLabelText(labelTextBrush);

        WpfPen linePen = new(accentBrush, 2.2)
        {
            StartLineCap = PenLineCap.Round,
            EndLineCap = PenLineCap.Round
        };
        drawingContext.DrawLine(linePen, new WpfPoint(8, y), new WpfPoint(right, y));

        System.Windows.Rect labelRect = new(14, Math.Max(4, y - 12), labelText.Width + 16, 22);
        drawingContext.DrawRoundedRectangle(labelBackgroundBrush, new WpfPen(accentBrush, 1), labelRect, 8, 8);
        drawingContext.DrawText(labelText, new WpfPoint(labelRect.Left + 8, labelRect.Top + 4));
    }

    private FormattedText CreateLabelText(WpfBrush textBrush)
    {
        return new FormattedText(
            label,
            CultureInfo.CurrentUICulture,
            System.Windows.FlowDirection.LeftToRight,
            new Typeface(
                WpfApplication.Current?.TryFindResource("FluxoraFontBody") as WpfFontFamily
                    ?? FallbackFontFamily,
                FontStyles.Normal, FontWeights.SemiBold, FontStretches.Normal),
            10,
            textBrush,
            VisualTreeHelper.GetDpi((Visual?)WpfApplication.Current?.MainWindow ?? this).PixelsPerDip);
    }

    private static WpfBrush ThemeBrush(string resourceKey, WpfBrush fallback)
    {
        return WpfApplication.Current?.TryFindResource(resourceKey) as WpfBrush ?? fallback;
    }
}
