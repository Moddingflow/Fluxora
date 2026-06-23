using System.IO;
using Fluxora.App.Models;
using Fluxora.App.Services;

namespace Fluxora.App.Tests.Services;

public sealed class SettingsServiceTests
{
    [Fact]
    public async Task InitializeAsync_DefaultsToDarkTheme()
    {
        string directory = CreateTempDirectory();
        try
        {
            SettingsService service = new(directory);

            await service.InitializeAsync(TestContext.Current.CancellationToken);

            Assert.Equal(AppTheme.Dark, service.Theme);
            Assert.True(Directory.Exists(service.ProjectsDirectory));
            Assert.True(Directory.Exists(service.ModsDirectory));
            Assert.True(Directory.Exists(service.BuildConfigsDirectory));
        }
        finally
        {
            Directory.Delete(directory, recursive: true);
        }
    }

    [Fact]
    public async Task SaveThemeAsync_PersistsThemeAcrossServiceInstances()
    {
        string directory = CreateTempDirectory();
        try
        {
            SettingsService first = new(directory);
            await first.InitializeAsync(TestContext.Current.CancellationToken);

            await first.SaveThemeAsync(AppTheme.Light, TestContext.Current.CancellationToken);

            SettingsService second = new(directory);
            await second.InitializeAsync(TestContext.Current.CancellationToken);

            Assert.Equal(AppTheme.Light, second.Theme);
        }
        finally
        {
            Directory.Delete(directory, recursive: true);
        }
    }

    private static string CreateTempDirectory()
    {
        string directory = Path.Combine(Path.GetTempPath(), "FluxoraSettingsTests", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        return directory;
    }
}
