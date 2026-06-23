using System.IO;
using System.Text.Json;
using Fluxora.App.Models;

namespace Fluxora.App.Services;

public sealed class ProjectCatalogService : IAppService
{
    private const string BuildConfigFileName = "fluxora.build.json";

    private readonly record struct BuildConfigFileEntry(string FilePath, DateTime LastWriteTimeUtc);

    private readonly CoreBridgeService coreBridgeService;
    private readonly SettingsService settingsService;
    private readonly Func<string, string, CancellationToken, Task<string>>? projectDirectoryPreviewBuilder;
    private readonly ApplicationLogService? logger;
    private readonly List<ModProject> projects = new();

    public ProjectCatalogService(
        CoreBridgeService coreBridgeService,
        SettingsService settingsService,
        ApplicationLogService? logger = null)
        : this(coreBridgeService, settingsService, projectDirectoryPreviewBuilder: null, logger)
    {
    }

    internal ProjectCatalogService(
        CoreBridgeService coreBridgeService,
        SettingsService settingsService,
        Func<string, string, CancellationToken, Task<string>>? projectDirectoryPreviewBuilder,
        ApplicationLogService? logger = null)
    {
        this.coreBridgeService = coreBridgeService;
        this.settingsService = settingsService;
        this.projectDirectoryPreviewBuilder = projectDirectoryPreviewBuilder;
        this.logger = logger;
    }

    public Task InitializeAsync(CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        projects.Clear();

        Directory.CreateDirectory(settingsService.BuildConfigsDirectory);

        IReadOnlyList<ModProject> catalog = LoadManagedProjectCatalog(
            settingsService.BuildConfigsDirectory,
            logger,
            cancellationToken);
        foreach (ModProject project in catalog)
        {
            cancellationToken.ThrowIfCancellationRequested();
            UpsertProject(project);
        }

        return Task.CompletedTask;
    }

    internal static IReadOnlyList<string> EnumerateBuildConfigPathsByLastWriteTime(string buildConfigsDirectory)
    {
        List<BuildConfigFileEntry> entries = new();
        foreach (string configPath in Directory.EnumerateFiles(
            buildConfigsDirectory,
            "*.json",
            SearchOption.TopDirectoryOnly))
        {
            entries.Add(new BuildConfigFileEntry(
                configPath,
                ReadLastWriteTimeUtcOrMinValue(configPath)));
        }

        entries.Sort(static (left, right) =>
        {
            int timeComparison = right.LastWriteTimeUtc.CompareTo(left.LastWriteTimeUtc);
            if (timeComparison != 0)
            {
                return timeComparison;
            }

            return string.CompareOrdinal(left.FilePath, right.FilePath);
        });

        return entries.Select(static entry => entry.FilePath).ToList();
    }

    internal static IReadOnlyList<ModProject> LoadManagedProjectCatalog(
        string buildConfigsDirectory,
        ApplicationLogService? logger = null,
        CancellationToken cancellationToken = default)
    {
        List<ModProject> loadedProjects = new();
        int skippedCount = 0;

        foreach (string configPath in EnumerateBuildConfigPathsByLastWriteTime(buildConfigsDirectory))
        {
            cancellationToken.ThrowIfCancellationRequested();

            try
            {
                loadedProjects.Add(ReadProjectManifestSummary(configPath));
            }
            catch (Exception exception) when (IsCatalogReadException(exception))
            {
                skippedCount++;
                logger?.Warning(
                    "ProjectCatalog",
                    $"Skipped build config summary. configPath=\"{configPath}\"",
                    exception);
            }
        }

        logger?.Info(
            "ProjectCatalog",
            $"Loaded managed project catalog. count={loadedProjects.Count}, skipped={skippedCount}, directory=\"{buildConfigsDirectory}\"");
        return loadedProjects;
    }

