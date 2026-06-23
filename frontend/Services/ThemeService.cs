using System.Windows;
using Fluxora.App.Models;
using WpfApplication = System.Windows.Application;

namespace Fluxora.App.Services;

public sealed class ThemeService : IAppService
{
    private static readonly Uri DefaultThemeUri = CreateThemeUri("DefaultTheme.xaml");
    private static readonly Uri LightThemeUri = CreateThemeUri("LightTheme.xaml");

    private readonly SettingsService settingsService;
    private AppTheme currentTheme = AppTheme.Dark;

    public ThemeService(SettingsService settingsService)
    {
        this.settingsService = settingsService;
    }

    public event EventHandler? ThemeChanged;

    public AppTheme CurrentTheme => currentTheme;

    public bool IsLightThemeEnabled => currentTheme == AppTheme.Light;

    public void ApplyCurrentThemeTo(DependencyObject root)
    {
        ArgumentNullException.ThrowIfNull(root);
        ApplyThemeResources(currentTheme);

        if (root is Window window)
        {
            WindowChromeService.ApplyTheme(window, currentTheme);
        }
    }

    public Task InitializeAsync(CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        currentTheme = settingsService.Theme;
        ApplyTheme(currentTheme);
        return Task.CompletedTask;
    }

    public async Task SetThemeAsync(AppTheme theme, CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();

        bool changed = theme != currentTheme;
        currentTheme = theme;
        ApplyTheme(theme);
        await settingsService.SaveThemeAsync(theme, cancellationToken);

        if (changed)
        {
            ThemeChanged?.Invoke(this, EventArgs.Empty);
        }
    }

    private static Uri CreateThemeUri(string fileName)
    {
        return new Uri($"pack://application:,,,/FluxoraModding;component/Themes/{fileName}", UriKind.Absolute);
    }

    private static Uri ThemeUriFor(AppTheme theme)
    {
        return theme == AppTheme.Light ? LightThemeUri : DefaultThemeUri;
    }

    private static void ApplyThemeResources(AppTheme theme)
    {
        ResourceDictionary? resources = WpfApplication.Current?.Resources;
        if (resources is null)
        {
            return;
        }

        Uri themeUri = ThemeUriFor(theme);
        for (int index = resources.MergedDictionaries.Count - 1; index >= 0; index--)
        {
            if (IsFluxoraThemeDictionary(resources.MergedDictionaries[index]))
            {
                resources.MergedDictionaries.RemoveAt(index);
            }
        }

        resources.MergedDictionaries.Add(new ResourceDictionary { Source = themeUri });
    }

    private static bool IsFluxoraThemeDictionary(ResourceDictionary dictionary)
    {
        string source = dictionary.Source?.OriginalString.Replace('\\', '/') ?? string.Empty;
        return source.EndsWith("/Themes/DefaultTheme.xaml", StringComparison.OrdinalIgnoreCase) ||
            source.EndsWith("/Themes/LightTheme.xaml", StringComparison.OrdinalIgnoreCase) ||
            source.Equals("Themes/DefaultTheme.xaml", StringComparison.OrdinalIgnoreCase) ||
            source.Equals("Themes/LightTheme.xaml", StringComparison.OrdinalIgnoreCase);
    }

    private void ApplyTheme(AppTheme theme)
    {
        ApplyThemeResources(theme);
        WindowChromeService.SetTheme(theme);

        if (WpfApplication.Current is null)
        {
            return;
        }

        foreach (Window window in WpfApplication.Current.Windows.OfType<Window>())
        {
            WindowChromeService.ApplyTheme(window, theme);
        }
    }
}
