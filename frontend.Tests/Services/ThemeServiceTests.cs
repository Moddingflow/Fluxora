using System.IO;
using System.Runtime.ExceptionServices;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Effects;
using Fluxora.App.Models;
using Fluxora.App.Services;

namespace Fluxora.App.Tests.Services;

[Collection(TestCollections.WpfApplication)]
public sealed class ThemeServiceTests
{
    [Fact]
    public void ThemeResources_HaveMatchingShapeAndUpdateDynamicResources()
    {
        RunOnStaThread(() =>
        {
            bool createdApplication = Application.Current is null;
            Application application = Application.Current ?? new Application
            {
                ShutdownMode = ShutdownMode.OnExplicitShutdown
            };
            application.Resources.MergedDictionaries.Clear();

            string directory = CreateTempDirectory();
            Window? host = null;
            try
            {
                AssertThemeResourceShapeMatches();

                ResourceDictionary existingDictionary = new();
                existingDictionary["SentinelResource"] = "kept";
                application.Resources.MergedDictionaries.Add(existingDictionary);

                SettingsService settingsService = new(directory);
                settingsService.InitializeAsync(TestContext.Current.CancellationToken).GetAwaiter().GetResult();

                Border panel = new();
                panel.SetResourceReference(Border.BackgroundProperty, "PanelBrush");
                TextBlock text = new() { Text = "Theme text" };
                text.SetResourceReference(TextBlock.ForegroundProperty, "TextBrush");
                panel.Child = text;
                host = new Window
                {
                    Content = panel,
                    Width = 1,
                    Height = 1,
                    ShowInTaskbar = false,
                    WindowStyle = WindowStyle.None
                };
                host.Show();

                int themeChangedCount = 0;
                ThemeService themeService = new(settingsService);
                themeService.ThemeChanged += (_, _) => themeChangedCount++;
                themeService.InitializeAsync(TestContext.Current.CancellationToken).GetAwaiter().GetResult();

                Assert.Equal(AppTheme.Dark, themeService.CurrentTheme);
                Assert.Single(ThemeDictionaries(application.Resources));
                Assert.Same(existingDictionary, application.Resources.MergedDictionaries[0]);
                Assert.Equal(Color.FromRgb(0x0A, 0x10, 0x18), Solid(panel.Background).Color);
                Assert.Equal(Color.FromRgb(0xF4, 0xF8, 0xFF), Solid(text.Foreground).Color);

                themeService.SetThemeAsync(AppTheme.Light, TestContext.Current.CancellationToken).GetAwaiter().GetResult();

                Assert.Equal(AppTheme.Light, themeService.CurrentTheme);
                Assert.True(themeService.IsLightThemeEnabled);
                Assert.Equal(1, themeChangedCount);
                Assert.Equal(AppTheme.Light, settingsService.Theme);
                Assert.Single(ThemeDictionaries(application.Resources));
                Assert.Same(existingDictionary, application.Resources.MergedDictionaries[0]);
                Assert.Equal(Color.FromRgb(0xFF, 0xFF, 0xFF), Solid(panel.Background).Color);
                Assert.Equal(Color.FromRgb(0x11, 0x18, 0x27), Solid(text.Foreground).Color);
            }
            finally
            {
                host?.Close();
                application.Resources.MergedDictionaries.Clear();
                if (createdApplication)
                {
                    application.Shutdown();
                }

                if (Directory.Exists(directory))
                {
                    Directory.Delete(directory, recursive: true);
                }
            }
        });
    }

    private static void AssertThemeResourceShapeMatches()
    {
        ResourceDictionary dark = LoadThemeDictionary("DefaultTheme.xaml");
        ResourceDictionary light = LoadThemeDictionary("LightTheme.xaml");

        string[] darkKeys = dark.Keys.OfType<string>().Order(StringComparer.Ordinal).ToArray();
        string[] lightKeys = light.Keys.OfType<string>().Order(StringComparer.Ordinal).ToArray();
        Assert.Equal(darkKeys, lightKeys);

        foreach (string key in darkKeys)
        {
            Assert.Equal(dark[key].GetType(), light[key].GetType());
        }

        Assert.IsType<SolidColorBrush>(dark["TextBrush"]);
        Assert.IsType<SolidColorBrush>(dark["PanelBrush"]);
        Assert.IsAssignableFrom<GradientBrush>(dark["AppBackgroundBrush"]);
        Assert.IsAssignableFrom<GradientBrush>(dark["ProgressGradientBrush"]);
        Assert.IsType<DropShadowEffect>(dark["PanelShadow"]);
    }

    private static ResourceDictionary LoadThemeDictionary(string fileName)
    {
        return new ResourceDictionary
        {
            Source = new Uri($"pack://application:,,,/FluxoraModding;component/Themes/{fileName}", UriKind.Absolute)
        };
    }

    private static IEnumerable<ResourceDictionary> ThemeDictionaries(ResourceDictionary resources)
    {
        return resources.MergedDictionaries.Where(dictionary =>
            dictionary.Source?.OriginalString.Contains("/Themes/", StringComparison.OrdinalIgnoreCase) == true);
    }

    private static SolidColorBrush Solid(Brush? brush)
    {
        return Assert.IsType<SolidColorBrush>(brush);
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
}