    private static ModProject ReadProjectManifestSummary(string configPath)
    {
        string absoluteConfigPath = Path.GetFullPath(configPath);
        string manifestDirectory = Path.GetDirectoryName(absoluteConfigPath) ?? string.Empty;
        using FileStream stream = File.OpenRead(absoluteConfigPath);
        using JsonDocument document = JsonDocument.Parse(
            stream,
            new JsonDocumentOptions
            {
                AllowTrailingCommas = true,
                CommentHandling = JsonCommentHandling.Skip
            });

        JsonElement root = document.RootElement;
        if (root.ValueKind != JsonValueKind.Object)
        {
            throw new InvalidOperationException("Build config root must be a JSON object.");
        }

        string projectDirectory = ResolveManifestPath(
            ReadString(root, "projectDirectory", manifestDirectory),
            manifestDirectory);
        if (string.IsNullOrWhiteSpace(projectDirectory))
        {
            projectDirectory = manifestDirectory;
        }

        string name = ReadRequiredString(root, "name");
        string templateId = ReadString(root, "templateId", ReadString(root, "gameId"));
        string gameName = ReadString(root, "gameName", ReadString(root, "gameDisplayName", templateId));
        string gamePath = ResolveManifestPath(ReadString(root, "gamePath"), projectDirectory);
        string installRoot = ResolveManifestPath(
            ReadString(root, "installRoot", ReadString(root, "installRootDirectory")),
            projectDirectory);
        if (string.IsNullOrWhiteSpace(installRoot))
        {
            installRoot = Directory.GetParent(projectDirectory)?.FullName ?? projectDirectory;
        }

        string manifestConfigPath = ResolveManifestPath(
            ReadString(root, "configPath", absoluteConfigPath),
            manifestDirectory);
        ResolvedTemplate template = ReadResolvedTemplate(root, templateId, gameName);
        BuildPathSettings paths = ReadBuildPathSettings(root, projectDirectory, gamePath);
        ProjectFingerprint? fingerprint = ReadOptionalObject<ProjectFingerprint>(root, "projectFingerprint") ??
            ReadCompatibilityFingerprint(root);
        GameHealthSummary health = BuildHealthSummary(root, fingerprint, gameName);
        List<GameExecutableEntry> executables = ReadOptionalList<GameExecutableEntry>(root, "launchExecutables");

        ModProject project = new()
        {
            Id = manifestConfigPath,
            Name = name,
            TemplateId = templateId,
            UiTemplateId = string.IsNullOrWhiteSpace(template.UiTemplateId) ? templateId : template.UiTemplateId,
            GameName = gameName,
            GamePath = gamePath,
            InstallRootDirectory = installRoot,
            ProjectDirectory = projectDirectory,
            ConfigPath = manifestConfigPath,
            Paths = paths,
            Executables = executables,
            Template = template,
            GameCapabilities = template.GameCapabilities,
            GameHealthSummary = health,
            ProjectFingerprint = fingerprint,
            ContentLayoutSummary = template.ContentLayoutSummary
        };
        project.Paths.ApplyFallbacks(project.ProjectDirectory, project.GamePath);
        project.GamePath = project.Paths.GameDirectory;
        return project;
    }

    private static ResolvedTemplate ReadResolvedTemplate(
        JsonElement root,
        string templateId,
        string gameName)
    {
        List<TemplateCapability> capabilities = ReadOptionalList<TemplateCapability>(root, "capabilities");
        List<string> pluginExtensions = ReadStringList(root, "pluginExtensions");
        List<string> archiveExtensions = ReadStringList(root, "archiveExtensions");
        List<string> scriptExtenderLoaders = ReadScriptExtenderLoaders(root);
        GameCapabilities gameCapabilities = BuildCapabilities(capabilities, pluginExtensions, archiveExtensions, scriptExtenderLoaders);
        ContentLayoutSummary contentLayoutSummary = BuildContentLayoutSummary(
            root,
            gameCapabilities,
            pluginExtensions,
            archiveExtensions,
            scriptExtenderLoaders);

        return new ResolvedTemplate
        {
            Id = templateId,
            DisplayName = gameName,
            GameName = gameName,
            UiTemplateId = templateId,
            BaseTemplateId = ReadString(root, "baseTemplateId"),
            DefaultProfile = ReadString(root, "defaultProfile"),
            DataDirectory = ReadString(root, "dataDirectory"),
            NexusDomain = ReadString(root, "nexusDomain"),
            Folders = ReadStringList(root, "folders"),
            ProfileFiles = ReadStringList(root, "profileFiles"),
            BasePlugins = ReadStringList(root, "basePlugins"),
            PluginExtensions = pluginExtensions,
            ArchiveExtensions = archiveExtensions,
            Executables = ReadStringList(root, "executables"),
            Capabilities = capabilities,
            GameCapabilities = gameCapabilities,
            ContentLayoutSummary = contentLayoutSummary,
            ScriptExtender = ReadOptionalObject<ScriptExtenderInfo>(root, "scriptExtender")
        };
    }

