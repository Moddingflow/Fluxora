using System.IO;
using System.Linq;
using System.Text.Json;
using Fluxora.App.Services;

namespace Fluxora.App.Tests.Services;

public sealed class ProjectCatalogServiceTests
{
    [Fact]
    public void EnumerateBuildConfigPathsByLastWriteTimeSortsCachedTimestamps()
    {
        string directory = Path.Combine(Path.GetTempPath(), $"fluxora-project-catalog-{Guid.NewGuid():N}");
        Directory.CreateDirectory(directory);
        try
        {
            string olderPath = Path.Combine(directory, "older.json");
            string newerPath = Path.Combine(directory, "newer.json");
            string ignoredPath = Path.Combine(directory, "ignored.txt");
            File.WriteAllText(olderPath, "{}");
            File.WriteAllText(newerPath, "{}");
            File.WriteAllText(ignoredPath, "{}");
            File.SetLastWriteTimeUtc(olderPath, new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc));
            File.SetLastWriteTimeUtc(newerPath, new DateTime(2026, 1, 2, 0, 0, 0, DateTimeKind.Utc));

            IReadOnlyList<string> paths = ProjectCatalogService.EnumerateBuildConfigPathsByLastWriteTime(directory);

            Assert.Equal(new[] { "newer.json", "older.json" }, paths.Select(Path.GetFileName).ToArray());
        }
        finally
        {
            Directory.Delete(directory, recursive: true);
        }
    }

    [Fact]
    public void LoadManagedProjectCatalog_ReadsManifestSummariesWithoutNativeBridge()
    {
        string directory = Path.Combine(Path.GetTempPath(), $"fluxora-managed-catalog-{Guid.NewGuid():N}");
        string installRoot = Path.Combine(directory, "Instances");
        string projectDirectory = Path.Combine(installRoot, "Example Build");
        Directory.CreateDirectory(projectDirectory);
        try
        {
            string configPath = Path.Combine(directory, "Example Build.json");
            File.WriteAllText(
                configPath,
                $$"""
                {
                  "name": "Example Build",
                  "templateId": "skyrimse",
                  "baseTemplateId": "base",
                  "gameName": "Skyrim Special Edition",
                  "gameDisplayName": "Skyrim Special Edition",
                  "gameId": "skyrimse",
                  "gamePath": "Stock Game",
                  "installRoot": {{JsonString(installRoot)}},
                  "projectDirectory": {{JsonString(projectDirectory)}},
                  "configPath": {{JsonString(configPath)}},
                  "dataDirectory": "Data",
                  "defaultProfile": "Default",
                  "folders": ["mods", "downloads", "profiles", "overwrite"],
                  "profileFiles": ["plugins.txt", "loadorder.txt"],
                  "basePlugins": ["Skyrim.esm"],
                  "pluginExtensions": [".esm", ".esp", ".esl"],
                  "archiveExtensions": [".zip", ".7z"],
                  "executables": ["SkyrimSE.exe", "skse64_loader.exe"],
                  "paths": {
                    "gameDirectory": "Stock Game",
                    "modsDirectory": "mods",
                    "profilesDirectory": "profiles",
                    "downloadsDirectory": "downloads",
                    "overwriteDirectory": "overwrite"
                  },
                  "capabilities": [
                    { "id": "plugins", "displayName": "Plugins", "description": "" },
                    { "id": "load-order", "displayName": "Load order", "description": "" },
                    { "id": "root-files", "displayName": "Root files", "description": "" },
                    { "id": "script-extender", "displayName": "Script extender", "description": "" },
                    { "id": "content-layout", "displayName": "Layout rules", "description": "" }
                  ],
                  "scriptExtender": {
                    "name": "SKSE64",
                    "loaderExecutable": "skse64_loader.exe",
                    "website": ""
                  },
                  "launchExecutables": [
                    {
                      "id": "game",
                      "displayName": "Skyrim",
                      "executablePath": "SkyrimSE.exe",
                      "arguments": "",
                      "workingDirectory": ""
                    }
                  ],
                  "projectFingerprint": {
                    "gameId": "skyrimse",
                    "gameDisplayName": "Skyrim Special Edition",
                    "healthStatusAtCreation": "healthy"
                  }
                }
                """);
            File.WriteAllText(Path.Combine(directory, "Broken.json"), "{");

            var projects = ProjectCatalogService.LoadManagedProjectCatalog(
                directory,
                cancellationToken: TestContext.Current.CancellationToken);

            var project = Assert.Single(projects);
            Assert.Equal("Example Build", project.Name);
            Assert.Equal(configPath, project.ConfigPath);
            Assert.Equal(Path.Combine(projectDirectory, "Stock Game"), project.GamePath);
            Assert.Equal(Path.Combine(projectDirectory, "mods"), project.Paths.ModsDirectory);
            Assert.Equal("skyrimse", project.TemplateId);
            Assert.True(project.GameCapabilities.SupportsPlugins);
            Assert.True(project.GameCapabilities.SupportsLoadOrder);
            Assert.True(project.GameCapabilities.SupportsRootFiles);
            Assert.True(project.GameCapabilities.SupportsScriptExtender);
            Assert.True(project.GameCapabilities.SupportsContentLayoutRules);
            Assert.Equal("Data", project.ContentLayoutSummary.DataFolder);
            Assert.Equal("SKSE64", project.Template?.ScriptExtender?.Name);
            Assert.Single(project.Executables);
            Assert.Equal("healthy", project.GameHealthSummary.Status);
        }
        finally
        {
            Directory.Delete(directory, recursive: true);
        }
    }

    private static string JsonString(string value)
    {
        return JsonSerializer.Serialize(value);
    }
}
