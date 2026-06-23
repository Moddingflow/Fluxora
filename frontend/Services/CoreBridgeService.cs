using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using Fluxora.App.Models;

namespace Fluxora.App.Services;

public sealed class CoreBridgeService : IAppService
{
    private const int NativePathBufferLength = 32768;
    private const int NativeJsonInitialBufferLength = 32 * 1024;
    private const int MaxNativeJsonBufferLength = 16 * 1024 * 1024;
    private readonly ApplicationLogService? logger;

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true
    };

    public bool IsCoreAvailable { get; private set; }
    public bool CanCreateProjectsNatively { get; private set; }
    public bool CanOpenProjectsNatively { get; private set; }
    public string InitializationError { get; private set; } = string.Empty;
    private bool initialized;

    public CoreBridgeService(ApplicationLogService? logger = null)
    {
        this.logger = logger;
    }

    private void ApplyNativeOperationContext()
    {
        try
        {
            NativeMethods.SetOperationContext(ApplicationLogService.CurrentOperationId);
        }
        catch (Exception exception) when (IsNativeLoadException(exception) || exception is EntryPointNotFoundException)
        {
        }
    }

    private void ClearNativeOperationContext()
    {
        try
        {
            NativeMethods.SetOperationContext(string.Empty);
        }
        catch (Exception exception) when (IsNativeLoadException(exception) || exception is EntryPointNotFoundException)
        {
        }
    }

    private T RunNative<T>(string operationName, Func<T> action)
    {
        ApplyNativeOperationContext();
        logger?.BridgeInfo("NativeBridge", $"{operationName} native call started.");
        try
        {
            T result = action();
            logger?.BridgeInfo("NativeBridge", $"{operationName} native call completed.");
            return result;
        }
        catch (Exception exception)
        {
            logger?.BridgeError("NativeBridge", $"{operationName} native call failed.", exception);
            throw;
        }
        finally
        {
            ClearNativeOperationContext();
        }
    }

    private void RunNative(string operationName, Action action)
    {
        RunNative(
            operationName,
            () =>
            {
                action();
                return true;
            });
    }

    private string ReadNativeJson(Func<StringBuilder, int> invoke, string operationName)
    {
        ApplyNativeOperationContext();
        logger?.BridgeInfo("NativeBridge", $"{operationName} native call started.");
        try
        {
            string json = ReadNativeJsonBuffer(invoke, operationName);
            logger?.BridgeInfo("NativeBridge", $"{operationName} native call completed.");
            return json;
        }
        finally
        {
            ClearNativeOperationContext();
        }
    }

    private string ReadNativeJsonBuffer(Func<StringBuilder, int> invoke, string operationName)
    {
        int bufferLength = NativeJsonInitialBufferLength;
        bool useBufferedOutput = false;
        bool bufferedOutputApiUnavailable = false;
        while (true)
        {
            StringBuilder json = new(bufferLength, bufferLength);
            int result;
            try
            {
                result = useBufferedOutput
                    ? NativeMethods.CopyLastOutput(json, json.Capacity)
                    : invoke(json);
            }
            catch (Exception exception) when (useBufferedOutput && IsNativeLoadException(exception))
            {
                bufferedOutputApiUnavailable = true;
                useBufferedOutput = false;
                result = invoke(json);
            }

            if (result == NativeResult.Ok)
            {
                return json.ToString();
            }

            if (result == NativeResult.BufferTooSmall && bufferLength < MaxNativeJsonBufferLength)
            {
                int nextBufferLength = NextNativeJsonBufferLength(bufferLength);
                logger?.BridgeWarning(
                    "NativeBridge",
                    $"{operationName} response exceeded {bufferLength} chars. Retrying with {nextBufferLength} chars.");
                bufferLength = nextBufferLength;
                useBufferedOutput = !bufferedOutputApiUnavailable;
                continue;
            }

            string nativeError = ReadLastNativeError(result);
            logger?.BridgeError(
                "NativeBridge",
                $"{operationName} native call failed. result={result}, error=\"{nativeError}\"");
            throw new InvalidOperationException(nativeError);
        }
    }

    private static int NextNativeJsonBufferLength(int currentBufferLength)
    {
        int requiredLength = TryGetLastNativeRequiredBufferLength();
        if (requiredLength > currentBufferLength)
        {
            return Math.Min(requiredLength, MaxNativeJsonBufferLength);
        }

        return Math.Min(currentBufferLength * 2, MaxNativeJsonBufferLength);
    }

    private static int TryGetLastNativeRequiredBufferLength()
    {
        try
        {
            return NativeMethods.GetLastRequiredBufferLength();
        }
        catch (Exception exception) when (IsNativeLoadException(exception) || exception is EntryPointNotFoundException)
        {
            return 0;
        }
    }

    public Task InitializeAsync(CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();

        if (initialized)
        {
            return Task.CompletedTask;
        }

        try
        {
            IsCoreAvailable = NativeMethods.CoreIsAvailable() == 1;
            CanCreateProjectsNatively = IsCoreAvailable;
            CanOpenProjectsNatively = IsCoreAvailable;
            InitializationError = string.Empty;
            logger?.BridgeInfo("NativeBridge", $"C++ core availability checked. available={IsCoreAvailable}");
        }
        catch (Exception exception) when (IsNativeLoadException(exception))
        {
            IsCoreAvailable = false;
            CanCreateProjectsNatively = false;
            CanOpenProjectsNatively = false;
            InitializationError = exception.Message;
            logger?.BridgeWarning("NativeBridge", "C++ core could not be loaded.", exception);
        }

        initialized = true;
        return Task.CompletedTask;
    }

    public string GetAppLanguageCode()
    {
        if (!IsCoreAvailable)
        {
            return string.Empty;
        }

        StringBuilder buffer = new(128);
        int result = NativeMethods.GetAppLanguage(buffer, buffer.Capacity);
        return result == NativeResult.Ok ? buffer.ToString() : string.Empty;
    }

    public Task SaveAppLanguageCodeAsync(string languageCode, CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();

        if (string.IsNullOrWhiteSpace(languageCode) || !IsCoreAvailable)
        {
            return Task.CompletedTask;
        }

        return Task.Run(
            () =>
            {
                cancellationToken.ThrowIfCancellationRequested();
                int result = NativeMethods.SetAppLanguage(languageCode);
                if (result != NativeResult.Ok)
                {
                    throw new InvalidOperationException(ReadLastNativeError(result));
                }
            },
            cancellationToken);
    }

    /// <summary>Game templates that can be layered on top of the base template.</summary>
    public IReadOnlyList<GameTemplateOption> GetGameTemplates()
    {
        if (!IsCoreAvailable)
        {
            return Array.Empty<GameTemplateOption>();
        }

        try
        {
            string json = ReadNativeJson(
                buffer => NativeMethods.GetGameTemplates(buffer, buffer.Capacity),
                "GetGameTemplates");
            List<GameTemplateOption> templates = JsonSerializer.Deserialize<List<GameTemplateOption>>(json, JsonOptions)
                ?? new List<GameTemplateOption>();
            foreach (GameTemplateOption template in templates)
            {
                NormalizeGameTemplate(template);
            }

            return templates;
        }
        catch (Exception exception) when (exception is JsonException or InvalidOperationException)
        {
            return Array.Empty<GameTemplateOption>();
        }
    }

    /// <summary>Resolve the base + game template for a template id.</summary>
    public ResolvedTemplate? ResolveTemplate(string templateId)
    {
        if (!IsCoreAvailable || string.IsNullOrWhiteSpace(templateId))
        {
            return null;
        }

        try
        {
            string json = ReadNativeJson(
                buffer => NativeMethods.ResolveTemplate(templateId, buffer, buffer.Capacity),
                "ResolveTemplate");
            ResolvedTemplate? template = JsonSerializer.Deserialize<ResolvedTemplate>(json, JsonOptions);
            NormalizeTemplate(template);
            return template;
        }
        catch (Exception exception) when (exception is JsonException or InvalidOperationException)
        {
            return null;
        }
    }

    public Task<string> BuildProjectDirectoryPreviewAsync(
        string projectName,
        string installRootDirectory,
        CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();

        if (!CanCreateProjectsNatively ||
            string.IsNullOrWhiteSpace(projectName) ||
            string.IsNullOrWhiteSpace(installRootDirectory))
        {
            return Task.FromResult(string.Empty);
        }

        return Task.Run(
            () =>
            {
                cancellationToken.ThrowIfCancellationRequested();
                string preview = RunNative(
                    "PreviewProjectDirectory",
                    () =>
                    {
                        StringBuilder buffer = new(NativePathBufferLength);
                        int result = NativeMethods.PreviewProjectDirectory(
                            projectName,
                            installRootDirectory,
                            buffer,
                            buffer.Capacity);

                        return result == NativeResult.Ok ? buffer.ToString() : string.Empty;
                    });
                cancellationToken.ThrowIfCancellationRequested();
                return preview;
            },
            cancellationToken);
    }

    public Task<ModProject> CreateProjectAsync(
        string name,
        ResolvedTemplate template,
        string gamePath,
        string installRootDirectory,
        CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();

        if (!CanCreateProjectsNatively)
        {
            throw new InvalidOperationException("C++ core is unavailable. Build backend and place FluxoraCore.dll next to the WPF app.");
        }

        return Task.Run(
            () =>
            {
                cancellationToken.ThrowIfCancellationRequested();
                return RunNative(
                    "CreateProject",
                    () =>
                    {
                        string json = ReadNativeJsonBuffer(
                            buffer => NativeMethods.CreateProject(
                                name,
                                template.Id,
                                gamePath,
                                installRootDirectory,
                                buffer,
                                buffer.Capacity),
                            "CreateProject");
                        return DeserializeModProject(json);
                    });
            },
            cancellationToken);
    }

    public Task<ModProject> OpenProjectFromConfigAsync(
        string configPath,
        CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();

        if (!CanOpenProjectsNatively)
        {
            throw new InvalidOperationException("C++ core is unavailable. Build backend and place FluxoraCore.dll next to the WPF app.");
        }

        if (string.IsNullOrWhiteSpace(configPath))
        {
            throw new ArgumentException("Build config path is required.", nameof(configPath));
        }

        return Task.Run(
            () =>
            {
                cancellationToken.ThrowIfCancellationRequested();
                return RunNative(
                    "OpenProjectConfig",
                    () =>
                    {
                        string json = ReadNativeJsonBuffer(
                            buffer => NativeMethods.OpenProjectConfig(configPath, buffer, buffer.Capacity),
                            "OpenProjectConfig");
                        return DeserializeModProject(json);
                    });
            },
            cancellationToken);
    }

    public Task<IReadOnlyList<ModProject>> ListProjectConfigsAsync(
        string buildConfigsDirectory,
        CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();

        if (!CanOpenProjectsNatively)
        {
            throw new InvalidOperationException("C++ core is unavailable. Build backend and place FluxoraCore.dll next to the WPF app.");
        }

        if (string.IsNullOrWhiteSpace(buildConfigsDirectory))
        {
            throw new ArgumentException("Build configs directory is required.", nameof(buildConfigsDirectory));
        }

        return Task.Run(
            () =>
            {
                cancellationToken.ThrowIfCancellationRequested();

                string json = ReadNativeJson(
                    buffer => NativeMethods.ListProjectConfigs(buildConfigsDirectory, buffer, buffer.Capacity),
                    "List project configs");
                return DeserializeModProjects(json);
            },
            cancellationToken);
    }

    public Task<ModProject> RenameProjectAsync(
        string configPath,
        string newName,
        CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();

        if (!CanOpenProjectsNatively)
        {
            throw new InvalidOperationException("C++ core is unavailable. Build backend and place FluxoraCore.dll next to the WPF app.");
        }

        if (string.IsNullOrWhiteSpace(configPath))
        {
            throw new ArgumentException("Build config path is required.", nameof(configPath));
        }

        if (string.IsNullOrWhiteSpace(newName))
        {
            throw new ArgumentException("Project name is required.", nameof(newName));
        }

        return Task.Run(
            () =>
            {
                cancellationToken.ThrowIfCancellationRequested();
                return RunNative(
                    "RenameProject",
                    () =>
                    {
                        string json = ReadNativeJsonBuffer(
                            buffer => NativeMethods.RenameProject(configPath, newName, buffer, buffer.Capacity),
                            "RenameProject");
                        return DeserializeModProject(json);
                    });
            },
            cancellationToken);
    }

    public Task DeleteProjectAsync(
        string configPath,
        CancellationToken cancellationToken = default)
    {
        return DeleteProjectAsync(configPath, progress: null, cancellationToken);
    }

    public Task<BuildPathSettings> GetBuildPathSettingsAsync(
        string configPath,
        CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        EnsureCoreAvailable();

        if (string.IsNullOrWhiteSpace(configPath))
        {
            throw new ArgumentException("Build config path is required.", nameof(configPath));
        }

        return Task.Run(
            () =>
            {
                cancellationToken.ThrowIfCancellationRequested();
                string json = ReadNativeJson(
                    buffer => NativeMethods.GetBuildPathSettings(configPath, buffer, buffer.Capacity),
                    "Get build path settings");
                return DeserializeBuildPathSettings(json);
            },
            cancellationToken);
    }

    public Task<BuildPathSettings> SaveBuildPathSettingsAsync(
        string configPath,
        BuildPathSettings settings,
        CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        EnsureCoreAvailable();

        if (string.IsNullOrWhiteSpace(configPath))
        {
            throw new ArgumentException("Build config path is required.", nameof(configPath));
        }

        ArgumentNullException.ThrowIfNull(settings);

        return Task.Run(
            () =>
            {
                cancellationToken.ThrowIfCancellationRequested();
                string payload = JsonSerializer.Serialize(settings, JsonOptions);
                string json = ReadNativeJson(
                    buffer => NativeMethods.SaveBuildPathSettings(configPath, payload, buffer, buffer.Capacity),
                    "Save build path settings");
                return DeserializeBuildPathSettings(json);
            },
            cancellationToken);
    }

    public Task<FluxPackSummary> ExportFluxPackAsync(
        string configPath,
        string outputPath,
        bool includeGeneratedAssets,
        CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        EnsureCoreAvailable();

        if (string.IsNullOrWhiteSpace(configPath))
        {
            throw new ArgumentException("Build config path is required.", nameof(configPath));
        }

        if (string.IsNullOrWhiteSpace(outputPath))
        {
            throw new ArgumentException("FluxPack output path is required.", nameof(outputPath));
        }

        return Task.Run(
            () =>
            {
                cancellationToken.ThrowIfCancellationRequested();
                string json = ReadNativeJson(
                    buffer => NativeMethods.ExportFluxPack(
                        configPath,
                        outputPath,
                        includeGeneratedAssets ? 1 : 0,
                        buffer,
                        buffer.Capacity),
                    "Export FluxPack");
                return DeserializeFluxPackSummary(json);
            },
            cancellationToken);
    }

    public Task<FluxPackSummary> InspectFluxPackAsync(
        string fluxPackPath,
        CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        EnsureCoreAvailable();

        if (string.IsNullOrWhiteSpace(fluxPackPath))
        {
            throw new ArgumentException("FluxPack path is required.", nameof(fluxPackPath));
        }

        return Task.Run(
            () =>
            {
                cancellationToken.ThrowIfCancellationRequested();
                string json = ReadNativeJson(
                    buffer => NativeMethods.InspectFluxPack(fluxPackPath, buffer, buffer.Capacity),
                    "Inspect FluxPack");
                return DeserializeFluxPackSummary(json);
            },
            cancellationToken);
    }

    public Task<FluxPackInstallResult> InstallFluxPackAsync(
        string fluxPackPath,
        string installRootDirectory,
        Action<FluxPackInstallProgress>? progress,
        CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        EnsureCoreAvailable();

        if (string.IsNullOrWhiteSpace(fluxPackPath))
        {
            throw new ArgumentException("FluxPack path is required.", nameof(fluxPackPath));
        }

        if (string.IsNullOrWhiteSpace(installRootDirectory))
        {
            throw new ArgumentException("Install root directory is required.", nameof(installRootDirectory));
        }

        return Task.Run(
            () =>
            {
                cancellationToken.ThrowIfCancellationRequested();

                NativeMethods.NativeProgressCallback? callback = null;
                if (progress is not null)
                {
                    callback = (json, _) =>
                    {
                        if (string.IsNullOrWhiteSpace(json))
                        {
                            return;
                        }

                        try
                        {
                            FluxPackInstallProgress? update =
                                JsonSerializer.Deserialize<FluxPackInstallProgress>(json, JsonOptions);
                            if (update is not null)
                            {
                                progress(update);
                            }
                        }
                        catch (JsonException)
                        {
                            logger?.BridgeWarning("NativeBridge", $"Invalid FluxPack install progress payload ignored. payloadLength={json.Length}");
                        }
                        catch (Exception exception)
                        {
                            logger?.BridgeWarning("NativeBridge", "Managed FluxPack install progress handler failed.", exception);
                        }
                    };
                }

                return RunNative(
                    "InstallFluxPack",
                    () =>
                    {
                        string json = ReadNativeJsonBuffer(
                            buffer => NativeMethods.InstallFluxPack(
                                fluxPackPath,
                                installRootDirectory,
                                callback,
                                IntPtr.Zero,
                                buffer,
                                buffer.Capacity),
                            "InstallFluxPack");
                        GC.KeepAlive(callback);
                        return DeserializeFluxPackInstallResult(json);
                    });
            },
            cancellationToken);
    }

    public Task DeleteProjectAsync(
        string configPath,
        Action<BuildDeletionProgress>? progress,
        CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();

        if (!CanOpenProjectsNatively)
        {
            throw new InvalidOperationException("C++ core is unavailable. Build backend and place FluxoraCore.dll next to the WPF app.");
        }

        if (string.IsNullOrWhiteSpace(configPath))
        {
            throw new ArgumentException("Build config path is required.", nameof(configPath));
        }

        return Task.Run(
            () =>
            {
                cancellationToken.ThrowIfCancellationRequested();

                NativeMethods.NativeProgressCallback? callback = null;
                if (progress is not null)
                {
                    callback = (json, _) =>
                    {
                        if (string.IsNullOrWhiteSpace(json))
                        {
                            return;
                        }

                        try
                        {
                            BuildDeletionProgress? update =
                                JsonSerializer.Deserialize<BuildDeletionProgress>(json, JsonOptions);
                            if (update is not null)
                            {
                                progress(update);
                            }
                        }
                        catch (JsonException)
                        {
                            logger?.BridgeWarning("NativeBridge", $"Invalid delete progress payload ignored. payloadLength={json.Length}");
                        }
                        catch (Exception exception)
                        {
                            logger?.BridgeWarning("NativeBridge", "Managed delete progress handler failed.", exception);
                        }
                    };
                }

                RunNative(
                    "DeleteProjectWithProgress",
                    () =>
                    {
                        int result = NativeMethods.DeleteProjectWithProgress(configPath, callback, IntPtr.Zero);
                        GC.KeepAlive(callback);
                        if (result != NativeResult.Ok)
                        {
                            throw new InvalidOperationException(ReadLastNativeError(result));
                        }
                    });
            },
            cancellationToken);
    }

    public Task<ModOrganizerImportAnalysis> AnalyzeModOrganizerInstanceAsync(
        string sourceDirectory,
        string destinationRootDirectory,
        string existingConfigPath = "",
        CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        EnsureCoreAvailable();

        if (string.IsNullOrWhiteSpace(sourceDirectory))
        {
            throw new ArgumentException("Mod Organizer 2 directory is required.", nameof(sourceDirectory));
        }

        if (string.IsNullOrWhiteSpace(destinationRootDirectory))
        {
            throw new ArgumentException("Destination root directory is required.", nameof(destinationRootDirectory));
        }

        return Task.Run(
            () =>
            {
                cancellationToken.ThrowIfCancellationRequested();
                logger?.BridgeInfo(
                    "MO2Import",
                    $"Analyzing Mod Organizer instance. source=\"{sourceDirectory}\", destinationRoot=\"{destinationRootDirectory}\", existingConfig=\"{existingConfigPath}\"");

                return RunNative(
                    "AnalyzeModOrganizerInstance",
                    () =>
                    {
                        try
                        {
                            string json = ReadNativeJsonBuffer(
                                buffer => NativeMethods.AnalyzeModOrganizerInstance(
                                    sourceDirectory,
                                    destinationRootDirectory,
                                    existingConfigPath ?? string.Empty,
                                    buffer,
                                    buffer.Capacity),
                                "AnalyzeModOrganizerInstance");
                            return DeserializeModOrganizerImportAnalysis(json);
                        }
                        catch (InvalidOperationException exception)
                        {
                            logger?.BridgeWarning(
                                "MO2Import",
                                $"Mod Organizer analysis failed. error=\"{exception.Message}\"");
                            throw;
                        }
                    });
            },
            cancellationToken);
    }

    public Task<ModProject> ImportModOrganizerInstanceAsync(
        string sourceDirectory,
        string destinationRootDirectory,
        string existingConfigPath,
        bool replaceExisting,
        Action<ModOrganizerImportProgress>? progress,
        CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        EnsureCoreAvailable();

        if (string.IsNullOrWhiteSpace(sourceDirectory))
        {
            throw new ArgumentException("Mod Organizer 2 directory is required.", nameof(sourceDirectory));
        }

        if (string.IsNullOrWhiteSpace(destinationRootDirectory))
        {
            throw new ArgumentException("Destination root directory is required.", nameof(destinationRootDirectory));
        }

        if (replaceExisting && string.IsNullOrWhiteSpace(existingConfigPath))
        {
            throw new ArgumentException("Existing build config path is required.", nameof(existingConfigPath));
        }

        return Task.Run(
            () =>
            {
                cancellationToken.ThrowIfCancellationRequested();
                logger?.BridgeInfo(
                    "MO2Import",
                    $"Starting Mod Organizer import. source=\"{sourceDirectory}\", destinationRoot=\"{destinationRootDirectory}\", existingConfig=\"{existingConfigPath}\", replaceExisting={replaceExisting}");

                NativeMethods.NativeProgressCallback? callback = null;
                if (progress is not null)
                {
                    callback = (json, _) =>
                    {
                        if (string.IsNullOrWhiteSpace(json))
                        {
                            return;
                        }

                        try
                        {
                            ModOrganizerImportProgress? update =
                                JsonSerializer.Deserialize<ModOrganizerImportProgress>(json, JsonOptions);
                            if (update is not null)
                            {
                                progress(update);
                            }
                        }
                        catch (JsonException)
                        {
                            logger?.BridgeWarning("MO2Import", $"Invalid native progress payload ignored. payloadLength={json.Length}");
                        }
                        catch (Exception exception)
                        {
                            // Never let managed progress handlers escape through the native callback boundary.
                            logger?.BridgeWarning("MO2Import", "Managed import progress handler failed.", exception);
                        }
                    };
                }

                return RunNative(
                    "ImportModOrganizerInstance",
                    () =>
                    {
                        try
                        {
                            string json = ReadNativeJsonBuffer(
                                buffer => NativeMethods.ImportModOrganizerInstance(
                                    sourceDirectory,
                                    destinationRootDirectory,
                                    existingConfigPath ?? string.Empty,
                                    replaceExisting ? 1 : 0,
                                    callback,
                                    IntPtr.Zero,
                                    buffer,
                                    buffer.Capacity),
                                "ImportModOrganizerInstance");
                            GC.KeepAlive(callback);
                            ModProject project = DeserializeModProject(json);
                            logger?.BridgeInfo(
                                "MO2Import",
                                $"Mod Organizer import completed. project=\"{project.Name}\", configPath=\"{project.ConfigPath}\"");
                            return project;
                        }
                        catch (InvalidOperationException exception)
                        {
                            logger?.BridgeError(
                                "MO2Import",
                                $"Mod Organizer import failed. source=\"{sourceDirectory}\", destinationRoot=\"{destinationRootDirectory}\", existingConfig=\"{existingConfigPath}\", replaceExisting={replaceExisting}, error=\"{exception.Message}\"");
                            throw;
                        }
                    });
            },
            cancellationToken);
    }

    public Task<IReadOnlyList<GameExecutableEntry>> GetGameExecutablesAsync(
        string configPath,
        CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        EnsureCoreAvailable();

        if (string.IsNullOrWhiteSpace(configPath))
        {
            throw new ArgumentException("Build config path is required.", nameof(configPath));
        }

        return Task.Run(
            () =>
            {
                cancellationToken.ThrowIfCancellationRequested();

                string json = ReadNativeJson(
                    buffer => NativeMethods.GetGameExecutables(configPath, buffer, buffer.Capacity),
                    "GetGameExecutables");
                return DeserializeGameExecutables(json);
            },
            cancellationToken);
    }

    public Task<IReadOnlyList<GameExecutableEntry>> SaveGameExecutablesAsync(
        string configPath,
        IEnumerable<GameExecutableEntry> executables,
        CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        EnsureCoreAvailable();

        if (string.IsNullOrWhiteSpace(configPath))
        {
            throw new ArgumentException("Build config path is required.", nameof(configPath));
        }

        return Task.Run(
            () =>
            {
                cancellationToken.ThrowIfCancellationRequested();

                string payload = JsonSerializer.Serialize(executables, JsonOptions);
                string json = ReadNativeJson(
                    buffer => NativeMethods.SaveGameExecutables(configPath, payload, buffer, buffer.Capacity),
                    "SaveGameExecutables");
                return DeserializeGameExecutables(json);
            },
            cancellationToken);
    }

    public Task<GameExecutableLaunchResult> LaunchGameExecutableAsync(
        string configPath,
        string executableId,
        CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        EnsureCoreAvailable();

        if (string.IsNullOrWhiteSpace(configPath))
        {
            throw new ArgumentException("Build config path is required.", nameof(configPath));
        }

        if (string.IsNullOrWhiteSpace(executableId))
        {
            throw new ArgumentException("Executable id is required.", nameof(executableId));
        }

        return Task.Run(
            () =>
            {
                cancellationToken.ThrowIfCancellationRequested();

                return RunNative(
                    "LaunchGameExecutable",
                    () =>
                    {
                        string json = ReadNativeJsonBuffer(
                            buffer => NativeMethods.LaunchGameExecutable(configPath, executableId, buffer, buffer.Capacity),
                            "LaunchGameExecutable");
                        return DeserializeGameExecutableLaunchResult(json);
                    });
            },
            cancellationToken);
    }

    public string ResolveExecutableIconPath(string executablePath)
    {
        if (!IsCoreAvailable || string.IsNullOrWhiteSpace(executablePath))
        {
            return string.Empty;
        }

        try
        {
            StringBuilder buffer = new(NativePathBufferLength);
            int result = NativeMethods.GetExecutableIcon(executablePath, buffer, buffer.Capacity);
            return result == NativeResult.Ok ? buffer.ToString() : string.Empty;
        }
        catch (Exception exception) when (IsNativeLoadException(exception))
        {
            return string.Empty;
        }
    }

    public NexusModsAuthStatus GetNexusModsAuthStatus()
    {
        if (!IsCoreAvailable)
        {
            return new NexusModsAuthStatus
            {
                Message = "C++ core недоступен. Сначала соберите backend и положите FluxoraCore.dll рядом с приложением."
            };
        }

        try
        {
            string json = ReadNativeJson(
                buffer => NativeMethods.GetNexusModsAuthStatus(buffer, buffer.Capacity),
                "GetNexusModsAuthStatus");
            return DeserializeNexusModsAuthStatus(json);
        }
        catch (InvalidOperationException exception)
        {
            return new NexusModsAuthStatus
            {
                Message = exception.Message
            };
        }
    }

    public Task<NexusModsAuthStatus> ConnectNexusModsAsync(CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();

        if (!IsCoreAvailable)
        {
            throw new InvalidOperationException("C++ core недоступен. Сначала соберите backend и положите FluxoraCore.dll рядом с приложением.");
        }

        return Task.Run(
            () =>
            {
                cancellationToken.ThrowIfCancellationRequested();

                string json = ReadNativeJson(
                    buffer => NativeMethods.ConnectNexusMods(buffer, buffer.Capacity),
                    "ConnectNexusMods");
                return DeserializeNexusModsAuthStatus(json);
            },
            cancellationToken);
    }

    public Task<NexusModsAuthStatus> DisconnectNexusModsAsync(CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();

        if (!IsCoreAvailable)
        {
            throw new InvalidOperationException("C++ core недоступен. Сначала соберите backend и положите FluxoraCore.dll рядом с приложением.");
        }

        return Task.Run(
            () =>
            {
                cancellationToken.ThrowIfCancellationRequested();

                string json = ReadNativeJson(
                    buffer => NativeMethods.DisconnectNexusMods(buffer, buffer.Capacity),
                    "DisconnectNexusMods");
                return DeserializeNexusModsAuthStatus(json);
            },
            cancellationToken);
    }

    public bool RegisterNxmProtocol(string executablePath)
    {
        if (!IsCoreAvailable || string.IsNullOrWhiteSpace(executablePath))
        {
            return false;
        }

        try
        {
            string json = ReadNativeJson(
                buffer => NativeMethods.RegisterNxmProtocol(executablePath, buffer, buffer.Capacity),
                "RegisterNxmProtocol");
            NxmProtocolStatus? status = JsonSerializer.Deserialize<NxmProtocolStatus>(json, JsonOptions);
            return status?.IsRegistered == true;
        }
        catch (Exception exception) when (exception is JsonException or InvalidOperationException)
        {
            return false;
        }
    }

    public Task<IReadOnlyList<ModEntry>> GetInstalledModsAsync(
        string projectDirectory,
        CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        EnsureCoreAvailable();

        return Task.Run(
            () =>
            {
                cancellationToken.ThrowIfCancellationRequested();

                string json = ReadNativeJson(
                    buffer => NativeMethods.GetInstalledMods(projectDirectory, buffer, buffer.Capacity),
                    "GetInstalledMods");
                return DeserializeMods(json);
            },
            cancellationToken);
    }

    public Task<IReadOnlyList<ModEntry>> GetModOrderAsync(
        string projectDirectory,
        string profileName,
        CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        EnsureCoreAvailable();

        return Task.Run(
            () =>
            {
                cancellationToken.ThrowIfCancellationRequested();

                string json = ReadNativeJson(
                    buffer => NativeMethods.GetModOrder(projectDirectory, profileName, buffer, buffer.Capacity),
                    "GetModOrder");
                return DeserializeMods(json);
            },
            cancellationToken);
    }

    public Task<IReadOnlyList<ModEntry>> CreateModSeparatorAsync(
        string projectDirectory,
        string profileName,
        string title,
        int targetIndex,
        CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        EnsureCoreAvailable();

        return Task.Run(
            () =>
            {
                cancellationToken.ThrowIfCancellationRequested();

                string json = ReadNativeJson(
                    buffer => NativeMethods.CreateModSeparator(
                        projectDirectory,
                        profileName,
                        title,
                        targetIndex,
                        buffer,
                        buffer.Capacity),
                    "CreateModSeparator");
                return DeserializeMods(json);
            },
            cancellationToken);
    }

    public Task<IReadOnlyList<ModEntry>> DeleteModSeparatorAsync(
        string projectDirectory,
        string profileName,
        string separatorId,
        CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        EnsureCoreAvailable();

        return Task.Run(
            () =>
            {
                cancellationToken.ThrowIfCancellationRequested();

                string json = ReadNativeJson(
                    buffer => NativeMethods.DeleteModSeparator(
                        projectDirectory,
                        profileName,
                        separatorId,
                        buffer,
                        buffer.Capacity),
                    "DeleteModSeparator");
                return DeserializeMods(json);
            },
            cancellationToken);
    }

    public Task<IReadOnlyList<ModEntry>> MoveModOrderItemAsync(
        string projectDirectory,
        string profileName,
        string orderItemId,
        int targetIndex,
        CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        EnsureCoreAvailable();

        return Task.Run(
            () =>
            {
                cancellationToken.ThrowIfCancellationRequested();

                string json = ReadNativeJson(
                    buffer => NativeMethods.MoveModOrderItem(
                        projectDirectory,
                        profileName,
                        orderItemId,
                        targetIndex,
                        buffer,
                        buffer.Capacity),
                    "MoveModOrderItem");
                return DeserializeMods(json);
            },
            cancellationToken);
    }

    public Task DeleteInstalledModAsync(
        string projectDirectory,
        string modPath,
        CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        EnsureCoreAvailable();

        return Task.Run(
            () =>
            {
                cancellationToken.ThrowIfCancellationRequested();

                RunNative(
                    "DeleteInstalledMod",
                    () =>
                    {
                        int result = NativeMethods.DeleteInstalledMod(projectDirectory, modPath);
                        if (result != NativeResult.Ok)
                        {
                            throw new InvalidOperationException(ReadLastNativeError(result));
                        }
                    });
            },
            cancellationToken);
    }

    public Task<ModEntry> CreateEmptyModAsync(
        string projectDirectory,
        string modName,
        CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        EnsureCoreAvailable();

        return Task.Run(
            () =>
            {
                cancellationToken.ThrowIfCancellationRequested();

                return RunNative(
                    "CreateEmptyMod",
                    () =>
                    {
                        string json = ReadNativeJsonBuffer(
                            buffer => NativeMethods.CreateEmptyMod(projectDirectory, modName, buffer, buffer.Capacity),
                            "CreateEmptyMod");
                        return DeserializeModEntry(json);
                    });
            },
            cancellationToken);
    }

    public Task SetInstalledModEnabledAsync(
        string projectDirectory,
        string modPath,
        bool isEnabled,
        CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        EnsureCoreAvailable();

        return Task.Run(
            () =>
            {
                cancellationToken.ThrowIfCancellationRequested();

                RunNative(
                    "SetInstalledModEnabled",
                    () =>
                    {
                        int result = NativeMethods.SetInstalledModEnabled(projectDirectory, modPath, isEnabled ? 1 : 0);
                        if (result != NativeResult.Ok)
                        {
                            throw new InvalidOperationException(ReadLastNativeError(result));
                        }
                    });
            },
            cancellationToken);
    }

    public Task SetAllInstalledModsEnabledAsync(
        string projectDirectory,
        bool isEnabled,
        CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        EnsureCoreAvailable();

        return Task.Run(
            () =>
            {
                cancellationToken.ThrowIfCancellationRequested();

                RunNative(
                    "SetAllInstalledModsEnabled",
                    () =>
                    {
                        int result = NativeMethods.SetAllInstalledModsEnabled(projectDirectory, isEnabled ? 1 : 0);
                        if (result != NativeResult.Ok)
                        {
                            throw new InvalidOperationException(ReadLastNativeError(result));
                        }
                    });
            },
            cancellationToken);
    }

    public Task<IReadOnlyList<ModEntry>> CheckModUpdatesAsync(
        string projectDirectory,
        CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        EnsureCoreAvailable();

        return Task.Run(
            () =>
            {
                cancellationToken.ThrowIfCancellationRequested();

                string json = ReadNativeJson(
                    buffer => NativeMethods.CheckModUpdates(projectDirectory, buffer, buffer.Capacity),
                    "CheckModUpdates");
                return DeserializeMods(json);
            },
            cancellationToken);
    }

    public Task<IReadOnlyList<ModFileTreeEntry>> GetModFileTreeAsync(
        string projectDirectory,
        string modPath,
        string relativeDirectory,
        CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        EnsureCoreAvailable();

        return Task.Run(
            () =>
            {
                cancellationToken.ThrowIfCancellationRequested();

                string json = ReadNativeJson(
                    buffer => NativeMethods.GetModFileTree(
                        projectDirectory,
                        modPath,
                        relativeDirectory,
                        buffer,
                        buffer.Capacity),
                    "GetModFileTree");
                return DeserializeModFileTree(json);
            },
            cancellationToken);
    }

    public Task<IReadOnlyList<PluginEntry>> GetPluginsAsync(
        string projectDirectory,
        string templateId,
        string profileName,
        CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        EnsureCoreAvailable();

        return Task.Run(
            () =>
            {
                cancellationToken.ThrowIfCancellationRequested();

                string json = ReadNativeJson(
                    buffer => NativeMethods.GetPlugins(projectDirectory, templateId, profileName, buffer, buffer.Capacity),
                    "GetPlugins");
                return DeserializePlugins(json);
            },
            cancellationToken);
    }

    public Task<IReadOnlyList<PluginEntry>> MovePluginAsync(
        string projectDirectory,
        string templateId,
        string profileName,
        string orderItemId,
        int targetIndex,
        CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        EnsureCoreAvailable();

        return Task.Run(
            () =>
            {
                cancellationToken.ThrowIfCancellationRequested();

                string json = ReadNativeJson(
                    buffer => NativeMethods.MovePlugin(
                        projectDirectory,
                        templateId,
                        profileName,
                        orderItemId,
                        targetIndex,
                        buffer,
                        buffer.Capacity),
                    "MovePlugin");
                return DeserializePlugins(json);
            },
            cancellationToken);
    }

    public Task<IReadOnlyList<PluginEntry>> CreatePluginSeparatorAsync(
        string projectDirectory,
        string templateId,
        string profileName,
        string title,
        int targetIndex,
        CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        EnsureCoreAvailable();

        return Task.Run(
            () =>
            {
                cancellationToken.ThrowIfCancellationRequested();

                string json = ReadNativeJson(
                    buffer => NativeMethods.CreatePluginSeparator(
                        projectDirectory,
                        templateId,
                        profileName,
                        title,
                        targetIndex,
                        buffer,
                        buffer.Capacity),
                    "CreatePluginSeparator");
                return DeserializePlugins(json);
            },
            cancellationToken);
    }

    public Task<IReadOnlyList<PluginEntry>> DeletePluginSeparatorAsync(
        string projectDirectory,
        string templateId,
        string profileName,
        string separatorId,
        CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        EnsureCoreAvailable();

        return Task.Run(
            () =>
            {
                cancellationToken.ThrowIfCancellationRequested();

                string json = ReadNativeJson(
                    buffer => NativeMethods.DeletePluginSeparator(
                        projectDirectory,
                        templateId,
                        profileName,
                        separatorId,
                        buffer,
                        buffer.Capacity),
                    "DeletePluginSeparator");
                return DeserializePlugins(json);
            },
            cancellationToken);
    }

    public Task<IReadOnlyList<PluginEntry>> SetPluginEnabledAsync(
        string projectDirectory,
        string templateId,
        string profileName,
        string pluginName,
        bool isEnabled,
        CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        EnsureCoreAvailable();

        return Task.Run(
            () =>
            {
                cancellationToken.ThrowIfCancellationRequested();

                string json = ReadNativeJson(
                    buffer => NativeMethods.SetPluginEnabled(
                        projectDirectory,
                        templateId,
                        profileName,
                        pluginName,
                        isEnabled ? 1 : 0,
                        buffer,
                        buffer.Capacity),
                    "SetPluginEnabled");
                return DeserializePlugins(json);
            },
            cancellationToken);
    }

    public Task<IReadOnlyList<DownloadEntry>> GetDownloadsAsync(
        string projectDirectory,
        CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        EnsureCoreAvailable();

        return Task.Run(
            () =>
            {
                cancellationToken.ThrowIfCancellationRequested();

                string json = ReadNativeJson(
                    buffer => NativeMethods.GetDownloads(projectDirectory, buffer, buffer.Capacity),
                    "GetDownloads");
                return DeserializeDownloads(json);
            },
            cancellationToken);
    }

    public Task<IReadOnlyList<DownloadEntry>> CaptureNxmLinksAsync(
        string projectDirectory,
        IEnumerable<string> nxmLinks,
        CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        EnsureCoreAvailable();

        string linksJson = JsonSerializer.Serialize(nxmLinks.Distinct(StringComparer.OrdinalIgnoreCase), JsonOptions);
        return Task.Run(
            () =>
            {
                cancellationToken.ThrowIfCancellationRequested();

                string json = ReadNativeJson(
                    buffer => NativeMethods.CaptureNxmLinks(projectDirectory, linksJson, buffer, buffer.Capacity),
                    "CaptureNxmLinks");
                return DeserializeDownloads(json);
            },
            cancellationToken);
    }

    public Task<IReadOnlyList<DownloadEntry>> ImportInboundDownloadsAsync(
        string projectDirectory,
        CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        EnsureCoreAvailable();

        return Task.Run(
            () =>
            {
                cancellationToken.ThrowIfCancellationRequested();

                string json = ReadNativeJson(
                    buffer => NativeMethods.ImportInboundDownloads(projectDirectory, buffer, buffer.Capacity),
                    "ImportInboundDownloads");
                return DeserializeDownloads(json);
            },
            cancellationToken);
    }

    public Task<DownloadEntry> ImportDownloadFileAsync(
        string projectDirectory,
        string sourcePath,
        CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        EnsureCoreAvailable();

        return Task.Run(
            () =>
            {
                cancellationToken.ThrowIfCancellationRequested();

                return RunNative(
                    "ImportDownloadFile",
                    () =>
                    {
                        string json = ReadNativeJsonBuffer(
                            buffer => NativeMethods.ImportDownloadFile(projectDirectory, sourcePath, buffer, buffer.Capacity),
                            "ImportDownloadFile");
                        return DeserializeDownload(json);
                    });
            },
            cancellationToken);
    }

    public Task DeleteDownloadAsync(
        string projectDirectory,
        string downloadPath,
        CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        EnsureCoreAvailable();

        return Task.Run(
            () =>
            {
                cancellationToken.ThrowIfCancellationRequested();

                RunNative(
                    "DeleteDownload",
                    () =>
                    {
                        int result = NativeMethods.DeleteDownload(projectDirectory, downloadPath);
                        if (result != NativeResult.Ok)
                        {
                            throw new InvalidOperationException(ReadLastNativeError(result));
                        }
                    });
            },
            cancellationToken);
    }

    public Task CancelDownloadAsync(
        string projectDirectory,
        string downloadPath,
        CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        EnsureCoreAvailable();

        return Task.Run(
            () =>
            {
                cancellationToken.ThrowIfCancellationRequested();

                RunNative(
                    "CancelDownload",
                    () =>
                    {
                        int result = NativeMethods.CancelDownload(projectDirectory, downloadPath);
                        if (result != NativeResult.Ok)
                        {
                            throw new InvalidOperationException(ReadLastNativeError(result));
                        }
                    });
            },
            cancellationToken);
    }

    public Task<DownloadEntry> ResumeDownloadAsync(
        string projectDirectory,
        string downloadPath,
        CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        EnsureCoreAvailable();

        return Task.Run(
            () =>
            {
                cancellationToken.ThrowIfCancellationRequested();

                return RunNative(
                    "ResumeDownload",
                    () =>
                    {
                        string json = ReadNativeJsonBuffer(
                            buffer => NativeMethods.ResumeDownload(projectDirectory, downloadPath, buffer, buffer.Capacity),
                            "ResumeDownload");
                        return DeserializeDownload(json);
                    });
            },
            cancellationToken);
    }

    public Task<ModEntry> InstallDownloadAsync(
        string projectDirectory,
        string downloadPath,
        string modName,
        ExistingModInstallMode existingModMode,
        IReadOnlyList<PlacementOverride>? placementOverrides = null,
        CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        EnsureCoreAvailable();

        return Task.Run(
            () =>
            {
                cancellationToken.ThrowIfCancellationRequested();
                string placementOverridesJson = SerializePlacementOverrides(placementOverrides);

                return RunNative(
                    "InstallDownload",
                    () =>
                    {
                        string json = ReadNativeJsonBuffer(
                            buffer => NativeMethods.InstallDownloadWithLayout(
                                projectDirectory,
                                downloadPath,
                                modName,
                                (int)existingModMode,
                                placementOverridesJson,
                                buffer,
                                buffer.Capacity),
                            "InstallDownload");
                        return DeserializeModEntry(json);
                    });
            },
            cancellationToken);
    }

    public Task<ModEntry> InstallArchiveAsync(
        string projectDirectory,
        string archivePath,
        string modName,
        ExistingModInstallMode existingModMode,
        IReadOnlyList<PlacementOverride>? placementOverrides = null,
        CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        EnsureCoreAvailable();

        return Task.Run(
            () =>
            {
                cancellationToken.ThrowIfCancellationRequested();
                string placementOverridesJson = SerializePlacementOverrides(placementOverrides);

                return RunNative(
                    "InstallArchive",
                    () =>
                    {
                        string json = ReadNativeJsonBuffer(
                            buffer => NativeMethods.InstallArchiveWithLayout(
                                projectDirectory,
                                archivePath,
                                modName,
                                (int)existingModMode,
                                placementOverridesJson,
                                buffer,
                                buffer.Capacity),
                            "InstallArchive");
                        return DeserializeModEntry(json);
                    });
            },
            cancellationToken);
    }

    public Task<ContentLayoutPreview> AnalyzeDownloadContentLayoutAsync(
        string projectDirectory,
        string downloadPath,
        ExistingModInstallMode existingModMode,
        CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        EnsureCoreAvailable();

        return Task.Run(
            () =>
            {
                cancellationToken.ThrowIfCancellationRequested();

                return RunNative(
                    "AnalyzeDownloadContentLayout",
                    () =>
                    {
                        string json = ReadNativeJsonBuffer(
                            buffer => NativeMethods.AnalyzeDownloadContentLayout(
                                projectDirectory,
                                downloadPath,
                                (int)existingModMode,
                                buffer,
                                buffer.Capacity),
                            "AnalyzeDownloadContentLayout");
                        return DeserializeContentLayoutPreview(json);
                    });
            },
            cancellationToken);
    }

    public Task<FomodInstallerInfo> AnalyzeFomodDownloadAsync(
        string projectDirectory,
        string downloadPath,
        CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        EnsureCoreAvailable();

        return Task.Run(
            () =>
            {
                cancellationToken.ThrowIfCancellationRequested();

                return RunNative(
                    "AnalyzeFomodDownload",
                    () =>
                    {
                        string json = ReadNativeJsonBuffer(
                            buffer => NativeMethods.AnalyzeFomodDownload(projectDirectory, downloadPath, buffer, buffer.Capacity),
                            "AnalyzeFomodDownload");
                        return DeserializeFomodInstaller(json);
                    });
            },
            cancellationToken);
    }

    public Task<ContentLayoutPreview> AnalyzeFomodDownloadContentLayoutAsync(
        string projectDirectory,
        string downloadPath,
        ExistingModInstallMode existingModMode,
        IReadOnlyList<string> selectedOptionIds,
        CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        EnsureCoreAvailable();

        return Task.Run(
            () =>
            {
                cancellationToken.ThrowIfCancellationRequested();
                string selectedOptionIdsJson = JsonSerializer.Serialize(selectedOptionIds, JsonOptions);

                return RunNative(
                    "AnalyzeFomodDownloadContentLayout",
                    () =>
                    {
                        string json = ReadNativeJsonBuffer(
                            buffer => NativeMethods.AnalyzeFomodDownloadContentLayout(
                                projectDirectory,
                                downloadPath,
                                (int)existingModMode,
                                selectedOptionIdsJson,
                                buffer,
                                buffer.Capacity),
                            "AnalyzeFomodDownloadContentLayout");
                        return DeserializeContentLayoutPreview(json);
                    });
            },
            cancellationToken);
    }

    public Task<ModEntry> InstallFomodDownloadAsync(
        string projectDirectory,
        string downloadPath,
        string modName,
        ExistingModInstallMode existingModMode,
        IReadOnlyList<string> selectedOptionIds,
        IReadOnlyList<PlacementOverride>? placementOverrides = null,
        CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        EnsureCoreAvailable();

        return Task.Run(
            () =>
            {
                cancellationToken.ThrowIfCancellationRequested();
                string selectedOptionIdsJson = JsonSerializer.Serialize(selectedOptionIds, JsonOptions);
                string placementOverridesJson = SerializePlacementOverrides(placementOverrides);

                return RunNative(
                    "InstallFomodDownload",
                    () =>
                    {
                        string json = ReadNativeJsonBuffer(
                            buffer => NativeMethods.InstallFomodDownloadWithLayout(
                                projectDirectory,
                                downloadPath,
                                modName,
                                (int)existingModMode,
                                selectedOptionIdsJson,
                                placementOverridesJson,
                                buffer,
                                buffer.Capacity),
                            "InstallFomodDownload");
                        return DeserializeModEntry(json);
                    });
            },
            cancellationToken);
    }

    public Task<ModEntry> InstallFomodArchiveAsync(
        string projectDirectory,
        string archivePath,
        string modName,
        ExistingModInstallMode existingModMode,
        IReadOnlyList<string> selectedOptionIds,
        IReadOnlyList<PlacementOverride>? placementOverrides = null,
        CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        EnsureCoreAvailable();

        return Task.Run(
            () =>
            {
                cancellationToken.ThrowIfCancellationRequested();
                string selectedOptionIdsJson = JsonSerializer.Serialize(selectedOptionIds, JsonOptions);
                string placementOverridesJson = SerializePlacementOverrides(placementOverrides);

                return RunNative(
                    "InstallFomodArchive",
                    () =>
                    {
                        string json = ReadNativeJsonBuffer(
                            buffer => NativeMethods.InstallFomodArchiveWithLayout(
                                projectDirectory,
                                archivePath,
                                modName,
                                (int)existingModMode,
                                selectedOptionIdsJson,
                                placementOverridesJson,
                                buffer,
                                buffer.Capacity),
                            "InstallFomodArchive");
                        return DeserializeModEntry(json);
                    });
            },
            cancellationToken);
    }

    private static NexusModsAuthStatus DeserializeNexusModsAuthStatus(string json)
    {
        try
        {
            return JsonSerializer.Deserialize<NexusModsAuthStatus>(json, JsonOptions)
                ?? new NexusModsAuthStatus();
        }
        catch (JsonException exception)
        {
            return new NexusModsAuthStatus
            {
                Message = $"Native core returned an invalid NexusMods auth status: {exception.Message}"
            };
        }
    }

    private static ModProject DeserializeModProject(string json)
    {
        try
        {
            ModProject? project = JsonSerializer.Deserialize<ModProject>(json, JsonOptions);
            if (project is null)
            {
                throw new InvalidOperationException("Native core returned an empty project descriptor.");
            }

            NormalizeProjectPaths(project);
            return project;
        }
        catch (JsonException exception)
        {
            throw new InvalidOperationException("Native core returned an invalid project descriptor.", exception);
        }
    }

    private static IReadOnlyList<ModProject> DeserializeModProjects(string json)
    {
        try
        {
            List<ModProject> projects = JsonSerializer.Deserialize<List<ModProject>>(json, JsonOptions)
                ?? new List<ModProject>();
            foreach (ModProject project in projects)
            {
                NormalizeProjectPaths(project);
            }

            return projects;
        }
        catch (JsonException exception)
        {
            throw new InvalidOperationException("Native core returned an invalid project catalog.", exception);
        }
    }

    private static BuildPathSettings DeserializeBuildPathSettings(string json)
    {
        try
        {
            return JsonSerializer.Deserialize<BuildPathSettings>(json, JsonOptions)
                ?? throw new InvalidOperationException("Native core returned empty build path settings.");
        }
        catch (JsonException exception)
        {
            throw new InvalidOperationException("Native core returned invalid build path settings.", exception);
        }
    }

    private static FluxPackSummary DeserializeFluxPackSummary(string json)
    {
        try
        {
            return JsonSerializer.Deserialize<FluxPackSummary>(json, JsonOptions)
                ?? throw new InvalidOperationException("Native core returned empty FluxPack summary.");
        }
        catch (JsonException exception)
        {
            throw new InvalidOperationException("Native core returned invalid FluxPack summary.", exception);
        }
    }

    private static FluxPackInstallResult DeserializeFluxPackInstallResult(string json)
    {
        try
        {
            return JsonSerializer.Deserialize<FluxPackInstallResult>(json, JsonOptions)
                ?? throw new InvalidOperationException("Native core returned empty FluxPack install result.");
        }
        catch (JsonException exception)
        {
            throw new InvalidOperationException("Native core returned invalid FluxPack install result.", exception);
        }
    }

    private static void NormalizeProjectPaths(ModProject project)
    {
        project.Paths ??= new BuildPathSettings();
        project.Paths.ApplyFallbacks(project.ProjectDirectory, project.GamePath);
        project.GamePath = project.Paths.GameDirectory;
        project.Executables ??= new List<GameExecutableEntry>();
        project.GameCapabilities ??= new GameCapabilities();
        NormalizeGameCapabilities(project.GameCapabilities);
        project.GameHealthSummary ??= new GameHealthSummary();
        NormalizeGameHealthSummary(project.GameHealthSummary);
        project.ContentLayoutSummary ??= new ContentLayoutSummary();
        NormalizeContentLayoutSummary(project.ContentLayoutSummary);
        NormalizeTemplate(project.Template);
        foreach (GameExecutableEntry executable in project.Executables)
        {
            executable.ExecutableDisplayMetadata ??= new ExecutableDisplayMetadata();
        }
    }

    private static void NormalizeGameTemplate(GameTemplateOption template)
    {
        template.GameCapabilities ??= new GameCapabilities();
        NormalizeGameCapabilities(template.GameCapabilities);
        template.ArchiveExtensions ??= new List<string>();
        template.RequiredFiles ??= new List<string>();
    }

    private static void NormalizeTemplate(ResolvedTemplate? template)
    {
        if (template is null)
        {
            return;
        }

        template.Folders ??= new List<string>();
        template.ProfileFiles ??= new List<string>();
        template.BasePlugins ??= new List<string>();
        template.PluginExtensions ??= new List<string>();
        template.ArchiveExtensions ??= new List<string>();
        template.RequiredFiles ??= new List<string>();
        template.Executables ??= new List<string>();
        template.Capabilities ??= new List<TemplateCapability>();
        template.GameCapabilities ??= new GameCapabilities();
        NormalizeGameCapabilities(template.GameCapabilities);
        template.ContentLayoutSummary ??= new ContentLayoutSummary();
        NormalizeContentLayoutSummary(template.ContentLayoutSummary);
        template.ExecutableDisplayMetadata ??= new List<ExecutableDisplayMetadata>();
        template.LaunchTrackingMetadata ??= new LaunchTrackingMetadata();
        NormalizeLaunchTrackingMetadata(template.LaunchTrackingMetadata);
    }

    private static void NormalizeGameCapabilities(GameCapabilities capabilities)
    {
        capabilities.Enabled ??= new List<string>();
    }

    private static void NormalizeGameHealthSummary(GameHealthSummary health)
    {
        health.MatchedFiles ??= new List<string>();
        health.MissingFiles ??= new List<string>();
        health.Warnings ??= new List<string>();
        health.Findings ??= new List<GameHealthFinding>();
    }

    private static void NormalizeContentLayoutSummary(ContentLayoutSummary summary)
    {
        summary.PluginExtensions ??= new List<string>();
        summary.ArchiveExtensions ??= new List<string>();
        summary.ScriptExtenderLoaders ??= new List<string>();
        summary.GameDataDirectories ??= new List<string>();
        summary.ScriptExtenderDataPaths ??= new List<string>();
        summary.Details ??= new List<string>();
        summary.Warnings ??= new List<string>();
        summary.Blockers ??= new List<string>();
    }

    private static void NormalizeLaunchTrackingMetadata(LaunchTrackingMetadata metadata)
    {
        metadata.ExpectedChildProcessNames ??= new List<string>();
    }

    private static IReadOnlyList<GameExecutableEntry> DeserializeGameExecutables(string json)
    {
        try
        {
            return JsonSerializer.Deserialize<List<GameExecutableEntry>>(json, JsonOptions)
                ?? new List<GameExecutableEntry>();
        }
        catch (JsonException exception)
        {
            throw new InvalidOperationException("Native core returned an invalid executable list.", exception);
        }
    }

    private static GameExecutableLaunchResult DeserializeGameExecutableLaunchResult(string json)
    {
        try
        {
            return JsonSerializer.Deserialize<GameExecutableLaunchResult>(json, JsonOptions)
                ?? throw new InvalidOperationException("Native core returned an empty executable launch result.");
        }
        catch (JsonException exception)
        {
            throw new InvalidOperationException("Native core returned an invalid executable launch result.", exception);
        }
    }

    private static ModOrganizerImportAnalysis DeserializeModOrganizerImportAnalysis(string json)
    {
        try
        {
            return JsonSerializer.Deserialize<ModOrganizerImportAnalysis>(json, JsonOptions)
                ?? throw new InvalidOperationException("Native core returned an empty Mod Organizer import analysis.");
        }
        catch (JsonException exception)
        {
            throw new InvalidOperationException("Native core returned an invalid Mod Organizer import analysis.", exception);
        }
    }

    private static IReadOnlyList<DownloadEntry> DeserializeDownloads(string json)
    {
        try
        {
            return JsonSerializer.Deserialize<List<DownloadEntry>>(json, JsonOptions)
                ?? new List<DownloadEntry>();
        }
        catch (JsonException exception)
        {
            throw new InvalidOperationException("Native core returned an invalid download list.", exception);
        }
    }

    private static IReadOnlyList<ModEntry> DeserializeMods(string json)
    {
        try
        {
            return JsonSerializer.Deserialize<List<ModEntry>>(json, JsonOptions)
                ?? new List<ModEntry>();
        }
        catch (JsonException exception)
        {
            throw new InvalidOperationException("Native core returned an invalid mod list.", exception);
        }
    }

    private static IReadOnlyList<PluginEntry> DeserializePlugins(string json)
    {
        try
        {
            return JsonSerializer.Deserialize<List<PluginEntry>>(json, JsonOptions)
                ?? new List<PluginEntry>();
        }
        catch (JsonException exception)
        {
            throw new InvalidOperationException("Native core returned an invalid plugin list.", exception);
        }
    }

    private static IReadOnlyList<ModFileTreeEntry> DeserializeModFileTree(string json)
    {
        try
        {
            return JsonSerializer.Deserialize<List<ModFileTreeEntry>>(json, JsonOptions)
                ?? new List<ModFileTreeEntry>();
        }
        catch (JsonException exception)
        {
            throw new InvalidOperationException("Native core returned an invalid mod file tree.", exception);
        }
    }

    private static DownloadEntry DeserializeDownload(string json)
    {
        try
        {
            return JsonSerializer.Deserialize<DownloadEntry>(json, JsonOptions)
                ?? throw new InvalidOperationException("Native core returned an empty download.");
        }
        catch (JsonException exception)
        {
            throw new InvalidOperationException("Native core returned an invalid download.", exception);
        }
    }

    private static FomodInstallerInfo DeserializeFomodInstaller(string json)
    {
        try
        {
            return JsonSerializer.Deserialize<FomodInstallerInfo>(json, JsonOptions)
                ?? new FomodInstallerInfo();
        }
        catch (JsonException exception)
        {
            throw new InvalidOperationException("Native core returned an invalid FOMOD descriptor.", exception);
        }
    }

    private static ContentLayoutPreview DeserializeContentLayoutPreview(string json)
    {
        try
        {
            return JsonSerializer.Deserialize<ContentLayoutPreview>(json, JsonOptions)
                ?? new ContentLayoutPreview();
        }
        catch (JsonException exception)
        {
            throw new InvalidOperationException("Native core returned an invalid content layout preview.", exception);
        }
    }

    private static string SerializePlacementOverrides(IReadOnlyList<PlacementOverride>? placementOverrides)
    {
        return JsonSerializer.Serialize(placementOverrides ?? Array.Empty<PlacementOverride>(), JsonOptions);
    }

    private static ModEntry DeserializeModEntry(string json)
    {
        try
        {
            return JsonSerializer.Deserialize<ModEntry>(json, JsonOptions)
                ?? throw new InvalidOperationException("Native core returned an empty mod descriptor.");
        }
        catch (JsonException exception)
        {
            throw new InvalidOperationException("Native core returned an invalid mod descriptor.", exception);
        }
    }

    private void EnsureCoreAvailable()
    {
        if (!IsCoreAvailable)
        {
            throw new InvalidOperationException("C++ core недоступен. Сначала соберите backend и положите FluxoraCore.dll рядом с приложением.");
        }
    }

    private static string ReadLastNativeError(int result)
    {
        StringBuilder buffer = new(2048);
        int errorResult = NativeMethods.GetLastError(buffer, buffer.Capacity);
        if (errorResult == NativeResult.Ok && buffer.Length > 0)
        {
            return buffer.ToString();
        }

        return $"Native core returned error code {result}.";
    }

    private static bool IsNativeLoadException(Exception exception)
    {
        return exception is DllNotFoundException or EntryPointNotFoundException or BadImageFormatException;
    }

    private static class NativeResult
    {
        public const int Ok = 0;
        public const int BufferTooSmall = 2;
    }

    private static class NativeMethods
    {
        [DllImport("FluxoraCore", EntryPoint = "fluxora_core_is_available", CallingConvention = CallingConvention.Cdecl)]
        public static extern int CoreIsAvailable();

        [DllImport("FluxoraCore", EntryPoint = "fluxora_set_operation_context", CallingConvention = CallingConvention.Cdecl, CharSet = CharSet.Unicode)]
        public static extern int SetOperationContext(string operationId);

        [DllImport("FluxoraCore", EntryPoint = "fluxora_get_last_required_buffer_length", CallingConvention = CallingConvention.Cdecl)]
        public static extern int GetLastRequiredBufferLength();

        [DllImport("FluxoraCore", EntryPoint = "fluxora_copy_last_output", CallingConvention = CallingConvention.Cdecl, CharSet = CharSet.Unicode)]
        public static extern int CopyLastOutput(
            StringBuilder jsonBuffer,
            int jsonBufferLength);

        [DllImport("FluxoraCore", EntryPoint = "fluxora_get_game_templates", CallingConvention = CallingConvention.Cdecl, CharSet = CharSet.Unicode)]
        public static extern int GetGameTemplates(
            StringBuilder jsonBuffer,
            int jsonBufferLength);

        [DllImport("FluxoraCore", EntryPoint = "fluxora_resolve_template", CallingConvention = CallingConvention.Cdecl, CharSet = CharSet.Unicode)]
        public static extern int ResolveTemplate(
            string templateId,
            StringBuilder jsonBuffer,
            int jsonBufferLength);

        [DllImport("FluxoraCore", EntryPoint = "fluxora_preview_project_directory", CallingConvention = CallingConvention.Cdecl, CharSet = CharSet.Unicode)]
        public static extern int PreviewProjectDirectory(
            string projectName,
            string installRootDirectory,
            StringBuilder projectDirectoryBuffer,
            int projectDirectoryBufferLength);

        [DllImport("FluxoraCore", EntryPoint = "fluxora_create_project", CallingConvention = CallingConvention.Cdecl, CharSet = CharSet.Unicode)]
        public static extern int CreateProject(
            string projectName,
            string templateId,
            string gamePath,
            string installRootDirectory,
            StringBuilder jsonBuffer,
            int jsonBufferLength);

        [DllImport("FluxoraCore", EntryPoint = "fluxora_open_project_config", CallingConvention = CallingConvention.Cdecl, CharSet = CharSet.Unicode)]
        public static extern int OpenProjectConfig(
            string configPath,
            StringBuilder jsonBuffer,
            int jsonBufferLength);

        [DllImport("FluxoraCore", EntryPoint = "fluxora_list_project_configs", CallingConvention = CallingConvention.Cdecl, CharSet = CharSet.Unicode)]
        public static extern int ListProjectConfigs(
            string buildConfigsDirectory,
            StringBuilder jsonBuffer,
            int jsonBufferLength);

        [DllImport("FluxoraCore", EntryPoint = "fluxora_rename_project", CallingConvention = CallingConvention.Cdecl, CharSet = CharSet.Unicode)]
        public static extern int RenameProject(
            string configPath,
            string newName,
            StringBuilder jsonBuffer,
            int jsonBufferLength);

        [DllImport("FluxoraCore", EntryPoint = "fluxora_delete_project", CallingConvention = CallingConvention.Cdecl, CharSet = CharSet.Unicode)]
        public static extern int DeleteProject(
            string configPath);

        [DllImport("FluxoraCore", EntryPoint = "fluxora_delete_project_with_progress", CallingConvention = CallingConvention.Cdecl, CharSet = CharSet.Unicode)]
        public static extern int DeleteProjectWithProgress(
            string configPath,
            NativeProgressCallback? progressCallback,
            IntPtr progressUserData);

        [DllImport("FluxoraCore", EntryPoint = "fluxora_get_build_path_settings", CallingConvention = CallingConvention.Cdecl, CharSet = CharSet.Unicode)]
        public static extern int GetBuildPathSettings(
            string configPath,
            StringBuilder jsonBuffer,
            int jsonBufferLength);

        [DllImport("FluxoraCore", EntryPoint = "fluxora_save_build_path_settings", CallingConvention = CallingConvention.Cdecl, CharSet = CharSet.Unicode)]
        public static extern int SaveBuildPathSettings(
            string configPath,
            string settingsJson,
            StringBuilder jsonBuffer,
            int jsonBufferLength);

        [DllImport("FluxoraCore", EntryPoint = "fluxora_export_fluxpack", CallingConvention = CallingConvention.Cdecl, CharSet = CharSet.Unicode)]
        public static extern int ExportFluxPack(
            string configPath,
            string outputPath,
            int includeGeneratedAssets,
            StringBuilder jsonBuffer,
            int jsonBufferLength);

        [DllImport("FluxoraCore", EntryPoint = "fluxora_inspect_fluxpack", CallingConvention = CallingConvention.Cdecl, CharSet = CharSet.Unicode)]
        public static extern int InspectFluxPack(
            string fluxPackPath,
            StringBuilder jsonBuffer,
            int jsonBufferLength);

        [DllImport("FluxoraCore", EntryPoint = "fluxora_install_fluxpack", CallingConvention = CallingConvention.Cdecl, CharSet = CharSet.Unicode)]
        public static extern int InstallFluxPack(
            string fluxPackPath,
            string installRootDirectory,
            NativeProgressCallback? progressCallback,
            IntPtr progressUserData,
            StringBuilder jsonBuffer,
            int jsonBufferLength);

        [UnmanagedFunctionPointer(CallingConvention.Cdecl, CharSet = CharSet.Unicode)]
        public delegate void NativeProgressCallback(
            [MarshalAs(UnmanagedType.LPWStr)] string? progressJson,
            IntPtr userData);

        [DllImport("FluxoraCore", EntryPoint = "fluxora_analyze_mod_organizer_instance", CallingConvention = CallingConvention.Cdecl, CharSet = CharSet.Unicode)]
        public static extern int AnalyzeModOrganizerInstance(
            string sourceDirectory,
            string destinationRootDirectory,
            string existingConfigPath,
            StringBuilder jsonBuffer,
            int jsonBufferLength);

        [DllImport("FluxoraCore", EntryPoint = "fluxora_import_mod_organizer_instance", CallingConvention = CallingConvention.Cdecl, CharSet = CharSet.Unicode)]
        public static extern int ImportModOrganizerInstance(
            string sourceDirectory,
            string destinationRootDirectory,
            string existingConfigPath,
            int replaceExisting,
            NativeProgressCallback? progressCallback,
            IntPtr progressUserData,
            StringBuilder jsonBuffer,
            int jsonBufferLength);

        [DllImport("FluxoraCore", EntryPoint = "fluxora_get_game_executables", CallingConvention = CallingConvention.Cdecl, CharSet = CharSet.Unicode)]
        public static extern int GetGameExecutables(
            string configPath,
            StringBuilder jsonBuffer,
            int jsonBufferLength);

        [DllImport("FluxoraCore", EntryPoint = "fluxora_save_game_executables", CallingConvention = CallingConvention.Cdecl, CharSet = CharSet.Unicode)]
        public static extern int SaveGameExecutables(
            string configPath,
            string executablesJson,
            StringBuilder jsonBuffer,
            int jsonBufferLength);

        [DllImport("FluxoraCore", EntryPoint = "fluxora_launch_game_executable", CallingConvention = CallingConvention.Cdecl, CharSet = CharSet.Unicode)]
        public static extern int LaunchGameExecutable(
            string configPath,
            string executableId,
            StringBuilder jsonBuffer,
            int jsonBufferLength);

        [DllImport("FluxoraCore", EntryPoint = "fluxora_get_executable_icon", CallingConvention = CallingConvention.Cdecl, CharSet = CharSet.Unicode)]
        public static extern int GetExecutableIcon(
            string executablePath,
            StringBuilder iconPathBuffer,
            int iconPathBufferLength);

        [DllImport("FluxoraCore", EntryPoint = "fluxora_get_nexusmods_auth_status", CallingConvention = CallingConvention.Cdecl, CharSet = CharSet.Unicode)]
        public static extern int GetNexusModsAuthStatus(
            StringBuilder jsonBuffer,
            int jsonBufferLength);

        [DllImport("FluxoraCore", EntryPoint = "fluxora_connect_nexusmods", CallingConvention = CallingConvention.Cdecl, CharSet = CharSet.Unicode)]
        public static extern int ConnectNexusMods(
            StringBuilder jsonBuffer,
            int jsonBufferLength);

        [DllImport("FluxoraCore", EntryPoint = "fluxora_disconnect_nexusmods", CallingConvention = CallingConvention.Cdecl, CharSet = CharSet.Unicode)]
        public static extern int DisconnectNexusMods(
            StringBuilder jsonBuffer,
            int jsonBufferLength);

        [DllImport("FluxoraCore", EntryPoint = "fluxora_get_app_language", CallingConvention = CallingConvention.Cdecl, CharSet = CharSet.Unicode)]
        public static extern int GetAppLanguage(
            StringBuilder languageBuffer,
            int languageBufferLength);

        [DllImport("FluxoraCore", EntryPoint = "fluxora_set_app_language", CallingConvention = CallingConvention.Cdecl, CharSet = CharSet.Unicode)]
        public static extern int SetAppLanguage(
            string languageCode);

        [DllImport("FluxoraCore", EntryPoint = "fluxora_register_nxm_protocol", CallingConvention = CallingConvention.Cdecl, CharSet = CharSet.Unicode)]
        public static extern int RegisterNxmProtocol(
            string executablePath,
            StringBuilder jsonBuffer,
            int jsonBufferLength);

        [DllImport("FluxoraCore", EntryPoint = "fluxora_get_installed_mods", CallingConvention = CallingConvention.Cdecl, CharSet = CharSet.Unicode)]
        public static extern int GetInstalledMods(
            string projectDirectory,
            StringBuilder jsonBuffer,
            int jsonBufferLength);

        [DllImport("FluxoraCore", EntryPoint = "fluxora_get_mod_order", CallingConvention = CallingConvention.Cdecl, CharSet = CharSet.Unicode)]
        public static extern int GetModOrder(
            string projectDirectory,
            string profileName,
            StringBuilder jsonBuffer,
            int jsonBufferLength);

        [DllImport("FluxoraCore", EntryPoint = "fluxora_create_mod_separator", CallingConvention = CallingConvention.Cdecl, CharSet = CharSet.Unicode)]
        public static extern int CreateModSeparator(
            string projectDirectory,
            string profileName,
            string title,
            int targetIndex,
            StringBuilder jsonBuffer,
            int jsonBufferLength);

        [DllImport("FluxoraCore", EntryPoint = "fluxora_delete_mod_separator", CallingConvention = CallingConvention.Cdecl, CharSet = CharSet.Unicode)]
        public static extern int DeleteModSeparator(
            string projectDirectory,
            string profileName,
            string separatorId,
            StringBuilder jsonBuffer,
            int jsonBufferLength);

        [DllImport("FluxoraCore", EntryPoint = "fluxora_move_mod_order_item", CallingConvention = CallingConvention.Cdecl, CharSet = CharSet.Unicode)]
        public static extern int MoveModOrderItem(
            string projectDirectory,
            string profileName,
            string orderItemId,
            int targetIndex,
            StringBuilder jsonBuffer,
            int jsonBufferLength);

        [DllImport("FluxoraCore", EntryPoint = "fluxora_delete_installed_mod", CallingConvention = CallingConvention.Cdecl, CharSet = CharSet.Unicode)]
        public static extern int DeleteInstalledMod(
            string projectDirectory,
            string modPath);

        [DllImport("FluxoraCore", EntryPoint = "fluxora_create_empty_mod", CallingConvention = CallingConvention.Cdecl, CharSet = CharSet.Unicode)]
        public static extern int CreateEmptyMod(
            string projectDirectory,
            string modName,
            StringBuilder jsonBuffer,
            int jsonBufferLength);

        [DllImport("FluxoraCore", EntryPoint = "fluxora_set_installed_mod_enabled", CallingConvention = CallingConvention.Cdecl, CharSet = CharSet.Unicode)]
        public static extern int SetInstalledModEnabled(
            string projectDirectory,
            string modPath,
            int isEnabled);

        [DllImport("FluxoraCore", EntryPoint = "fluxora_set_all_installed_mods_enabled", CallingConvention = CallingConvention.Cdecl, CharSet = CharSet.Unicode)]
        public static extern int SetAllInstalledModsEnabled(
            string projectDirectory,
            int isEnabled);

        [DllImport("FluxoraCore", EntryPoint = "fluxora_check_mod_updates", CallingConvention = CallingConvention.Cdecl, CharSet = CharSet.Unicode)]
        public static extern int CheckModUpdates(
            string projectDirectory,
            StringBuilder jsonBuffer,
            int jsonBufferLength);

        [DllImport("FluxoraCore", EntryPoint = "fluxora_get_mod_file_tree", CallingConvention = CallingConvention.Cdecl, CharSet = CharSet.Unicode)]
        public static extern int GetModFileTree(
            string projectDirectory,
            string modPath,
            string relativeDirectory,
            StringBuilder jsonBuffer,
            int jsonBufferLength);

        [DllImport("FluxoraCore", EntryPoint = "fluxora_get_plugins", CallingConvention = CallingConvention.Cdecl, CharSet = CharSet.Unicode)]
        public static extern int GetPlugins(
            string projectDirectory,
            string templateId,
            string profileName,
            StringBuilder jsonBuffer,
            int jsonBufferLength);

        [DllImport("FluxoraCore", EntryPoint = "fluxora_move_plugin", CallingConvention = CallingConvention.Cdecl, CharSet = CharSet.Unicode)]
        public static extern int MovePlugin(
            string projectDirectory,
            string templateId,
            string profileName,
            string orderItemId,
            int targetIndex,
            StringBuilder jsonBuffer,
            int jsonBufferLength);

        [DllImport("FluxoraCore", EntryPoint = "fluxora_create_plugin_separator", CallingConvention = CallingConvention.Cdecl, CharSet = CharSet.Unicode)]
        public static extern int CreatePluginSeparator(
            string projectDirectory,
            string templateId,
            string profileName,
            string title,
            int targetIndex,
            StringBuilder jsonBuffer,
            int jsonBufferLength);

        [DllImport("FluxoraCore", EntryPoint = "fluxora_delete_plugin_separator", CallingConvention = CallingConvention.Cdecl, CharSet = CharSet.Unicode)]
        public static extern int DeletePluginSeparator(
            string projectDirectory,
            string templateId,
            string profileName,
            string separatorId,
            StringBuilder jsonBuffer,
            int jsonBufferLength);

        [DllImport("FluxoraCore", EntryPoint = "fluxora_set_plugin_enabled", CallingConvention = CallingConvention.Cdecl, CharSet = CharSet.Unicode)]
        public static extern int SetPluginEnabled(
            string projectDirectory,
            string templateId,
            string profileName,
            string pluginName,
            int isEnabled,
            StringBuilder jsonBuffer,
            int jsonBufferLength);

        [DllImport("FluxoraCore", EntryPoint = "fluxora_get_downloads", CallingConvention = CallingConvention.Cdecl, CharSet = CharSet.Unicode)]
        public static extern int GetDownloads(
            string projectDirectory,
            StringBuilder jsonBuffer,
            int jsonBufferLength);

        [DllImport("FluxoraCore", EntryPoint = "fluxora_capture_nxm_links", CallingConvention = CallingConvention.Cdecl, CharSet = CharSet.Unicode)]
        public static extern int CaptureNxmLinks(
            string projectDirectory,
            string nxmLinksJson,
            StringBuilder jsonBuffer,
            int jsonBufferLength);

        [DllImport("FluxoraCore", EntryPoint = "fluxora_import_inbound_downloads", CallingConvention = CallingConvention.Cdecl, CharSet = CharSet.Unicode)]
        public static extern int ImportInboundDownloads(
            string projectDirectory,
            StringBuilder jsonBuffer,
            int jsonBufferLength);

        [DllImport("FluxoraCore", EntryPoint = "fluxora_import_download_file", CallingConvention = CallingConvention.Cdecl, CharSet = CharSet.Unicode)]
        public static extern int ImportDownloadFile(
            string projectDirectory,
            string sourcePath,
            StringBuilder jsonBuffer,
            int jsonBufferLength);

        [DllImport("FluxoraCore", EntryPoint = "fluxora_delete_download", CallingConvention = CallingConvention.Cdecl, CharSet = CharSet.Unicode)]
        public static extern int DeleteDownload(
            string projectDirectory,
            string downloadPath);

        [DllImport("FluxoraCore", EntryPoint = "fluxora_cancel_download", CallingConvention = CallingConvention.Cdecl, CharSet = CharSet.Unicode)]
        public static extern int CancelDownload(
            string projectDirectory,
            string downloadPath);

        [DllImport("FluxoraCore", EntryPoint = "fluxora_resume_download", CallingConvention = CallingConvention.Cdecl, CharSet = CharSet.Unicode)]
        public static extern int ResumeDownload(
            string projectDirectory,
            string downloadPath,
            StringBuilder jsonBuffer,
            int jsonBufferLength);

        [DllImport("FluxoraCore", EntryPoint = "fluxora_install_download", CallingConvention = CallingConvention.Cdecl, CharSet = CharSet.Unicode)]
        public static extern int InstallDownload(
            string projectDirectory,
            string downloadPath,
            string modName,
            StringBuilder jsonBuffer,
            int jsonBufferLength);

        [DllImport("FluxoraCore", EntryPoint = "fluxora_install_download_with_mode", CallingConvention = CallingConvention.Cdecl, CharSet = CharSet.Unicode)]
        public static extern int InstallDownloadWithMode(
            string projectDirectory,
            string downloadPath,
            string modName,
            int existingModMode,
            StringBuilder jsonBuffer,
            int jsonBufferLength);

        [DllImport("FluxoraCore", EntryPoint = "fluxora_install_download_with_layout", CallingConvention = CallingConvention.Cdecl, CharSet = CharSet.Unicode)]
        public static extern int InstallDownloadWithLayout(
            string projectDirectory,
            string downloadPath,
            string modName,
            int existingModMode,
            string placementOverridesJson,
            StringBuilder jsonBuffer,
            int jsonBufferLength);

        [DllImport("FluxoraCore", EntryPoint = "fluxora_install_archive_with_mode", CallingConvention = CallingConvention.Cdecl, CharSet = CharSet.Unicode)]
        public static extern int InstallArchiveWithMode(
            string projectDirectory,
            string archivePath,
            string modName,
            int existingModMode,
            StringBuilder jsonBuffer,
            int jsonBufferLength);

        [DllImport("FluxoraCore", EntryPoint = "fluxora_install_archive_with_layout", CallingConvention = CallingConvention.Cdecl, CharSet = CharSet.Unicode)]
        public static extern int InstallArchiveWithLayout(
            string projectDirectory,
            string archivePath,
            string modName,
            int existingModMode,
            string placementOverridesJson,
            StringBuilder jsonBuffer,
            int jsonBufferLength);

        [DllImport("FluxoraCore", EntryPoint = "fluxora_analyze_download_content_layout", CallingConvention = CallingConvention.Cdecl, CharSet = CharSet.Unicode)]
        public static extern int AnalyzeDownloadContentLayout(
            string projectDirectory,
            string downloadPath,
            int existingModMode,
            StringBuilder jsonBuffer,
            int jsonBufferLength);

        [DllImport("FluxoraCore", EntryPoint = "fluxora_analyze_fomod_download", CallingConvention = CallingConvention.Cdecl, CharSet = CharSet.Unicode)]
        public static extern int AnalyzeFomodDownload(
            string projectDirectory,
            string downloadPath,
            StringBuilder jsonBuffer,
            int jsonBufferLength);

        [DllImport("FluxoraCore", EntryPoint = "fluxora_install_fomod_download_with_mode", CallingConvention = CallingConvention.Cdecl, CharSet = CharSet.Unicode)]
        public static extern int InstallFomodDownloadWithMode(
            string projectDirectory,
            string downloadPath,
            string modName,
            int existingModMode,
            string selectedOptionIdsJson,
            StringBuilder jsonBuffer,
            int jsonBufferLength);

        [DllImport("FluxoraCore", EntryPoint = "fluxora_install_fomod_download_with_layout", CallingConvention = CallingConvention.Cdecl, CharSet = CharSet.Unicode)]
        public static extern int InstallFomodDownloadWithLayout(
            string projectDirectory,
            string downloadPath,
            string modName,
            int existingModMode,
            string selectedOptionIdsJson,
            string placementOverridesJson,
            StringBuilder jsonBuffer,
            int jsonBufferLength);

        [DllImport("FluxoraCore", EntryPoint = "fluxora_install_fomod_archive_with_mode", CallingConvention = CallingConvention.Cdecl, CharSet = CharSet.Unicode)]
        public static extern int InstallFomodArchiveWithMode(
            string projectDirectory,
            string archivePath,
            string modName,
            int existingModMode,
            string selectedOptionIdsJson,
            StringBuilder jsonBuffer,
            int jsonBufferLength);

        [DllImport("FluxoraCore", EntryPoint = "fluxora_install_fomod_archive_with_layout", CallingConvention = CallingConvention.Cdecl, CharSet = CharSet.Unicode)]
        public static extern int InstallFomodArchiveWithLayout(
            string projectDirectory,
            string archivePath,
            string modName,
            int existingModMode,
            string selectedOptionIdsJson,
            string placementOverridesJson,
            StringBuilder jsonBuffer,
            int jsonBufferLength);

        [DllImport("FluxoraCore", EntryPoint = "fluxora_analyze_fomod_download_content_layout", CallingConvention = CallingConvention.Cdecl, CharSet = CharSet.Unicode)]
        public static extern int AnalyzeFomodDownloadContentLayout(
            string projectDirectory,
            string downloadPath,
            int existingModMode,
            string selectedOptionIdsJson,
            StringBuilder jsonBuffer,
            int jsonBufferLength);

        [DllImport("FluxoraCore", EntryPoint = "fluxora_get_last_error", CallingConvention = CallingConvention.Cdecl, CharSet = CharSet.Unicode)]
        public static extern int GetLastError(
            StringBuilder messageBuffer,
            int messageBufferLength);
    }

    private sealed class NxmProtocolStatus
    {
        public bool IsRegistered { get; set; }
    }
}