    private static BuildPathSettings ReadBuildPathSettings(
        JsonElement root,
        string projectDirectory,
        string gamePath)
    {
        BuildPathSettings paths = ReadOptionalObject<BuildPathSettings>(root, "paths") ?? new BuildPathSettings();
        paths.ApplyFallbacks(projectDirectory, gamePath);
        paths.GameDirectory = ResolveManifestPath(paths.GameDirectory, projectDirectory);
        paths.ModsDirectory = ResolveManifestPath(paths.ModsDirectory, projectDirectory);
        paths.ProfilesDirectory = ResolveManifestPath(paths.ProfilesDirectory, projectDirectory);
        paths.DownloadsDirectory = ResolveManifestPath(paths.DownloadsDirectory, projectDirectory);
        paths.OverwriteDirectory = ResolveManifestPath(paths.OverwriteDirectory, projectDirectory);
        return paths;
    }

    private static GameCapabilities BuildCapabilities(
        IReadOnlyCollection<TemplateCapability> capabilities,
        IReadOnlyCollection<string> pluginExtensions,
        IReadOnlyCollection<string> archiveExtensions,
        IReadOnlyCollection<string> scriptExtenderLoaders)
    {
        HashSet<string> ids = capabilities
            .Select(static capability => capability.Id)
            .Where(static id => !string.IsNullOrWhiteSpace(id))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
        List<string> enabled = new();

        static void AddIf(List<string> enabled, bool condition, string id)
        {
            if (condition)
            {
                enabled.Add(id);
            }
        }

        bool supportsPlugins = ids.Contains("plugins") || pluginExtensions.Count > 0;
        bool supportsLoadOrder = ids.Contains("load-order") || ids.Contains("loadOrder");
        bool supportsRootFiles = ids.Contains("root-files");
        bool supportsArchives = ids.Contains("downloads") || archiveExtensions.Count > 0;
        bool supportsScriptExtender = ids.Contains("script-extender") || scriptExtenderLoaders.Count > 0;
        bool supportsIniProfiles = ids.Contains("ini-tweaks") || ids.Contains("ini-profiles");
        bool supportsSaveProfiles = ids.Contains("save-games") || ids.Contains("save-profiles");
        bool supportsContentLayoutRules = ids.Contains("content-layout") || ids.Contains("content-layout-rules");

        AddIf(enabled, supportsPlugins, "plugins");
        AddIf(enabled, supportsLoadOrder, "loadOrder");
        AddIf(enabled, supportsRootFiles, "rootFiles");
        AddIf(enabled, supportsArchives, "archives");
        AddIf(enabled, supportsScriptExtender, "scriptExtender");
        AddIf(enabled, supportsIniProfiles, "iniProfiles");
        AddIf(enabled, supportsSaveProfiles, "saveProfiles");
        AddIf(enabled, supportsContentLayoutRules, "contentLayoutRules");

        return new GameCapabilities
        {
            SupportsPlugins = supportsPlugins,
            SupportsLoadOrder = supportsLoadOrder,
            SupportsRootFiles = supportsRootFiles,
            SupportsArchives = supportsArchives,
            SupportsScriptExtender = supportsScriptExtender,
            SupportsIniProfiles = supportsIniProfiles,
            SupportsSaveProfiles = supportsSaveProfiles,
            SupportsContentLayoutRules = supportsContentLayoutRules,
            Enabled = enabled
        };
    }

    private static ContentLayoutSummary BuildContentLayoutSummary(
        JsonElement root,
        GameCapabilities capabilities,
        List<string> pluginExtensions,
        List<string> archiveExtensions,
        List<string> scriptExtenderLoaders)
    {
        string dataFolder = ReadString(root, "dataDirectory");
        return new ContentLayoutSummary
        {
            Supported = capabilities.SupportsContentLayoutRules || !string.IsNullOrWhiteSpace(dataFolder),
            DataFolder = dataFolder,
            SupportsRootFiles = capabilities.SupportsRootFiles,
            PluginExtensions = pluginExtensions,
            ArchiveExtensions = archiveExtensions,
            ScriptExtenderLoaders = scriptExtenderLoaders
        };
    }

