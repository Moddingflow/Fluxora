using System.IO;
using System.Runtime.ExceptionServices;
using System.Windows;
using System.Threading;
using System.Windows.Controls;
using System.Windows.Data;
using System.Windows.Media;
using System.Windows.Threading;
using Fluxora.App.Models;
using Fluxora.App.Services;

namespace Fluxora.App.Tests.Services;

public sealed class ThemeServiceTests
{
    [Fact]
    public void InitializeAsync_LightThemeRecolorsFrozenBrushesAndUsesGrayscaleResources()
    {
        RunOnStaThread(() =>
        {
            string directory = CreateTempDirectory();

            try
            {
                SettingsService settingsService = new(directory);
                settingsService.InitializeAsync(TestContext.Current.CancellationToken).GetAwaiter().GetResult();
                settingsService.SaveThemeAsync(AppTheme.Light, TestContext.Current.CancellationToken).GetAwaiter().GetResult();

                SolidColorBrush frozenPanelBrush = new(Color.FromRgb(0x0A, 0x10, 0x18));
                frozenPanelBrush.Freeze();
                SolidColorBrush frozenTextBrush = new(Color.FromRgb(0xF4, 0xF8, 0xFF));
                frozenTextBrush.Freeze();
                SolidColorBrush frozenAccentBrush = new(Color.FromRgb(0x4D, 0x8D, 0xF7));
                frozenAccentBrush.Freeze();
                SolidColorBrush frozenWarningBrush = new(Color.FromRgb(0xFB, 0xBF, 0x24));
                frozenWarningBrush.Freeze();
                SolidColorBrush frozenSuccessBrush = new(Color.FromRgb(0x7D, 0xD3, 0xFC));
                frozenSuccessBrush.Freeze();
                LinearGradientBrush frozenAccentGradient = new(
                    Color.FromRgb(0x6F, 0xA5, 0xFF),
                    Color.FromRgb(0x1F, 0x5F, 0xCE),
                    0);
                frozenAccentGradient.Freeze();

                TextBlock text = new()
                {
                    Text = "Theme text",
                    Foreground = frozenTextBrush
                };
                Border panel = new()
                {
                    Background = frozenPanelBrush,
                    Child = text
                };
                panel.Resources["AccentBrush"] = frozenAccentBrush;
                panel.Resources["WarningBrush"] = frozenWarningBrush;
                panel.Resources["SuccessBrush"] = frozenSuccessBrush;
                panel.Resources["AccentGradientBrush"] = frozenAccentGradient;

                ThemeService themeService = new(settingsService);
                themeService.InitializeAsync(TestContext.Current.CancellationToken).GetAwaiter().GetResult();
                themeService.ApplyCurrentThemeTo(panel);

                Assert.Equal(Color.FromRgb(0xFF, 0xFF, 0xFF), Solid(panel.Background).Color);
                Assert.Equal(Color.FromRgb(0x11, 0x11, 0x11), Solid(text.Foreground).Color);
                AssertGrayscale(Solid(panel.Resources["AccentBrush"]).Color);
                AssertGrayscale(Solid(panel.Resources["WarningBrush"]).Color);
                AssertGrayscale(Solid(panel.Resources["SuccessBrush"]).Color);
                foreach (GradientStop stop in Gradient(panel.Resources["AccentGradientBrush"]).GradientStops)
                {
                    AssertGrayscale(stop.Color);
                }
            }
            finally
            {
                if (Directory.Exists(directory))
                {
                    Directory.Delete(directory, recursive: true);
                }
            }
        });
    }

    [Fact]
    public void ApplyCurrentThemeTo_LightThemeRecolorsRecycledSeparatorRows()
    {
        RunOnStaThread(() =>
        {
            string directory = CreateTempDirectory();

            try
            {
                SettingsService settingsService = new(directory);
                settingsService.InitializeAsync(TestContext.Current.CancellationToken).GetAwaiter().GetResult();
                settingsService.SaveThemeAsync(AppTheme.Light, TestContext.Current.CancellationToken).GetAwaiter().GetResult();

                SolidColorBrush separatorBackground = new(Color.FromRgb(0x05, 0x0A, 0x11));
                separatorBackground.Freeze();
                SolidColorBrush separatorForeground = new(Color.FromRgb(0x6F, 0xA5, 0xFF));
                separatorForeground.Freeze();

                DataGridRow row = new()
                {
                    DataContext = new RecycledThemeRow(false),
                    Style = CreateSeparatorRowStyle(separatorBackground, separatorForeground)
                };

                ThemeService themeService = new(settingsService);
                themeService.InitializeAsync(TestContext.Current.CancellationToken).GetAwaiter().GetResult();
                themeService.ApplyCurrentThemeTo(row);

                row.DataContext = new RecycledThemeRow(true);
                DrainDispatcher();

                Assert.Equal(Color.FromRgb(0xF2, 0xF2, 0xF2), Solid(row.Background).Color);
                Assert.Equal(Color.FromRgb(0x00, 0x00, 0x00), Solid(row.Foreground).Color);
            }
            finally
            {
                if (Directory.Exists(directory))
                {
                    Directory.Delete(directory, recursive: true);
                }
            }
        });
    }

    private static Style CreateSeparatorRowStyle(Brush separatorBackground, Brush separatorForeground)
    {
        Style style = new(typeof(DataGridRow));
        style.Setters.Add(new Setter(Control.BackgroundProperty, Brushes.Transparent));
        style.Setters.Add(new Setter(Control.ForegroundProperty, new SolidColorBrush(Color.FromRgb(0xF4, 0xF8, 0xFF))));

        DataTrigger separatorTrigger = new()
        {
            Binding = new Binding(nameof(RecycledThemeRow.IsSeparator)),
            Value = true
        };
        separatorTrigger.Setters.Add(new Setter(Control.BackgroundProperty, separatorBackground));
        separatorTrigger.Setters.Add(new Setter(Control.ForegroundProperty, separatorForeground));
        style.Triggers.Add(separatorTrigger);

        return style;
    }

    private static SolidColorBrush Solid(object value)
    {
        return Assert.IsType<SolidColorBrush>(value);
    }

    private static GradientBrush Gradient(object value)
    {
        return Assert.IsAssignableFrom<GradientBrush>(value);
    }

    private static void AssertGrayscale(Color color)
    {
        Assert.Equal(color.R, color.G);
        Assert.Equal(color.G, color.B);
    }

    private static void DrainDispatcher()
    {
        Dispatcher.CurrentDispatcher.Invoke(() => { }, DispatcherPriority.ApplicationIdle);
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

    private static string CreateTempDirectory()
    {
        string directory = Path.Combine(Path.GetTempPath(), "FluxoraThemeTests", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        return directory;
    }

    private sealed record RecycledThemeRow(bool IsSeparator);
}
