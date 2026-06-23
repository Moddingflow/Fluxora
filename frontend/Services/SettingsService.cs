using System.IO;
using System.Text.Json;
using Fluxora.App.Models;

namespace Fluxora.App.Services;

public sealed class SettingsService : IAppService
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = true,
        PropertyNameCaseInsensitive = true
    };

    private readonly string appDataDirectory;
    private readonly string settingsFilePath;

    public SettingsService(string? appDataDirectory = null)
    {
        this.appDataDirectory = string.IsNullOrWhiteSpace(appDataDirectory)
            ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Fluxora")
            : appDataDirectory;
        settingsFilePath = Path.Combine(this.appDataDirectory, "settings.json");
        ProjectsDirectory = Path.Combine(this.appDataDirectory, "Projects");
        ModsDirectory = Path.Combine(this.appDataDirectory, "Mods");
        BuildConfigsDirectory = Path.Combine(this.appDataDirectory, "Builds");
    }

    public string ProjectsDirectory { get; }

    public string ModsDirectory { get; }

    public string BuildConfigsDirectory { get; }

    public AppTheme Theme { get; private set; } = AppTheme.Dark;

    public async Task InitializeAsync(CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        Directory.CreateDirectory(appDataDirectory);
        Directory.CreateDirectory(ProjectsDirectory);
        Directory.CreateDirectory(ModsDirectory);
        Directory.CreateDirectory(BuildConfigsDirectory);
        await LoadSettingsAsync(cancellationToken);
    }

    public async Task SaveThemeAsync(AppTheme theme, CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        Theme = theme;
        await SaveSettingsAsync(cancellationToken);
    }

    private async Task LoadSettingsAsync(CancellationToken cancellationToken)
    {
        if (!File.Exists(settingsFilePath))
        {
            Theme = AppTheme.Dark;
            return;
        }

        try
        {
            await using FileStream stream = File.OpenRead(settingsFilePath);
            PersistedSettings? settings = await JsonSerializer.DeserializeAsync<PersistedSettings>(
                stream,
                JsonOptions,
                cancellationToken);
            Theme = ParseTheme(settings?.Theme);
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or JsonException)
        {
            Theme = AppTheme.Dark;
        }
    }

    private async Task SaveSettingsAsync(CancellationToken cancellationToken)
    {
        Directory.CreateDirectory(appDataDirectory);
        PersistedSettings settings = new()
        {
            Theme = FormatTheme(Theme)
        };

        await using FileStream stream = File.Create(settingsFilePath);
        await JsonSerializer.SerializeAsync(stream, settings, JsonOptions, cancellationToken);
    }

    private static AppTheme ParseTheme(string? theme)
    {
        return string.Equals(theme, "light", StringComparison.OrdinalIgnoreCase)
            ? AppTheme.Light
            : AppTheme.Dark;
    }

    private static string FormatTheme(AppTheme theme)
    {
        return theme == AppTheme.Light ? "light" : "dark";
    }

    private sealed class PersistedSettings
    {
        public string? Theme { get; set; }
    }
}