    private static GameHealthSummary BuildHealthSummary(
        JsonElement root,
        ProjectFingerprint? fingerprint,
        string gameName)
    {
        string status = fingerprint?.HealthStatusAtCreation ?? "unknown";
        string gameId = fingerprint?.GameId ?? ReadString(root, "gameId");
        string displayName = fingerprint?.GameDisplayName ?? ReadString(root, "gameDisplayName", gameName);
        return new GameHealthSummary
        {
            GameId = gameId,
            DisplayName = displayName,
            Status = string.IsNullOrWhiteSpace(status) ? "unknown" : status,
            Summary = string.IsNullOrWhiteSpace(status) || string.Equals(status, "unknown", StringComparison.OrdinalIgnoreCase)
                ? string.Empty
                : displayName,
            HasBlockers = string.Equals(status, "blocked", StringComparison.OrdinalIgnoreCase),
            AllowsAutomation = !string.Equals(status, "blocked", StringComparison.OrdinalIgnoreCase)
        };
    }

    private static ProjectFingerprint? ReadCompatibilityFingerprint(JsonElement root)
    {
        string gameId = ReadString(root, "gameId");
        string gameDisplayName = ReadString(root, "gameDisplayName");
        if (string.IsNullOrWhiteSpace(gameId) && string.IsNullOrWhiteSpace(gameDisplayName))
        {
            return null;
        }

        return new ProjectFingerprint
        {
            GameId = gameId,
            GameDisplayName = gameDisplayName,
            SelectedInstallPath = ReadString(root, "gamePath"),
            HealthStatusAtCreation = "unknown"
        };
    }

    private static List<string> ReadScriptExtenderLoaders(JsonElement root)
    {
        ScriptExtenderInfo? scriptExtender = ReadOptionalObject<ScriptExtenderInfo>(root, "scriptExtender");
        return scriptExtender is not null && !string.IsNullOrWhiteSpace(scriptExtender.LoaderExecutable)
            ? new List<string> { scriptExtender.LoaderExecutable }
            : new List<string>();
    }

    private static string ReadRequiredString(JsonElement root, string propertyName)
    {
        string value = ReadString(root, propertyName);
        if (string.IsNullOrWhiteSpace(value))
        {
            throw new InvalidOperationException($"Build config is missing required property '{propertyName}'.");
        }

        return value;
    }

    private static string ReadString(JsonElement root, string propertyName, string defaultValue = "")
    {
        return root.TryGetProperty(propertyName, out JsonElement value) && value.ValueKind == JsonValueKind.String
            ? value.GetString() ?? string.Empty
            : defaultValue;
    }

    private static List<string> ReadStringList(JsonElement root, string propertyName)
    {
        if (!root.TryGetProperty(propertyName, out JsonElement value) ||
            value.ValueKind != JsonValueKind.Array)
        {
            return new List<string>();
        }

        List<string> items = new();
        foreach (JsonElement item in value.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.String)
            {
                string? text = item.GetString();
                if (!string.IsNullOrWhiteSpace(text))
                {
                    items.Add(text);
                }
            }
        }

        return items;
    }

    private static T? ReadOptionalObject<T>(JsonElement root, string propertyName)
        where T : class
    {
        if (!root.TryGetProperty(propertyName, out JsonElement value) ||
            value.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined)
        {
            return null;
        }

        return value.Deserialize<T>(new JsonSerializerOptions
        {
            PropertyNameCaseInsensitive = true
        });
    }

    private static List<T> ReadOptionalList<T>(JsonElement root, string propertyName)
    {
        if (!root.TryGetProperty(propertyName, out JsonElement value) ||
            value.ValueKind != JsonValueKind.Array)
        {
            return new List<T>();
        }

        return value.Deserialize<List<T>>(new JsonSerializerOptions
        {
            PropertyNameCaseInsensitive = true
        }) ?? new List<T>();
    }

    private static string ResolveManifestPath(string text, string relativeRoot)
    {
        if (string.IsNullOrWhiteSpace(text))
        {
            return string.Empty;
        }

        try
        {
            string candidate = Path.IsPathRooted(text)
                ? text
                : Path.Combine(relativeRoot, text);
            return Path.GetFullPath(candidate);
        }
        catch (Exception exception) when (
            exception is ArgumentException or
                NotSupportedException or
                PathTooLongException)
        {
            return text;
        }
    }

    private static bool IsCatalogReadException(Exception exception)
    {
        return exception is IOException or
            UnauthorizedAccessException or
            NotSupportedException or
            ArgumentException or
            InvalidOperationException or
            JsonException;
    }

    private static DateTime ReadLastWriteTimeUtcOrMinValue(string path)
    {
        try
        {
            return File.GetLastWriteTimeUtc(path);
        }
        catch (Exception exception) when (
            exception is IOException or
            UnauthorizedAccessException or
            NotSupportedException)
        {
            return DateTime.MinValue;
        }
    }

    public Task<IReadOnlyList<ModProject>> GetProjectsAsync(CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult<IReadOnlyList<ModProject>>(projects.AsReadOnly());
    }

    public Task<string> BuildProjectDirectoryPreviewAsync(
        string projectName,
        string installRootDirectory,
        CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();

        return projectDirectoryPreviewBuilder is not null
            ? projectDirectoryPreviewBuilder(projectName, installRootDirectory, cancellationToken)
            : coreBridgeService.BuildProjectDirectoryPreviewAsync(projectName, installRootDirectory, cancellationToken);
    }

    public async Task<ModProject> CreateProjectAsync(
        string name,
        ResolvedTemplate template,
        string gamePath,
        string installRootDirectory,
        CancellationToken cancellationToken = default)
    {
        ModProject project = await coreBridgeService.CreateProjectAsync(
            name,
            template,
            gamePath,
            installRootDirectory,
            cancellationToken);

        UpsertProject(project);
        return project;
    }

    public async Task<ModProject> OpenProjectFromConfigAsync(
        string configPath,
        CancellationToken cancellationToken = default)
    {
        ModProject project = await coreBridgeService.OpenProjectFromConfigAsync(configPath, cancellationToken);
        UpsertProject(project);
        return project;
    }

    public async Task<ModProject> RenameProjectAsync(
        ModProject project,
        string newName,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(project);

        ModProject renamedProject = await coreBridgeService.RenameProjectAsync(
            ResolveConfigPath(project),
            newName,
            cancellationToken);
        ReplaceProject(project, renamedProject);
        return renamedProject;
    }

    public async Task DeleteProjectAsync(
        ModProject project,
        Action<BuildDeletionProgress>? progress = null,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(project);

        await coreBridgeService.DeleteProjectAsync(ResolveConfigPath(project), progress, cancellationToken);
        RemoveProject(project);
    }

    private void UpsertProject(ModProject project)
    {
        int existingIndex = projects.FindIndex(candidate =>
            IsSamePath(candidate.ConfigPath, project.ConfigPath) ||
            IsSamePath(candidate.ProjectDirectory, project.ProjectDirectory));

        if (existingIndex >= 0)
        {
            projects[existingIndex] = project;
            return;
        }

        projects.Add(project);
    }

    private void ReplaceProject(ModProject oldProject, ModProject newProject)
    {
        int existingIndex = projects.FindIndex(candidate =>
            IsSameProject(candidate, oldProject) ||
            IsSameProject(candidate, newProject));

        if (existingIndex >= 0)
        {
            projects[existingIndex] = newProject;
            return;
        }

        projects.Add(newProject);
    }

    private void RemoveProject(ModProject project)
    {
        int existingIndex = projects.FindIndex(candidate => IsSameProject(candidate, project));
        if (existingIndex >= 0)
        {
            projects.RemoveAt(existingIndex);
        }
    }

    private static string ResolveConfigPath(ModProject project)
    {
        if (!string.IsNullOrWhiteSpace(project.ConfigPath))
        {
            return project.ConfigPath;
        }

        return string.IsNullOrWhiteSpace(project.ProjectDirectory)
            ? string.Empty
            : Path.Combine(project.ProjectDirectory, BuildConfigFileName);
    }

    private static bool IsSameProject(ModProject left, ModProject right)
    {
        return IsSamePath(left.ConfigPath, right.ConfigPath) ||
            IsSamePath(left.ProjectDirectory, right.ProjectDirectory) ||
            (!string.IsNullOrWhiteSpace(left.Id) &&
             string.Equals(left.Id, right.Id, StringComparison.OrdinalIgnoreCase));
    }

    private static bool IsSamePath(string left, string right)
    {
        return !string.IsNullOrWhiteSpace(left) &&
            !string.IsNullOrWhiteSpace(right) &&
            string.Equals(
                Path.GetFullPath(left).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar),
                Path.GetFullPath(right).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar),
                StringComparison.OrdinalIgnoreCase);
    }
}
