#include "FluxoraCore/FluxoraCoreApi.hpp"

#include "FluxoraCore/Core.hpp"
#include "FluxoraCore/GameSupport/GameDetectionService.hpp"
#include "FluxoraCore/GameSupport/GameHealthCheckService.hpp"
#include "FluxoraCore/GameSupport/GameSupportRegistry.hpp"
#include "FluxoraCore/GameSupport/ProjectFingerprint.hpp"
#include "FluxoraCore/Services/AppSettingsService.hpp"
#include "FluxoraCore/Services/BuildPathSettingsService.hpp"
#include "FluxoraCore/Services/BuildFileWorkspaceService.hpp"
#include "FluxoraCore/Services/BodySlideIntegrationService.hpp"
#include "FluxoraCore/Services/DownloadService.hpp"
#include "FluxoraCore/Services/EffectiveFileTreeService.hpp"
#include "FluxoraCore/Services/ExecutableIconService.hpp"
#include "FluxoraCore/Services/ExecutableService.hpp"
#include "FluxoraCore/Services/ExternalConnectionService.hpp"
#include "FluxoraCore/Services/FluxPackService.hpp"
#include "FluxoraCore/Services/GrassCacheService.hpp"
#include "FluxoraCore/Services/InstallOperationService.hpp"
#include "FluxoraCore/Services/InstallProjectGate.hpp"
#include "FluxoraCore/Services/ModService.hpp"
#include "FluxoraCore/Services/ModUpdateService.hpp"
#include "FluxoraCore/Services/ModOrganizerImportService.hpp"
#include "FluxoraCore/Services/Logger.hpp"
#include "FluxoraCore/Services/NexusModsAuthService.hpp"
#include "FluxoraCore/Services/PathSafetyService.hpp"
#include "FluxoraCore/Services/PluginService.hpp"
#include "FluxoraCore/Services/ProfileOrderService.hpp"
#include "FluxoraCore/Services/ProfileService.hpp"
#include "FluxoraCore/Services/ProjectService.hpp"
#include "FluxoraCore/Services/TemplateService.hpp"
#include "FluxoraCore/Services/VirtualFileSystemService.hpp"
#include "FluxoraCore/Storage/AtomicFileStore.hpp"
#include "FluxoraCore/Storage/InstanceMetadataStore.hpp"
#include "FluxoraCore/Support/JsonReader.hpp"
#include "FluxoraCore/Support/JsonWriter.hpp"

#include <algorithm>
#include <chrono>
#include <cstdint>
#include <cstring>
#include <cwchar>
#include <cwctype>
#include <exception>
#include <filesystem>
#include <fstream>
#include <new>
#include <optional>
#include <stdexcept>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

#ifdef _WIN32
#include <windows.h>
#endif

namespace
{
    thread_local std::wstring lastError;
    thread_local int lastRequiredBufferLength = 0;
    thread_local std::wstring lastBufferedOutput;
    thread_local bool hasLastBufferedOutput = false;
    fluxora::Core* currentCore = nullptr;
    constexpr std::uintmax_t maxTextEditorFileBytes = 5ULL * 1024ULL * 1024ULL;

    bool isBlank(const wchar_t* value);
    fluxora::Core& core();
    void logOperation(fluxora::LogLevel level, std::string_view category, std::string_view message) noexcept;

    void writeCapabilities(fluxora::JsonWriter& writer, const fluxora::BuildTemplate& tpl)
    {
        writer.key(L"capabilities").beginArray();
        for (const auto& capability : tpl.capabilities)
        {
            writer.beginObject();
            writer.field(L"id", capability.id);
            writer.field(L"displayName", capability.displayName);
            writer.field(L"description", capability.description);
            writer.endObject();
        }
        writer.endArray();
    }

    void writeScriptExtender(fluxora::JsonWriter& writer, const fluxora::BuildTemplate& tpl)
    {
        if (tpl.scriptExtender.has_value())
        {
            const fluxora::ScriptExtender& extender = tpl.scriptExtender.value();
            writer.key(L"scriptExtender").beginObject();
            writer.field(L"name", extender.name);
            writer.field(L"loaderExecutable", extender.loaderExecutable);
            writer.field(L"website", extender.website);
            writer.endObject();
        }
        else
        {
            writer.key(L"scriptExtender").nullValue();
        }
    }

    struct GameBridgeMetadata
    {
        bool supported{false};
        std::wstring gameId;
        std::wstring displayName;
        std::wstring uiTemplateId;
        fluxora::CapabilitySet capabilities;
        std::vector<std::wstring> archiveExtensions;
        std::vector<std::wstring> requiredFiles;
        fluxora::ContentLayoutSupportRules contentLayout;
        std::vector<fluxora::GameExecutableDefinition> executableDefinitions;
        std::vector<std::wstring> fallbackExecutables;
        std::optional<fluxora::GameScriptExtenderRules> scriptExtenderLaunchRules;
    };

    std::vector<std::wstring> extensionValues(const std::vector<fluxora::NormalizedExtension>& extensions)
    {
        std::vector<std::wstring> values;
        values.reserve(extensions.size());
        for (const fluxora::NormalizedExtension& extension : extensions)
        {
            values.push_back(extension.value());
        }

        return values;
    }

    std::vector<std::wstring> executableNameValues(const std::vector<fluxora::ExecutableName>& names)
    {
        std::vector<std::wstring> values;
        values.reserve(names.size());
        for (const fluxora::ExecutableName& name : names)
        {
            values.push_back(name.displayName());
        }

        return values;
    }

    std::vector<std::wstring> pathValues(const std::vector<std::filesystem::path>& paths)
    {
        std::vector<std::wstring> values;
        values.reserve(paths.size());
        for (const std::filesystem::path& path : paths)
        {
            values.push_back(path.wstring());
        }

        return values;
    }

    fluxora::CapabilitySet capabilitySetFromTemplate(const fluxora::BuildTemplate& tpl)
    {
        fluxora::CapabilitySet set;
        for (const fluxora::TemplateCapability& capability : tpl.capabilities)
        {
            if (capability.id == L"plugins")
            {
                set.enable(fluxora::GameCapability::Plugins);
            }
            else if (capability.id == L"load-order")
            {
                set.enable(fluxora::GameCapability::LoadOrder);
            }
            else if (capability.id == L"root-files")
            {
                set.enable(fluxora::GameCapability::RootFiles);
            }
            else if (capability.id == L"script-extender")
            {
                set.enable(fluxora::GameCapability::ScriptExtender);
            }
            else if (capability.id == L"ini-tweaks")
            {
                set.enable(fluxora::GameCapability::IniProfiles);
            }
            else if (capability.id == L"save-games")
            {
                set.enable(fluxora::GameCapability::SaveProfiles);
            }
            else if (capability.id == L"content-layout")
            {
                set.enable(fluxora::GameCapability::ContentLayoutRules);
            }
        }

        if (!tpl.pluginExtensions.empty())
        {
            set.enable(fluxora::GameCapability::Plugins);
        }

        return set;
    }

    GameBridgeMetadata resolveGameBridgeMetadata(const fluxora::BuildTemplate& tpl)
    {
        GameBridgeMetadata metadata;
        metadata.gameId = tpl.id;
        metadata.displayName = tpl.gameName.empty() ? tpl.displayName : tpl.gameName;
        metadata.uiTemplateId = tpl.id;
        metadata.capabilities = capabilitySetFromTemplate(tpl);
        metadata.contentLayout.dataFolder = tpl.dataDirectory;
        metadata.contentLayout.supportsRootFiles =
            metadata.capabilities.has(fluxora::GameCapability::RootFiles);
        metadata.fallbackExecutables = tpl.executables;

        const fluxora::GameSupportRegistry& registry = fluxora::GameSupportRegistry::embedded();
        const fluxora::GameSupportLookupResult lookup = registry.lookupById(tpl.id);
        if (!lookup.supported || lookup.definition == nullptr)
        {
            return metadata;
        }

        const fluxora::GameDefinition& definition = *lookup.definition;
        metadata.supported = true;
        metadata.gameId = definition.id.value();
        metadata.displayName = definition.displayName;
        metadata.uiTemplateId = definition.uiTemplateId.value();
        metadata.capabilities = definition.capabilities;
        metadata.archiveExtensions = extensionValues(definition.archiveExtensions);
        metadata.requiredFiles = definition.healthRules.requiredFiles.empty()
            ? definition.requiredFiles
            : definition.healthRules.requiredFiles;
        metadata.executableDefinitions = definition.executables;
        metadata.scriptExtenderLaunchRules = definition.launchRules.scriptExtender;

        if (lookup.support != nullptr &&
            lookup.support->components().contentLayoutRulesProvider != nullptr)
        {
            metadata.contentLayout =
                lookup.support->components().contentLayoutRulesProvider->contentLayoutRules();
        }
        else
        {
            metadata.contentLayout.dataFolder = definition.contentLayoutRules.dataFolder.empty()
                ? definition.dataFolder
                : definition.contentLayoutRules.dataFolder;
            metadata.contentLayout.supportsRootFiles = definition.contentLayoutRules.supportsRootFiles;
            metadata.contentLayout.rootFileWrapperDirectory =
                definition.contentLayoutRules.rootFileWrapperDirectory;
            metadata.contentLayout.pluginExtensions = definition.pluginExtensions;
            metadata.contentLayout.archiveExtensions = definition.archiveExtensions;
        }

        return metadata;
    }

    void writeGameCapabilities(fluxora::JsonWriter& writer, const fluxora::CapabilitySet& capabilities)
    {
        writer.beginObject();
        writer.field(L"bits", static_cast<int>(capabilities.bits()));
        writer.field(L"supportsPlugins", capabilities.has(fluxora::GameCapability::Plugins));
        writer.field(L"supportsLoadOrder", capabilities.has(fluxora::GameCapability::LoadOrder));
        writer.field(L"supportsRootFiles", capabilities.has(fluxora::GameCapability::RootFiles));
        writer.field(L"supportsArchives", capabilities.has(fluxora::GameCapability::Archives));
        writer.field(L"supportsScriptExtender", capabilities.has(fluxora::GameCapability::ScriptExtender));
        writer.field(L"supportsIniProfiles", capabilities.has(fluxora::GameCapability::IniProfiles));
        writer.field(L"supportsSaveProfiles", capabilities.has(fluxora::GameCapability::SaveProfiles));
        writer.field(L"supportsGameSpecificVfs", capabilities.has(fluxora::GameCapability::GameSpecificVfs));
        writer.field(L"supportsContentLayoutRules", capabilities.has(fluxora::GameCapability::ContentLayoutRules));
        writer.key(L"enabled").beginArray();
        if (capabilities.has(fluxora::GameCapability::Plugins))
        {
            writer.value(L"plugins");
        }
        if (capabilities.has(fluxora::GameCapability::LoadOrder))
        {
            writer.value(L"loadOrder");
        }
        if (capabilities.has(fluxora::GameCapability::RootFiles))
        {
            writer.value(L"rootFiles");
        }
        if (capabilities.has(fluxora::GameCapability::Archives))
        {
            writer.value(L"archives");
        }
        if (capabilities.has(fluxora::GameCapability::ScriptExtender))
        {
            writer.value(L"scriptExtender");
        }
        if (capabilities.has(fluxora::GameCapability::IniProfiles))
        {
            writer.value(L"iniProfiles");
        }
        if (capabilities.has(fluxora::GameCapability::SaveProfiles))
        {
            writer.value(L"saveProfiles");
        }
        if (capabilities.has(fluxora::GameCapability::GameSpecificVfs))
        {
            writer.value(L"gameSpecificVfs");
        }
        if (capabilities.has(fluxora::GameCapability::ContentLayoutRules))
        {
            writer.value(L"contentLayoutRules");
        }
        writer.endArray();
        writer.endObject();
    }

    std::wstring executableRoleName(fluxora::GameExecutableRole role)
    {
        switch (role)
        {
        case fluxora::GameExecutableRole::Primary:
            return L"primary";
        case fluxora::GameExecutableRole::Launcher:
            return L"launcher";
        case fluxora::GameExecutableRole::ScriptExtender:
            return L"scriptExtender";
        }

        return L"primary";
    }

    std::wstring workingDirectoryKindName(
        const std::optional<fluxora::GameExecutableWorkingDirectoryKind>& kind)
    {
        if (!kind.has_value())
        {
            return {};
        }

        switch (kind.value())
        {
        case fluxora::GameExecutableWorkingDirectoryKind::ExecutableDirectory:
            return L"executableDirectory";
        case fluxora::GameExecutableWorkingDirectoryKind::GameRoot:
            return L"gameRoot";
        }

        return {};
    }

    void writeExecutableDisplayMetadata(
        fluxora::JsonWriter& writer,
        std::wstring id,
        std::wstring displayName,
        std::wstring executableName,
        std::wstring role,
        std::wstring workingDirectoryKind,
        bool isPrimary,
        bool isLauncher,
        bool isScriptExtender)
    {
        writer.beginObject();
        writer.field(L"id", id);
        writer.field(L"displayName", displayName);
        writer.field(L"executableName", executableName);
        writer.field(L"role", role);
        writer.field(L"workingDirectoryKind", workingDirectoryKind);
        writer.field(L"isPrimary", isPrimary);
        writer.field(L"isLauncher", isLauncher);
        writer.field(L"isScriptExtender", isScriptExtender);
        writer.endObject();
    }

    void writeExecutableDisplayMetadataList(
        fluxora::JsonWriter& writer,
        const GameBridgeMetadata& metadata)
    {
        writer.beginArray();
        for (const fluxora::GameExecutableDefinition& executable : metadata.executableDefinitions)
        {
            writeExecutableDisplayMetadata(
                writer,
                executable.id,
                executable.displayName,
                executable.name.displayName(),
                executableRoleName(executable.role),
                workingDirectoryKindName(executable.workingDirectory),
                executable.role == fluxora::GameExecutableRole::Primary,
                executable.role == fluxora::GameExecutableRole::Launcher,
                executable.role == fluxora::GameExecutableRole::ScriptExtender);
        }

        if (metadata.executableDefinitions.empty())
        {
            int index = 1;
            for (const std::wstring& executableName : metadata.fallbackExecutables)
            {
                writeExecutableDisplayMetadata(
                    writer,
                    L"executable-" + std::to_wstring(index),
                    executableName,
                    executableName,
                    index == 1 ? L"primary" : L"",
                    L"",
                    index == 1,
                    false,
                    false);
                ++index;
            }
        }

        writer.endArray();
    }

    void writeLaunchTrackingMetadata(
        fluxora::JsonWriter& writer,
        fluxora::LaunchTrackingKind kind,
        const std::vector<std::wstring>& expectedChildProcessNames,
        const std::wstring& handoffDisplayName,
        std::uint32_t handoffTimeoutMs)
    {
        writer.beginObject();
        writer.field(L"kind", fluxora::launchTrackingKindName(kind));
        writer.stringArray(L"expectedChildProcessNames", expectedChildProcessNames);
        writer.field(L"handoffDisplayName", handoffDisplayName);
        writer.field(L"handoffTimeoutMs", static_cast<int>(handoffTimeoutMs));
        writer.endObject();
    }

    void writeLaunchTrackingMetadata(
        fluxora::JsonWriter& writer,
        const GameBridgeMetadata& metadata)
    {
        if (metadata.scriptExtenderLaunchRules.has_value())
        {
            const fluxora::GameScriptExtenderRules& scriptExtender =
                metadata.scriptExtenderLaunchRules.value();
            writeLaunchTrackingMetadata(
                writer,
                scriptExtender.launchTrackingKind,
                executableNameValues(scriptExtender.expectedChildProcessNames),
                scriptExtender.handoffDisplayName,
                scriptExtender.handoffTimeoutMs);
            return;
        }

        writeLaunchTrackingMetadata(
            writer,
            fluxora::LaunchTrackingKind::DirectProcess,
            {},
            {},
            0);
    }

    void writeContentLayoutSummary(
        fluxora::JsonWriter& writer,
        const GameBridgeMetadata& metadata)
    {
        const bool supported =
            metadata.capabilities.has(fluxora::GameCapability::ContentLayoutRules);
        const std::vector<std::wstring> archiveExtensions =
            metadata.archiveExtensions.empty()
                ? extensionValues(metadata.contentLayout.archiveExtensions)
                : metadata.archiveExtensions;

        writer.beginObject();
        writer.field(L"supported", supported);
        writer.field(L"hasWarnings", false);
        writer.field(L"hasBlockers", false);
        writer.field(L"dataFolder", metadata.contentLayout.dataFolder);
        writer.field(L"supportsRootFiles", metadata.contentLayout.supportsRootFiles);
        writer.field(L"rootFileWrapperDirectory", metadata.contentLayout.rootFileWrapperDirectory);
        writer.stringArray(L"pluginExtensions", extensionValues(metadata.contentLayout.pluginExtensions));
        writer.stringArray(L"archiveExtensions", archiveExtensions);
        writer.stringArray(L"scriptExtenderLoaders", executableNameValues(metadata.contentLayout.scriptExtenderLoaders));
        writer.stringArray(L"gameDataDirectories", metadata.contentLayout.gameDataDirectories);
        writer.stringArray(L"scriptExtenderDataPaths", pathValues(metadata.contentLayout.scriptExtenderDataPaths));
        writer.field(
            L"summary",
            supported
                ? L"Content placement is driven by the selected game definition."
                : L"Content layout rules are not enabled for this game.");
        writer.key(L"details").beginArray();
        if (!metadata.contentLayout.dataFolder.empty())
        {
            writer.value(L"Game data content is placed under " + metadata.contentLayout.dataFolder + L".");
        }
        if (metadata.contentLayout.supportsRootFiles)
        {
            writer.value(L"Root files can be staged through the configured wrapper directory.");
        }
        if (!archiveExtensions.empty())
        {
            writer.value(L"Archive extensions are exposed separately from plugin extensions.");
        }
        writer.endArray();
        writer.stringArray(L"warnings", {});
        writer.stringArray(L"blockers", {});
        writer.endObject();
    }

    void writeHealthFinding(fluxora::JsonWriter& writer, const fluxora::GameHealthFinding& finding)
    {
        writer.beginObject();
        writer.field(L"severity", fluxora::GameHealthCheckService::healthSeverityName(finding.severity));
        writer.field(L"code", finding.code);
        writer.field(L"message", finding.message);
        writer.field(L"path", finding.path.wstring());
        writer.field(L"critical", finding.critical);
        writer.endObject();
    }

    void writeGameHealthSummary(fluxora::JsonWriter& writer, const fluxora::GameHealthCheckResult& health)
    {
        writer.beginObject();
        writer.field(L"gameId", health.gameId.value());
        writer.field(L"displayName", health.displayName);
        writer.field(L"status", fluxora::GameHealthCheckService::healthStatusName(health.status));
        writer.field(L"summary", health.summary);
        writer.field(L"hasBlockers", health.hasBlockers());
        writer.field(L"allowsAutomation", health.allowsAutomation());
        writer.stringArray(L"matchedFiles", health.matchedFiles);
        writer.stringArray(L"missingFiles", health.missingFiles);
        writer.stringArray(L"warnings", health.warnings);
        writer.key(L"findings").beginArray();
        for (const fluxora::GameHealthFinding& finding : health.findings)
        {
            writeHealthFinding(writer, finding);
        }
        writer.endArray();
        writer.endObject();
    }

    bool healthStatusHasBlockers(std::wstring status)
    {
        status = fluxora::toAsciiLower(fluxora::trimAscii(status));
        return status == L"broken" || status == L"unsupported";
    }

    void writeFallbackGameHealthSummary(
        fluxora::JsonWriter& writer,
        const fluxora::ProjectDescriptor& project,
        const GameBridgeMetadata& metadata)
    {
        const bool hasFingerprint = project.fingerprint.has_value();
        const std::wstring status = hasFingerprint && !project.fingerprint->healthStatusAtCreation.empty()
            ? project.fingerprint->healthStatusAtCreation
            : L"unknown";
        const std::wstring gameId = hasFingerprint && !project.fingerprint->gameId.empty()
            ? project.fingerprint->gameId
            : metadata.gameId;
        const std::wstring displayName = hasFingerprint && !project.fingerprint->gameDisplayName.empty()
            ? project.fingerprint->gameDisplayName
            : metadata.displayName;

        writer.beginObject();
        writer.field(L"gameId", gameId);
        writer.field(L"displayName", displayName);
        writer.field(L"status", status);
        writer.field(
            L"summary",
            hasFingerprint
                ? L"Health status recorded when the project was created."
                : L"Health status is unavailable for this project.");
        writer.field(L"hasBlockers", healthStatusHasBlockers(status));
        writer.field(L"allowsAutomation", !healthStatusHasBlockers(status) && status != L"unknown");
        writer.stringArray(L"matchedFiles", {});
        writer.stringArray(L"missingFiles", {});
        writer.stringArray(L"warnings", {});
        writer.key(L"findings").beginArray().endArray();
        writer.endObject();
    }

    void writeProjectHealthSummary(
        fluxora::JsonWriter& writer,
        const fluxora::ProjectDescriptor& project,
        const GameBridgeMetadata& metadata,
        const std::filesystem::path& gamePath,
        bool allowFilesystemCheck)
    {
        if (allowFilesystemCheck && metadata.supported && !metadata.gameId.empty() && !gamePath.empty())
        {
            try
            {
                const fluxora::GameSupportRegistry& registry = fluxora::GameSupportRegistry::embedded();
                fluxora::GameDetectionService detectionService(registry);
                fluxora::GameDetectionRequest request;
                request.manualGameId = fluxora::GameId::parseOrThrow(metadata.gameId);
                request.installPath = gamePath;

                const fluxora::GameDetectionResult detection = detectionService.detect(request);
                if (detection.detected)
                {
                    writeGameHealthSummary(writer, fluxora::GameHealthCheckService().check(detection));
                    return;
                }
            }
            catch (const std::exception&)
            {
            }
        }

        writeFallbackGameHealthSummary(writer, project, metadata);
    }

    void writeProjectFingerprint(
        fluxora::JsonWriter& writer,
        const std::optional<fluxora::ProjectFingerprint>& fingerprint)
    {
        if (fingerprint.has_value())
        {
            fluxora::writeProjectFingerprint(writer, fingerprint.value());
        }
        else
        {
            writer.nullValue();
        }
    }

    void writeGameExecutable(fluxora::JsonWriter& writer, const fluxora::GameExecutable& executable)
    {
        writer.beginObject();
        writer.field(L"id", executable.id);
        writer.field(L"displayName", executable.displayName);
        writer.field(L"executablePath", executable.executablePath);
        writer.field(L"arguments", executable.arguments);
        writer.field(L"workingDirectory", executable.workingDirectory);
        writer.field(L"iconPath", executable.iconPath);
        if (!executable.managedToolKind.empty())
        {
            writer.field(L"managedToolKind", executable.managedToolKind);
        }
        writer.key(L"executableDisplayMetadata");
        writeExecutableDisplayMetadata(
            writer,
            executable.id,
            executable.displayName,
            std::filesystem::path(executable.executablePath).filename().wstring(),
            L"",
            executable.workingDirectory.empty() ? L"executableDirectory" : L"",
            false,
            false,
            false);
        writer.endObject();
    }

    void writeGameExecutableList(
        fluxora::JsonWriter& writer,
        const std::vector<fluxora::GameExecutable>& executables)
    {
        writer.beginArray();
        for (const fluxora::GameExecutable& executable : executables)
        {
            writeGameExecutable(writer, executable);
        }
        writer.endArray();
    }

    std::wstring serializeGameExecutables(const std::vector<fluxora::GameExecutable>& executables)
    {
        fluxora::JsonWriter writer;
        writeGameExecutableList(writer, executables);
        return writer.str();
    }

    std::wstring serializeGameExecutableLaunch(const fluxora::GameExecutableLaunchResult& result)
    {
        fluxora::JsonWriter writer;
        writer.beginObject();
        writer.field(L"id", result.executable.id);
        writer.field(L"displayName", result.executable.displayName);
        writer.field(L"executablePath", result.executable.executablePath);
        writer.field(L"arguments", result.executable.arguments);
        writer.field(L"workingDirectory", result.executable.workingDirectory);
        writer.field(L"iconPath", result.executable.iconPath);
        writer.field(L"resolvedExecutablePath", result.resolvedExecutablePath.wstring());
        writer.field(L"resolvedWorkingDirectory", result.resolvedWorkingDirectory.wstring());
        writer.field(L"launchTrackingKind", fluxora::launchTrackingKindName(result.launchTrackingKind));
        writer.stringArray(L"expectedChildProcessNames", result.expectedChildProcessNames);
        writer.field(L"handoffDisplayName", result.handoffDisplayName);
        writer.field(L"handoffTimeoutMs", static_cast<int>(result.handoffTimeoutMs));
        writer.key(L"launchTrackingMetadata");
        writeLaunchTrackingMetadata(
            writer,
            result.launchTrackingKind,
            result.expectedChildProcessNames,
            result.handoffDisplayName,
            result.handoffTimeoutMs);
        writer.key(L"executableDisplayMetadata");
        writeExecutableDisplayMetadata(
            writer,
            result.executable.id,
            result.executable.displayName,
            std::filesystem::path(result.executable.executablePath).filename().wstring(),
            L"",
            result.executable.workingDirectory.empty() ? L"executableDirectory" : L"",
            false,
            false,
            false);
        writer.field(L"processId", static_cast<int>(result.processId));
        writer.field(L"managerEnvironmentUnchanged", result.managerEnvironmentUnchanged);
        if (!result.managedSessionId.empty())
        {
            writer.field(L"managedSessionId", result.managedSessionId);
            writer.field(L"managedToolKind", result.managedToolKind);
            if (result.outputMod.has_value())
            {
                writer.key(L"outputMod").beginObject();
                writer.field(L"id", result.outputMod->id);
                writer.field(L"displayName", result.outputMod->displayName);
                writer.field(L"folderName", result.outputMod->folderName);
                writer.field(L"path", result.outputMod->path.wstring());
                writer.field(L"provider", result.outputMod->provider);
                writer.endObject();
            }
            writer.field(L"configurationStatus", result.configurationStatus);
            writer.stringArray(L"warnings", result.warnings);
        }
        writer.endObject();
        return writer.str();
    }

    std::wstring serializeManagedLaunchCompletion(
        const fluxora::ManagedLaunchCompletion& completion)
    {
        fluxora::JsonWriter writer;
        writer.beginObject();
        writer.field(L"sessionId", completion.sessionId);
        writer.field(L"outcome", completion.outcome);
        writer.field(L"finalized", completion.finalized);
        writer.field(L"deferred", completion.deferred);
        writer.key(L"outputMod").beginObject();
        writer.field(L"id", completion.outputMod.id);
        writer.field(L"displayName", completion.outputMod.displayName);
        writer.field(L"folderName", completion.outputMod.folderName);
        writer.field(L"path", completion.outputMod.path.wstring());
        writer.field(L"provider", completion.outputMod.provider);
        writer.endObject();
        writer.stringArray(L"warnings", completion.warnings);
        writer.endObject();
        return writer.str();
    }

    void writeBuildPathSettings(
        fluxora::JsonWriter& writer,
        const fluxora::BuildPathSettings& settings)
    {
        writer.beginObject();
        writer.field(L"gameDirectory", settings.gameDirectory.wstring());
        writer.field(L"modsDirectory", settings.modsDirectory.wstring());
        writer.field(L"profilesDirectory", settings.profilesDirectory.wstring());
        writer.field(L"downloadsDirectory", settings.downloadsDirectory.wstring());
        writer.field(L"overwriteDirectory", settings.overwriteDirectory.wstring());
        writer.endObject();
    }

    std::wstring serializeBuildPathSettings(const fluxora::BuildPathSettings& settings)
    {
        fluxora::JsonWriter writer;
        writeBuildPathSettings(writer, settings);
        return writer.str();
    }

    void writeFluxPackSummary(fluxora::JsonWriter& writer, const fluxora::FluxPackSummary& summary)
    {
        writer.beginObject();
        writer.field(L"outputPath", summary.outputPath.wstring());
        writer.field(L"buildName", summary.buildName);
        writer.field(L"formatVersion", summary.formatVersion);
        writer.field(L"manifestBytes", summary.manifestBytes);
        writer.field(L"sourceArchiveCount", summary.sourceArchiveCount);
        writer.field(L"bundledModCount", summary.bundledModCount);
        writer.field(L"generatedAssetCount", summary.generatedAssetCount);
        writer.field(L"customPatchCount", summary.customPatchCount);
        writer.field(L"customConfigCount", summary.customConfigCount);
        writer.field(L"installStepCount", summary.installStepCount);
        writer.field(L"generatedAssetsIncluded", summary.generatedAssetsIncluded);
        writer.field(L"installPlanAvailable", summary.installPlanAvailable);
        writer.field(L"packageType", summary.packageType);
        writer.field(L"compressionMode", summary.compressionMode);
        writer.field(L"logicalPayloadBytes", summary.logicalPayloadBytes);
        writer.field(L"uniquePayloadBytes", summary.uniquePayloadBytes);
        writer.field(L"storedPayloadBytes", summary.storedPayloadBytes);
        writer.field(L"deduplicatedPayloadBytes", summary.deduplicatedPayloadBytes);
        writer.field(L"uniqueChunkCount", summary.uniqueChunkCount);
        writer.field(L"dictionaryCount", summary.dictionaryCount);
        writer.endObject();
    }

    std::wstring serializeFluxPackSummary(const fluxora::FluxPackSummary& summary)
    {
        fluxora::JsonWriter writer;
        writeFluxPackSummary(writer, summary);
        return writer.str();
    }

    std::wstring serializeFluxPackInstallResult(const fluxora::FluxPackInstallResult& result)
    {
        fluxora::JsonWriter writer;
        writer.beginObject();
        writer.key(L"summary");
        writeFluxPackSummary(writer, result.summary);
        writer.field(L"configPath", result.configPath.wstring());
        writer.field(L"projectDirectory", result.projectDirectory.wstring());
        writer.field(L"buildName", result.buildName);
        writer.field(L"totalSourceCount", result.totalSourceCount);
        writer.field(L"installedSourceCount", result.installedSourceCount);
        writer.field(L"pendingSourceCount", result.pendingSourceCount);
        writer.field(L"failedSourceCount", result.failedSourceCount);
        writer.field(L"reusedSourceCount", result.reusedSourceCount);
        writer.field(L"reusedDownloadCount", result.reusedDownloadCount);
        writer.field(L"appliedConfigCount", result.appliedConfigCount);
        writer.field(L"appliedProfileOrderItemCount", result.appliedProfileOrderItemCount);
        writer.field(L"reusedFileCount", result.reusedFileCount);
        writer.field(L"materializedFileCount", result.materializedFileCount);
        writer.field(L"updatedExistingProject", result.updatedExistingProject);
        writer.field(L"hasWarnings", result.hasWarnings);
        writer.endObject();
        return writer.str();
    }

    void writeResolvedTemplate(fluxora::JsonWriter& writer, const fluxora::BuildTemplate& tpl)
    {
        const GameBridgeMetadata metadata = resolveGameBridgeMetadata(tpl);
        writer.beginObject();
        writer.field(L"id", tpl.id);
        writer.field(L"displayName", tpl.displayName);
        writer.field(L"gameName", tpl.gameName);
        writer.field(L"summary", tpl.summary);
        writer.field(L"uiTemplateId", metadata.uiTemplateId);
        writer.field(L"baseTemplateId", tpl.baseTemplateId);
        writer.field(L"defaultProfile", tpl.defaultProfileName);
        writer.field(L"dataDirectory", tpl.dataDirectory);
        writer.field(L"nexusDomain", tpl.nexusDomain);
        writer.stringArray(L"folders", tpl.folders);
        writer.stringArray(L"profileFiles", tpl.profileFiles);
        writer.stringArray(L"basePlugins", tpl.basePlugins);
        writer.stringArray(L"pluginExtensions", tpl.pluginExtensions);
        writer.stringArray(L"archiveExtensions", metadata.archiveExtensions);
        writer.stringArray(L"requiredFiles", metadata.requiredFiles);
        writer.stringArray(L"executables", tpl.executables);
        writeCapabilities(writer, tpl);
        writer.key(L"gameCapabilities");
        writeGameCapabilities(writer, metadata.capabilities);
        writer.key(L"contentLayoutSummary");
        writeContentLayoutSummary(writer, metadata);
        writer.key(L"executableDisplayMetadata");
        writeExecutableDisplayMetadataList(writer, metadata);
        writer.key(L"launchTrackingMetadata");
        writeLaunchTrackingMetadata(writer, metadata);
        writeScriptExtender(writer, tpl);
        writer.endObject();
    }

    std::wstring serializeResolvedTemplate(const fluxora::BuildTemplate& tpl)
    {
        fluxora::JsonWriter writer;
        writeResolvedTemplate(writer, tpl);
        return writer.str();
    }

    void writeOpenedProject(
        fluxora::JsonWriter& writer,
        const fluxora::ProjectOpenResult& result,
        bool tolerateExecutableErrors,
        bool includeWorkspaceDetails)
    {
        const fluxora::ProjectDescriptor& project = result.project;
        fluxora::BuildPathSettings pathSettings{
            project.gamePath,
            project.projectDirectory / L"mods",
            project.projectDirectory / L"profiles",
            project.projectDirectory / L"downloads",
            project.projectDirectory / L"overwrite"
        };
        try
        {
            pathSettings = core().buildPathSettings().loadForConfig(project.configPath);
        }
        catch (const std::exception&)
        {
            if (!tolerateExecutableErrors)
            {
                throw;
            }
        }

        const GameBridgeMetadata metadata = resolveGameBridgeMetadata(result.resolvedTemplate);

        writer.beginObject();
        writer.field(L"id", project.configPath.wstring());
        writer.field(L"name", project.name);
        writer.field(L"templateId", project.templateId);
        writer.field(L"uiTemplateId", metadata.uiTemplateId);
        writer.field(L"gameName", project.gameName);
        writer.field(L"gamePath", pathSettings.gameDirectory.wstring());
        writer.field(L"installRootDirectory", project.installRootDirectory.wstring());
        writer.field(L"projectDirectory", project.projectDirectory.wstring());
        writer.field(L"configPath", project.configPath.wstring());
        writer.key(L"gameCapabilities");
        writeGameCapabilities(writer, metadata.capabilities);
        writer.key(L"gameHealthSummary");
        writeProjectHealthSummary(
            writer,
            project,
            metadata,
            pathSettings.gameDirectory,
            !tolerateExecutableErrors);
        writer.key(L"projectFingerprint");
        writeProjectFingerprint(writer, project.fingerprint);
        writer.key(L"contentLayoutSummary");
        writeContentLayoutSummary(writer, metadata);
        writer.key(L"paths");
        writeBuildPathSettings(writer, pathSettings);

        if (includeWorkspaceDetails)
        {
            writer.key(L"executables");
            if (tolerateExecutableErrors)
            {
                try
                {
                    writeGameExecutableList(writer, core().executables().listProjectExecutables(project.configPath));
                }
                catch (const std::exception&)
                {
                    writer.beginArray().endArray();
                }
            }
            else
            {
                writeGameExecutableList(writer, core().executables().listProjectExecutables(project.configPath));
            }

            writer.key(L"template");
            writeResolvedTemplate(writer, result.resolvedTemplate);
        }
        writer.endObject();
    }

    std::wstring serializeOpenedProject(const fluxora::ProjectOpenResult& result)
    {
        fluxora::JsonWriter writer;
        writeOpenedProject(writer, result, false, true);
        return writer.str();
    }

    std::wstring serializeFluxPackInstallPlan(const fluxora::FluxPackInstallPlan& plan)
    {
        fluxora::JsonWriter writer;
        writer.beginObject();
        writer.key(L"summary");
        writeFluxPackSummary(writer, plan.summary);
        writer.field(L"updatesExistingProject", plan.updatesExistingProject);
        writer.field(L"reusableSourceCount", plan.reusableSourceCount);
        writer.field(L"reusableDownloadCount", plan.reusableDownloadCount);
        writer.field(L"automaticDownloadCount", plan.automaticDownloadCount);
        writer.field(L"manualDownloadCount", plan.manualDownloadCount);
        writer.key(L"sources").beginArray();
        for (const fluxora::FluxPackSourceInstallPlan& source : plan.sources)
        {
            writer.beginObject();
            writer.field(L"sourceId", source.sourceId);
            writer.field(L"providerId", source.providerId);
            writer.field(L"providerDisplayName", source.providerDisplayName);
            writer.field(L"displayName", source.displayName);
            writer.field(L"version", source.version);
            writer.field(L"archiveFileName", source.archiveFileName);
            writer.field(L"manualDownloadUrl", source.manualDownloadUrl);
            writer.field(L"acquisitionMode", source.acquisitionMode);
            writer.field(L"requiresManualDownload", source.requiresManualDownload);
            writer.field(L"canAutomaticallyDownload", source.canAutomaticallyDownload);
            writer.endObject();
        }
        writer.endArray();
        writer.endObject();
        return writer.str();
    }

    std::wstring serializeProjectConfigList(const std::vector<fluxora::ProjectOpenResult>& results)
    {
        fluxora::JsonWriter writer;
        writer.beginArray();
        for (const fluxora::ProjectOpenResult& result : results)
        {
            writeOpenedProject(writer, result, true, false);
        }
        writer.endArray();
        return writer.str();
    }

    std::wstring serializeGameTemplateList(const std::vector<fluxora::BuildTemplate>& templates)
    {
        fluxora::JsonWriter writer;
        writer.beginArray();
        for (const auto& tpl : templates)
        {
            const GameBridgeMetadata metadata = resolveGameBridgeMetadata(tpl);
            writer.beginObject();
            writer.field(L"id", tpl.id);
            writer.field(L"displayName", tpl.displayName);
            writer.field(L"gameName", tpl.gameName);
            writer.field(L"summary", tpl.summary);
            writer.field(L"uiTemplateId", metadata.uiTemplateId);
            writer.key(L"gameCapabilities");
            writeGameCapabilities(writer, metadata.capabilities);
            writer.stringArray(L"archiveExtensions", metadata.archiveExtensions);
            writer.stringArray(L"requiredFiles", metadata.requiredFiles);
            writer.endObject();
        }
        writer.endArray();
        return writer.str();
    }

    std::wstring serializeNexusModsAuthStatus(const fluxora::NexusModsAuthStatus& status)
    {
        fluxora::JsonWriter writer;
        writer.beginObject();
        writer.field(L"isConfigured", status.isConfigured);
        writer.field(L"isLinked", status.isLinked);
        writer.field(L"hasApiKey", status.hasApiKey);
        writer.field(L"isPremium", status.isPremium);
        writer.field(L"displayName", status.displayName);
        writer.field(L"userId", status.userId);
        writer.field(L"message", status.message);
        writer.field(L"clientId", status.clientId);
        writer.field(L"redirectUri", status.redirectUri);
        writer.field(L"requiresReauth", status.requiresReauth);
        writer.endObject();
        return writer.str();
    }

    std::wstring serializeNexusModsApiAuthHeader(const fluxora::NexusModsApiAuthHeader& authHeader)
    {
        fluxora::JsonWriter writer;
        writer.beginObject();
        writer.field(L"isAvailable", authHeader.isAvailable);
        writer.field(L"headerName", authHeader.headerName);
        writer.field(L"headerValue", authHeader.headerValue);
        writer.field(L"credentialKind", authHeader.credentialKind);
        writer.field(L"message", authHeader.message);
        writer.field(
            L"failureKind",
            authHeader.failureKind == fluxora::NexusModsAuthFailureKind::ReauthRequired
                ? L"reauthRequired"
                : authHeader.failureKind == fluxora::NexusModsAuthFailureKind::Temporary
                    ? L"temporary"
                    : L"none");
        writer.endObject();
        return writer.str();
    }

    void writeExternalConnectionStatus(
        fluxora::JsonWriter& writer,
        const fluxora::ExternalConnectionStatus& status)
    {
        writer.beginObject();
        writer.field(L"providerId", status.providerId);
        writer.field(L"label", status.label);
        writer.field(L"state", fluxora::externalConnectionStateName(status.state));
        writer.field(L"accountName", status.accountName);
        writer.field(L"hasStoredSession", status.hasStoredSession);
        writer.field(L"retryable", status.retryable);
        writer.field(L"requiresUserAction", status.requiresUserAction);
        writer.field(L"message", status.message);
        writer.field(L"checkedAtUtc", status.checkedAtUtc);
        writer.field(L"operationId", status.operationId);
        writer.endObject();
    }

    std::wstring serializeExternalConnectionStatus(
        const fluxora::ExternalConnectionStatus& status)
    {
        fluxora::JsonWriter writer;
        writeExternalConnectionStatus(writer, status);
        return writer.str();
    }

    std::wstring serializeExternalConnectionSnapshot(
        const fluxora::ExternalConnectionSnapshot& snapshot)
    {
        fluxora::JsonWriter writer;
        writer.beginObject();
        writer.key(L"providers").beginArray();
        for (const auto& provider : snapshot.providers)
        {
            writeExternalConnectionStatus(writer, provider);
        }
        writer.endArray();
        writer.field(L"requestedAtUtc", snapshot.requestedAtUtc);
        writer.field(L"completedAtUtc", snapshot.completedAtUtc);
        writer.key(L"durationMs").numberValue(std::to_wstring(snapshot.durationMs));
        writer.field(L"timedOut", snapshot.timedOut);
        writer.field(L"operationId", snapshot.operationId);
        writer.endObject();
        return writer.str();
    }

    void writeNullableNumber(fluxora::JsonWriter& writer, std::wstring_view name, long long value)
    {
        writer.key(name);
        if (value >= 0)
        {
            writer.numberValue(std::to_wstring(value));
        }
        else
        {
            writer.nullValue();
        }
    }

    void writeApiRateLimitWindow(fluxora::JsonWriter& writer, const fluxora::ApiRateLimitWindow& window)
    {
        writer.beginObject();
        writer.field(L"id", window.id);
        writer.field(L"label", window.label);
        writer.field(L"period", window.period);
        writeNullableNumber(writer, L"limit", window.limit);
        writeNullableNumber(writer, L"remaining", window.remaining);
        writer.field(L"resetAtUtc", window.resetAtUtc);
        writer.field(L"resetRaw", window.resetRaw);
        writer.endObject();
    }

    void writeApiLimitProvider(fluxora::JsonWriter& writer, const fluxora::ApiLimitProvider& provider)
    {
        writer.beginObject();
        writer.field(L"id", provider.id);
        writer.field(L"label", provider.label);
        writer.field(L"state", provider.state);
        writer.field(L"message", provider.message);
        writer.field(L"updatedAtUtc", provider.updatedAtUtc);
        writer.key(L"windows").beginArray();
        for (const auto& window : provider.windows)
        {
            writeApiRateLimitWindow(writer, window);
        }
        writer.endArray();
        writer.endObject();
    }

    std::wstring serializeApiLimitStatus(const fluxora::ApiLimitStatus& status)
    {
        fluxora::JsonWriter writer;
        writer.beginObject();
        writer.field(L"generatedAtUtc", status.generatedAtUtc);
        writer.key(L"providers").beginArray();
        for (const auto& provider : status.providers)
        {
            writeApiLimitProvider(writer, provider);
        }
        writer.endArray();
        writer.endObject();
        return writer.str();
    }

    void writeDownloadDuplicateFile(
        fluxora::JsonWriter& writer,
        const fluxora::DownloadDuplicateFile& file)
    {
        writer.beginObject();
        writer.field(L"id", file.id);
        writer.field(L"fileId", file.fileId);
        writer.field(L"fileName", file.fileName);
        writer.field(L"version", file.version);
        writer.endObject();
    }

    void writeDownloadEntry(fluxora::JsonWriter& writer, const fluxora::DownloadEntry& download)
    {
        writer.beginObject();
        writer.field(L"id", download.id);
        writer.field(L"name", download.name);
        writer.field(L"fileName", download.fileName);
        writer.field(L"localPath", download.localPath.wstring());
        writer.field(L"source", download.source);
        writer.key(L"archiveId");
        if (download.archiveId.empty())
        {
            writer.nullValue();
        }
        else
        {
            writer.value(download.archiveId);
        }
        writer.key(L"buildStatus");
        if (download.buildStatus.empty())
        {
            writer.nullValue();
        }
        else
        {
            writer.value(download.buildStatus);
        }
        writer.field(L"transferState", download.transferState);
        writer.field(L"transferMessage", download.transferMessage);
        writer.field(L"sizeText", download.sizeText);
        writer.field(L"createdAtText", download.createdAtText);
        writer.field(L"progressPercent", download.progressPercent);
        writer.field(L"progressText", download.progressText);
        writer.field(L"etaText", download.etaText);
        writer.field(L"downloadSpeedText", download.downloadSpeedText);
        writer.field(L"isDownloading", download.isDownloading);
        writer.field(L"hasKnownProgress", download.hasKnownProgress);
        writer.field(L"hasResolvedFileName", download.hasResolvedFileName);
        writer.field(L"canResume", download.canResume);
        writer.field(L"canInstall", download.canInstall);
        writer.field(L"canDelete", download.canDelete);
        writer.key(L"duplicateDecision");
        if (!download.duplicateDecision.has_value())
        {
            writer.nullValue();
        }
        else
        {
            const fluxora::DownloadDuplicateDecision& decision = *download.duplicateDecision;
            writer.beginObject();
            writer.field(L"decisionId", decision.decisionId);
            writer.field(L"direction", decision.direction);
            writer.key(L"incomingFile");
            writeDownloadDuplicateFile(writer, decision.incomingFile);
            writer.key(L"existingFiles").beginArray();
            for (const fluxora::DownloadDuplicateFile& file : decision.existingFiles)
            {
                writeDownloadDuplicateFile(writer, file);
            }
            writer.endArray();
            writer.endObject();
        }
        writer.endObject();
    }

    std::wstring serializeDownloads(const std::vector<fluxora::DownloadEntry>& downloads)
    {
        fluxora::JsonWriter writer;
        writer.beginArray();
        for (const auto& download : downloads)
        {
            writeDownloadEntry(writer, download);
        }
        writer.endArray();
        return writer.str();
    }

    std::wstring serializeDownload(const fluxora::DownloadEntry& download)
    {
        fluxora::JsonWriter writer;
        writeDownloadEntry(writer, download);
        return writer.str();
    }

    std::wstring serializeInstalledMod(const fluxora::InstalledMod& mod)
    {
        fluxora::JsonWriter writer;
        writer.beginObject();
        writer.field(L"id", mod.id.wstring());
        writer.field(L"name", mod.name);
        writer.field(L"version", mod.version);
        writer.field(L"isEnabled", mod.isEnabled);
        writer.field(L"latestVersion", mod.latestVersion);
        writer.field(L"latestFileId", mod.latestFileId);
        writer.field(L"updateCheckState", mod.updateCheckState);
        writer.field(L"sourceIsNexus", mod.sourceIsNexus);
        writer.field(L"sourceIsModdingFlow", mod.sourceIsModdingFlow);
        writer.field(L"sourceProvider", mod.sourceProvider);
        writer.field(L"sourceGameDomain", mod.sourceGameDomain);
        writer.field(L"sourceModId", mod.sourceModId);
        writer.field(L"sourceFileId", mod.sourceFileId);
        writer.field(L"sourceUrl", mod.sourceUrl);
        writer.field(L"isLocal", mod.isLocal);
        writer.field(L"isTranslation", mod.isTranslation);
        writer.field(L"isPatch", mod.isPatch);
        writer.field(L"modUuid", mod.modUuid);
        writer.field(L"orderId", mod.orderId);
        writer.field(L"fileCount", mod.fileCount);
        writer.field(L"conflictingFileCount", mod.conflictingFileCount);
        writer.field(L"overwrittenFileCount", mod.overwrittenFileCount);
        writer.field(L"overwritingFileCount", mod.overwritingFileCount);
        writer.stringArray(L"overwritesModIds", mod.overwritesModIds);
        writer.stringArray(L"overwrittenByModIds", mod.overwrittenByModIds);
        writer.endObject();
        return writer.str();
    }

    std::wstring installConflictSnapshotStateName(
        fluxora::InstallConflictSnapshotState state)
    {
        switch (state)
        {
        case fluxora::InstallConflictSnapshotState::Ready:
            return L"ready";
        case fluxora::InstallConflictSnapshotState::Committing:
            return L"committing";
        case fluxora::InstallConflictSnapshotState::Completed:
            return L"completed";
        case fluxora::InstallConflictSnapshotState::Failed:
            return L"failed";
        case fluxora::InstallConflictSnapshotState::Preparing:
        default:
            return L"preparing";
        }
    }

    void writeInstallConflictSnapshot(
        fluxora::JsonWriter& writer,
        const fluxora::FluxoraInstallConflictSnapshot& snapshot)
    {
        writer.beginObject();
        writer.field(L"operationId", snapshot.operationId);
        writer.field(L"revision", static_cast<std::uint64_t>(snapshot.revision));
        writer.field(L"state", installConflictSnapshotStateName(snapshot.state));
        writer.field(L"pendingOrderId", snapshot.pendingOrderId);
        writer.field(L"orderId", snapshot.orderId);
        writer.field(L"targetIndex", snapshot.targetIndex);
        writer.key(L"rows").beginArray();
        for (const fluxora::InstallConflictRowPatch& row : snapshot.rows)
        {
            writer.beginObject();
            writer.field(L"orderId", row.orderId);
            writer.field(L"modUuid", row.modUuid);
            writer.field(L"fileCount", row.fileCount);
            writer.field(L"conflictingFileCount", row.conflictingFileCount);
            writer.field(L"overwrittenFileCount", row.overwrittenFileCount);
            writer.field(L"overwritingFileCount", row.overwritingFileCount);
            writer.stringArray(L"overwritesModIds", row.overwritesModIds);
            writer.stringArray(L"overwrittenByModIds", row.overwrittenByModIds);
            writer.endObject();
        }
        writer.endArray();
        writer.endObject();
    }

    std::wstring serializeInstallConflictProgress(
        const fluxora::FluxoraInstallConflictSnapshot& snapshot)
    {
        fluxora::JsonWriter writer;
        writer.beginObject();
        writer.field(L"stage", L"install-conflicts");
        writer.field(L"message", L"Install conflict snapshot updated.");
        writer.key(L"installConflictSnapshot");
        writeInstallConflictSnapshot(writer, snapshot);
        writer.endObject();
        return writer.str();
    }

    std::wstring serializeInstallConflictSnapshot(
        const fluxora::FluxoraInstallConflictSnapshot& snapshot)
    {
        fluxora::JsonWriter writer;
        writeInstallConflictSnapshot(writer, snapshot);
        return writer.str();
    }

    fluxora::InstallConflictSnapshotCallback installConflictProgressCallback(
        FluxoraCoreProgressCallback callback,
        void* userData)
    {
        if (callback == nullptr)
        {
            return {};
        }
        return [callback, userData](const fluxora::FluxoraInstallConflictSnapshot& snapshot)
        {
            const std::wstring json = serializeInstallConflictProgress(snapshot);
            callback(json.c_str(), userData);
        };
    }

    std::wstring placementTargetName(fluxora::PlacementTarget target)
    {
        switch (target)
        {
        case fluxora::PlacementTarget::GameRoot:
            return L"gameRoot";
        case fluxora::PlacementTarget::Data:
            return L"data";
        case fluxora::PlacementTarget::Profile:
            return L"profile";
        case fluxora::PlacementTarget::Overwrite:
            return L"overwrite";
        case fluxora::PlacementTarget::Blocked:
            return L"blocked";
        }

        return L"unknown";
    }

    std::wstring contentAreaName(fluxora::ContentArea area)
    {
        switch (area)
        {
        case fluxora::ContentArea::GameRoot:
            return L"gameRoot";
        case fluxora::ContentArea::Data:
            return L"data";
        case fluxora::ContentArea::Profile:
            return L"profile";
        case fluxora::ContentArea::Ini:
            return L"ini";
        case fluxora::ContentArea::Saves:
            return L"saves";
        case fluxora::ContentArea::Overwrite:
            return L"overwrite";
        }

        return L"unknown";
    }

    std::wstring contentLayoutClassificationName(fluxora::ContentLayoutClassification classification)
    {
        switch (classification)
        {
        case fluxora::ContentLayoutClassification::GameData:
            return L"gameData";
        case fluxora::ContentLayoutClassification::GameRoot:
            return L"gameRoot";
        case fluxora::ContentLayoutClassification::Plugin:
            return L"plugin";
        case fluxora::ContentLayoutClassification::Archive:
            return L"archive";
        case fluxora::ContentLayoutClassification::ScriptExtender:
            return L"scriptExtender";
        case fluxora::ContentLayoutClassification::Config:
            return L"config";
        case fluxora::ContentLayoutClassification::Ini:
            return L"ini";
        case fluxora::ContentLayoutClassification::Save:
            return L"save";
        case fluxora::ContentLayoutClassification::ToolExecutable:
            return L"toolExecutable";
        case fluxora::ContentLayoutClassification::Documentation:
            return L"documentation";
        case fluxora::ContentLayoutClassification::Screenshots:
            return L"screenshots";
        case fluxora::ContentLayoutClassification::Unknown:
            return L"unknown";
        case fluxora::ContentLayoutClassification::Unsafe:
            return L"unsafe";
        }

        return L"unknown";
    }

    void writePlacementPlanSummary(
        fluxora::JsonWriter& writer,
        const fluxora::ContentLayoutSummary& summary)
    {
        writer.beginObject();
        writer.field(L"supported", summary.supported);
        writer.field(L"hasWarnings", summary.hasWarnings);
        writer.field(L"hasBlockers", summary.hasBlockers);
        writer.field(L"totalEntries", static_cast<std::uintmax_t>(summary.totalEntries));
        writer.field(L"plannedEntries", static_cast<std::uintmax_t>(summary.plannedEntries));
        writer.field(L"gameDataEntries", static_cast<std::uintmax_t>(summary.gameDataEntries));
        writer.field(L"gameRootEntries", static_cast<std::uintmax_t>(summary.gameRootEntries));
        writer.field(L"pluginEntries", static_cast<std::uintmax_t>(summary.pluginEntries));
        writer.field(L"archiveEntries", static_cast<std::uintmax_t>(summary.archiveEntries));
        writer.field(L"scriptExtenderEntries", static_cast<std::uintmax_t>(summary.scriptExtenderEntries));
        writer.field(L"unknownEntries", static_cast<std::uintmax_t>(summary.unknownEntries));
        writer.field(L"unsafeEntries", static_cast<std::uintmax_t>(summary.unsafeEntries));
        writer.endObject();
    }

    void writePlacementPlanEntry(
        fluxora::JsonWriter& writer,
        const fluxora::PlacementPlanEntry& entry)
    {
        writer.beginObject();
        writer.field(L"sourcePath", entry.sourcePath.path().generic_wstring());
        writer.field(L"target", placementTargetName(entry.target));
        writer.field(L"contentArea", contentAreaName(entry.contentArea));
        writer.field(L"targetRelativePath", entry.targetRelativePath.path().generic_wstring());
        writer.field(L"classification", contentLayoutClassificationName(entry.classification));
        writer.field(L"explanation", entry.explanation);
        writer.field(L"manualOverrideAllowed", entry.manualOverrideAllowed);
        writer.key(L"safeManualTargets").beginArray();
        for (fluxora::PlacementTarget target : entry.safeManualTargets)
        {
            writer.value(placementTargetName(target));
        }
        writer.endArray();
        writer.endObject();
    }

    void writePlacementFinding(
        fluxora::JsonWriter& writer,
        const fluxora::ValidationFinding& finding)
    {
        writer.beginObject();
        writer.field(L"severity", fluxora::GameHealthCheckService::healthSeverityName(finding.severity));
        writer.field(
            L"path",
            finding.path.has_value()
                ? finding.path->path().generic_wstring()
                : std::wstring{});
        writer.field(L"classification", contentLayoutClassificationName(finding.classification));
        writer.field(L"message", finding.message);
        writer.field(L"blocksInstall", finding.blocksInstall);
        writer.endObject();
    }

    std::wstring serializePlacementPlan(const fluxora::PlacementPlan& plan)
    {
        fluxora::JsonWriter writer;
        writer.beginObject();
        writer.field(L"gameId", plan.gameId.value());
        writer.field(L"gameDisplayName", plan.gameDisplayName);
        writer.field(L"rootFileWrapperDirectory", plan.rootFileWrapperDirectory);
        writer.field(L"canInstall", plan.canInstall());
        writer.key(L"summary");
        writePlacementPlanSummary(writer, plan.summary);
        writer.key(L"entries").beginArray();
        for (const fluxora::PlacementPlanEntry& entry : plan.entries)
        {
            writePlacementPlanEntry(writer, entry);
        }
        writer.endArray();
        writer.key(L"validationFindings").beginArray();
        for (const fluxora::ValidationFinding& finding : plan.validationFindings)
        {
            writePlacementFinding(writer, finding);
        }
        writer.endArray();
        writer.field(L"explanationSummary", plan.userExplanation.summary);
        writer.stringArray(L"explanationDetails", plan.userExplanation.details);
        writer.endObject();
        return writer.str();
    }

    void writeFomodFileEntry(fluxora::JsonWriter& writer, const fluxora::FomodFileEntry& file)
    {
        writer.beginObject();
        writer.field(L"source", file.source);
        writer.field(L"destination", file.destination);
        writer.field(L"isFolder", file.isFolder);
        writer.field(L"alwaysInstall", file.alwaysInstall);
        writer.field(L"installIfUsable", file.installIfUsable);
        writer.field(L"priority", file.priority);
        writer.endObject();
    }

    void writeFomodFileDependencyState(
        fluxora::JsonWriter& writer,
        const fluxora::FomodFileDependencyState& dependency)
    {
        writer.beginObject();
        writer.field(L"file", dependency.file);
        writer.field(L"state", dependency.state);
        writer.field(L"sourceKind", dependency.sourceKind);
        writer.field(L"sourceName", dependency.sourceName);
        writer.field(L"exists", dependency.exists);
        writer.endObject();
    }

    std::wstring fomodPluginHeaderStatusName(fluxora::FomodPluginHeaderStatus status)
    {
        switch (status)
        {
        case fluxora::FomodPluginHeaderStatus::Parsed:
            return L"parsed";
        case fluxora::FomodPluginHeaderStatus::Oversize:
            return L"oversize";
        case fluxora::FomodPluginHeaderStatus::CandidateLimit:
            return L"candidateLimit";
        case fluxora::FomodPluginHeaderStatus::ReadBudgetExceeded:
            return L"readBudgetExceeded";
        case fluxora::FomodPluginHeaderStatus::Corrupt:
        default:
            return L"corrupt";
        }
    }

    void writeFomodDependency(fluxora::JsonWriter& writer, const fluxora::FomodDependencyNode& dependency)
    {
        writer.beginObject();
        writer.field(L"kind", dependency.kind);
        writer.field(L"operator", dependency.op);
        writer.field(L"file", dependency.file);
        writer.field(L"state", dependency.state);
        writer.field(L"flag", dependency.flag);
        writer.field(L"value", dependency.value);
        writer.field(L"version", dependency.version);
        writer.key(L"children").beginArray();
        for (const fluxora::FomodDependencyNode& child : dependency.children)
        {
            writeFomodDependency(writer, child);
        }
        writer.endArray();
        writer.endObject();
    }

    void writeFomodOption(fluxora::JsonWriter& writer, const fluxora::FomodOption& option)
    {
        writer.beginObject();
        writer.field(L"id", option.id);
        writer.field(L"name", option.name);
        writer.field(L"description", option.description);
        writer.field(L"imagePath", option.imagePath);
        writer.field(L"type", option.type);
        writer.field(L"defaultType", option.defaultType);
        writer.key(L"flags").beginArray();
        for (const fluxora::FomodConditionFlag& flag : option.flags)
        {
            writer.beginObject();
            writer.field(L"name", flag.name);
            writer.field(L"value", flag.value);
            writer.endObject();
        }
        writer.endArray();
        writer.key(L"typePatterns").beginArray();
        for (const fluxora::FomodTypePattern& pattern : option.typePatterns)
        {
            writer.beginObject();
            writer.key(L"dependencies");
            writeFomodDependency(writer, pattern.dependencies);
            writer.field(L"type", pattern.type);
            writer.endObject();
        }
        writer.endArray();
        writer.key(L"pluginHeaders").beginArray();
        for (const fluxora::FomodPluginHeader& header : option.pluginHeaders)
        {
            writer.beginObject();
            writer.field(L"outputFile", header.outputFile);
            writer.stringArray(L"masters", header.masters);
            writer.field(L"status", fomodPluginHeaderStatusName(header.status));
            writer.field(L"issueCode", header.issueCode);
            writer.endObject();
        }
        writer.endArray();
        writer.endObject();
    }

    void writeFomodGroup(fluxora::JsonWriter& writer, const fluxora::FomodGroup& group)
    {
        writer.beginObject();
        writer.field(L"id", group.id);
        writer.field(L"name", group.name);
        writer.field(L"type", group.type);
        writer.key(L"options").beginArray();
        for (const fluxora::FomodOption& option : group.options)
        {
            writeFomodOption(writer, option);
        }
        writer.endArray();
        writer.endObject();
    }

    void writeFomodStep(fluxora::JsonWriter& writer, const fluxora::FomodStep& step)
    {
        writer.beginObject();
        writer.field(L"id", step.id);
        writer.field(L"name", step.name);
        writer.key(L"visible");
        if (step.visible.has_value())
        {
            writeFomodDependency(writer, step.visible.value());
        }
        else
        {
            writer.nullValue();
        }
        writer.key(L"groups").beginArray();
        for (const fluxora::FomodGroup& group : step.groups)
        {
            writeFomodGroup(writer, group);
        }
        writer.endArray();
        writer.endObject();
    }

    void writeFomodDetectedVersion(
        fluxora::JsonWriter& writer,
        const fluxora::FomodDetectedVersion& version)
    {
        writer.beginObject();
        writer.field(L"kind", version.kind);
        writer.field(L"displayName", version.displayName);
        writer.field(L"version", version.version);
        writer.field(L"known", version.known);
        writer.endObject();
    }

    void writeFomodProfileContext(
        fluxora::JsonWriter& writer,
        const fluxora::FomodProfileContext& context)
    {
        writer.beginObject();
        writer.field(L"contextId", context.contextId);
        writer.field(L"profileName", context.profileName);
        writer.field(L"fingerprint", context.fingerprint);
        writer.field(L"modCatalogRevision", static_cast<std::uintmax_t>(context.modCatalogRevision));
        writer.field(L"modRevision", context.modRevision);
        writer.field(L"pluginRevision", context.pluginRevision);
        writer.field(L"autoSelectionAvailable", context.autoSelectionAvailable);
        writer.field(L"unavailableReason", context.unavailableReason);
        writer.key(L"gameVersion");
        writeFomodDetectedVersion(writer, context.gameVersion);
        writer.key(L"extenderVersions").beginArray();
        for (const fluxora::FomodDetectedVersion& version : context.extenderVersions)
        {
            writeFomodDetectedVersion(writer, version);
        }
        writer.endArray();
        writer.stringArray(L"basePluginNames", context.basePluginNames);
        writer.key(L"fileStates").beginArray();
        for (const fluxora::FomodProfileFileState& state : context.fileStates)
        {
            writer.beginObject();
            writer.field(L"file", state.file);
            writer.field(L"state", fluxora::FomodProfileContextService::stateName(state.state));
            writer.field(L"sourceKind", state.sourceKind);
            writer.field(L"sourceName", state.sourceName);
            writer.field(L"exists", state.exists);
            writer.endObject();
        }
        writer.endArray();
        writer.endObject();
    }

    void writeFomodDecisionEvidence(
        fluxora::JsonWriter& writer,
        const fluxora::FomodDecisionEvidence& evidence)
    {
        writer.beginObject();
        writer.field(L"code", evidence.code);
        writer.field(L"subject", evidence.subject);
        writer.field(L"expected", evidence.expected);
        writer.field(L"actual", evidence.actual);
        writer.field(L"sourceKind", evidence.sourceKind);
        writer.field(L"sourceName", evidence.sourceName);
        writer.endObject();
    }

    void writeFomodAutoSelection(
        fluxora::JsonWriter& writer,
        const fluxora::FomodAutoSelection& selection)
    {
        writer.beginObject();
        writer.field(L"contextId", selection.contextId);
        writer.stringArray(L"initialSelectedOptionIds", selection.initialSelectedOptionIds);
        writer.key(L"unresolvedGroups").beginArray();
        for (const fluxora::FomodUnresolvedGroup& group : selection.unresolvedGroups)
        {
            writer.beginObject();
            writer.field(L"stepId", group.stepId);
            writer.field(L"groupId", group.groupId);
            writer.field(L"groupName", group.groupName);
            writer.field(L"reasonCode", group.reasonCode);
            writer.stringArray(L"optionIds", group.optionIds);
            writer.endObject();
        }
        writer.endArray();
        writer.key(L"decisions").beginArray();
        for (const fluxora::FomodOptionDecision& decision : selection.decisions)
        {
            writer.beginObject();
            writer.field(L"optionId", decision.optionId);
            writer.field(L"action", fluxora::FomodAutoSelectionService::actionName(decision.action));
            writer.field(L"confidence", fluxora::FomodAutoSelectionService::confidenceName(decision.confidence));
            writer.field(L"effectiveType", decision.effectiveType);
            writer.stringArray(L"reasonCodes", decision.reasonCodes);
            writer.key(L"evidence").beginArray();
            for (const fluxora::FomodDecisionEvidence& evidence : decision.evidence)
            {
                writeFomodDecisionEvidence(writer, evidence);
            }
            writer.endArray();
            writer.endObject();
        }
        writer.endArray();
        writer.field(
            L"moduleDependencyResult",
            fluxora::FomodAutoSelectionService::dependencyResultName(selection.moduleDependencyResult));
        writer.field(L"installBlocked", selection.installBlocked);
        writer.field(L"cycleDetected", selection.cycleDetected);
        writer.stringArray(L"warnings", selection.warnings);
        writer.endObject();
    }

    void writeFomodInstaller(
        fluxora::JsonWriter& writer,
        const fluxora::FomodInstallerDescriptor& descriptor)
    {
        writer.beginObject();
        writer.field(L"isFomod", descriptor.isFomod);
        writer.field(L"moduleName", descriptor.moduleName);
        writer.field(L"moduleVersion", descriptor.moduleVersion);
        writer.field(L"moduleId", descriptor.moduleId);
        writer.field(L"moduleImagePath", descriptor.moduleImagePath);
        writer.field(L"memoryKey", descriptor.memoryKey);
        writer.field(L"structureFingerprint", descriptor.structureFingerprint);
        writer.field(L"selectionOrigin", descriptor.selectionOrigin);
        writer.field(L"hasPreviousSelection", descriptor.hasPreviousSelection);
        writer.field(L"previousSelectionContextual", descriptor.previousSelectionContextual);
        writer.field(L"previousSelectionWeak", descriptor.previousSelectionWeak);
        writer.stringArray(L"previousSelectedOptionIds", descriptor.previousSelectedOptionIds);
        writer.stringArray(L"previousDeselectedOptionIds", descriptor.previousDeselectedOptionIds);
        writer.key(L"moduleDependencies");
        if (descriptor.moduleDependencies.has_value())
        {
            writeFomodDependency(writer, descriptor.moduleDependencies.value());
        }
        else
        {
            writer.nullValue();
        }
        writer.key(L"fileDependencies").beginArray();
        for (const fluxora::FomodFileDependencyState& dependency : descriptor.fileDependencyStates)
        {
            writeFomodFileDependencyState(writer, dependency);
        }
        writer.endArray();
        writer.key(L"requiredFiles").beginArray();
        for (const fluxora::FomodFileEntry& file : descriptor.requiredFiles)
        {
            writeFomodFileEntry(writer, file);
        }
        writer.endArray();
        writer.key(L"steps").beginArray();
        for (const fluxora::FomodStep& step : descriptor.steps)
        {
            writeFomodStep(writer, step);
        }
        writer.endArray();
        writer.key(L"conditionalFilePatterns").beginArray();
        for (const fluxora::FomodConditionalFilePattern& pattern : descriptor.conditionalFilePatterns)
        {
            writer.beginObject();
            writer.key(L"dependencies");
            writeFomodDependency(writer, pattern.dependencies);
            writer.key(L"files").beginArray();
            for (const fluxora::FomodFileEntry& file : pattern.files)
            {
                writeFomodFileEntry(writer, file);
            }
            writer.endArray();
            writer.endObject();
        }
        writer.endArray();
        writer.key(L"profileContext");
        if (descriptor.profileContext != nullptr)
        {
            writeFomodProfileContext(writer, *descriptor.profileContext);
        }
        else
        {
            writer.nullValue();
        }
        writer.key(L"autoSelection");
        if (descriptor.autoSelection != nullptr)
        {
            writeFomodAutoSelection(writer, *descriptor.autoSelection);
        }
        else
        {
            writer.nullValue();
        }
        writer.endObject();
    }

    void writeInstalledModEntry(fluxora::JsonWriter& writer, const fluxora::InstalledModEntry& mod)
    {
        writer.beginObject();
        writer.field(L"id", mod.id.wstring());
        writer.field(L"name", mod.name);
        writer.field(L"version", mod.version);
        writer.field(L"installedAt", mod.installedAt);
        writer.field(L"updatedAt", mod.updatedAt);
        writer.field(L"latestVersion", mod.latestVersion);
        writer.field(L"lastCheckedAt", mod.lastCheckedAt);
        writer.field(L"updateStatus", mod.updateStatus);
        writer.field(L"conflictStatus", mod.conflictStatus);
        writer.field(L"fileCount", mod.fileCount);
        writer.field(L"conflictingFileCount", mod.conflictingFileCount);
        writer.field(L"overwrittenFileCount", mod.overwrittenFileCount);
        writer.field(L"overwritingFileCount", mod.overwritingFileCount);
        writer.field(L"isEnabled", mod.isEnabled);
        writer.field(L"canCheckUpdates", mod.canCheckUpdates);
        writer.field(L"hasUpdate", mod.hasUpdate);
        writer.field(L"sourceIsNexus", mod.sourceIsNexus);
        writer.field(L"sourceIsModdingFlow", mod.sourceIsModdingFlow);
        writer.field(L"isLocal", mod.isLocal);
        writer.field(L"isTranslation", mod.isTranslation);
        writer.field(L"isPatch", mod.isPatch);
        writer.field(L"sourceProvider", mod.sourceProvider);
        writer.field(L"sourceGameDomain", mod.sourceGameDomain);
        writer.field(L"sourceModId", mod.sourceModId);
        writer.field(L"sourceFileId", mod.sourceFileId);
        writer.field(L"sourceUrl", mod.sourceUrl);
        writer.stringArray(L"overwritesModIds", mod.overwritesModIds);
        writer.stringArray(L"overwrittenByModIds", mod.overwrittenByModIds);
        writer.endObject();
    }

    std::wstring serializeInstalledModList(const std::vector<fluxora::InstalledModEntry>& mods)
    {
        fluxora::JsonWriter writer;
        writer.beginArray();
        for (const auto& mod : mods)
        {
            writeInstalledModEntry(writer, mod);
        }
        writer.endArray();
        return writer.str();
    }

    std::wstring serializeInstalledModEntry(const fluxora::InstalledModEntry& mod)
    {
        fluxora::JsonWriter writer;
        writeInstalledModEntry(writer, mod);
        return writer.str();
    }

    std::wstring modUpdateStateText(fluxora::ModUpdateCheckState state)
    {
        switch (state)
        {
        case fluxora::ModUpdateCheckState::Completed:
            return L"completed";
        case fluxora::ModUpdateCheckState::Skipped:
            return L"skipped";
        case fluxora::ModUpdateCheckState::Partial:
            return L"partial";
        case fluxora::ModUpdateCheckState::Cancelled:
            return L"cancelled";
        }
        return L"partial";
    }

    std::wstring modUpdateReasonText(fluxora::ModUpdateCheckReason reason)
    {
        switch (reason)
        {
        case fluxora::ModUpdateCheckReason::None:
            return L"none";
        case fluxora::ModUpdateCheckReason::NoEligibleMods:
            return L"noEligibleMods";
        case fluxora::ModUpdateCheckReason::DailyTtl:
            return L"dailyTtl";
        case fluxora::ModUpdateCheckReason::AuthenticationUnavailable:
            return L"authenticationUnavailable";
        case fluxora::ModUpdateCheckReason::QuotaReserve:
            return L"quotaReserve";
        case fluxora::ModUpdateCheckReason::RateLimited:
            return L"rateLimited";
        case fluxora::ModUpdateCheckReason::OfflineBackoff:
            return L"offlineBackoff";
        case fluxora::ModUpdateCheckReason::NetworkError:
            return L"networkError";
        case fluxora::ModUpdateCheckReason::Cancelled:
            return L"cancelled";
        case fluxora::ModUpdateCheckReason::AmbiguousMetadata:
            return L"ambiguousMetadata";
        case fluxora::ModUpdateCheckReason::MetadataUnavailable:
            return L"metadataUnavailable";
        }
        return L"metadataUnavailable";
    }

    void writeSignedField(fluxora::JsonWriter& writer, std::wstring_view name, long long value)
    {
        writer.key(name).numberValue(std::to_wstring(value));
    }

    std::wstring serializeModUpdateCheckResult(const fluxora::ModUpdateCheckResult& result)
    {
        fluxora::JsonWriter writer;
        writer.beginObject();
        writer.field(L"state", modUpdateStateText(result.state));
        writer.field(L"reason", modUpdateReasonText(result.reason));
        writer.field(L"nextEligibleAt", result.nextEligibleAt);
        writer.key(L"quota").beginObject();
        writeSignedField(writer, L"hourlyLimit", result.quota.hourlyLimit);
        writeSignedField(writer, L"hourlyRemaining", result.quota.hourlyRemaining);
        writer.field(L"hourlyResetAt", result.quota.hourlyResetAt);
        writeSignedField(writer, L"dailyLimit", result.quota.dailyLimit);
        writeSignedField(writer, L"dailyRemaining", result.quota.dailyRemaining);
        writer.field(L"dailyResetAt", result.quota.dailyResetAt);
        writer.field(L"capturedAt", result.quota.capturedAt);
        writer.endObject();
        writer.key(L"counters").beginObject();
        writer.field(L"apiRequests", static_cast<std::uintmax_t>(result.counters.apiRequests));
        writer.field(L"cacheHits", static_cast<std::uintmax_t>(result.counters.cacheHits));
        writer.field(L"checked", static_cast<std::uintmax_t>(result.counters.checked));
        writer.field(L"updates", static_cast<std::uintmax_t>(result.counters.updates));
        writer.field(L"ambiguous", static_cast<std::uintmax_t>(result.counters.ambiguous));
        writer.field(L"failed", static_cast<std::uintmax_t>(result.counters.failed));
        writer.endObject();
        writer.key(L"mods").beginArray();
        for (const fluxora::ModUpdateInstalledMod& mod : result.mods)
        {
            writer.beginObject();
            writer.field(L"folderName", mod.folderName);
            writer.field(L"latestVersion", mod.latestVersion);
            writer.field(L"latestFileId", mod.latestFileId);
            writer.field(L"updateCheckState", mod.updateCheckState);
            writer.field(L"hasUpdate", mod.hasUpdate);
            writer.endObject();
        }
        writer.endArray();
        writer.endObject();
        return writer.str();
    }

    void writeProfileModOrderItem(fluxora::JsonWriter& writer, const fluxora::ProfileModOrderItem& item)
    {
        const bool isSeparator = item.kind == L"separator";

        writer.beginObject();
        writer.field(L"id", isSeparator ? item.orderId : item.id.wstring());
        writer.field(L"orderId", item.orderId);
        writer.field(L"kind", item.kind);
        writer.field(L"order", item.order);
        writer.field(L"isSeparator", isSeparator);
        writer.field(L"isMod", !isSeparator);
        writer.field(L"modUuid", item.modUuid);
        writer.field(L"separatorTitle", item.separatorTitle);
        writer.field(L"name", item.name);
        writer.field(L"version", item.version);
        writer.field(L"latestVersion", item.latestVersion);
        writer.field(L"latestFileId", item.latestFileId);
        writer.field(L"updateCheckState", item.updateCheckState);
        writer.field(L"lastCheckedAt", item.lastCheckedAt);
        writer.field(L"updateStatus", item.updateStatus);
        writer.field(L"conflictStatus", item.conflictStatus);
        writer.field(L"fileCount", item.fileCount);
        writer.field(L"conflictingFileCount", item.conflictingFileCount);
        writer.field(L"overwrittenFileCount", item.overwrittenFileCount);
        writer.field(L"overwritingFileCount", item.overwritingFileCount);
        writer.field(L"isEnabled", item.isEnabled);
        writer.field(L"canCheckUpdates", item.canCheckUpdates);
        writer.field(L"hasUpdate", item.hasUpdate);
        writer.field(L"sourceIsNexus", item.sourceIsNexus);
        writer.field(L"sourceIsModdingFlow", item.sourceIsModdingFlow);
        writer.field(L"isLocal", item.isLocal);
        writer.field(L"isTranslation", item.isTranslation);
        writer.field(L"isPatch", item.isPatch);
        writer.field(L"sourceProvider", item.sourceProvider);
        writer.field(L"sourceGameDomain", item.sourceGameDomain);
        writer.field(L"sourceModId", item.sourceModId);
        writer.field(L"sourceFileId", item.sourceFileId);
        writer.field(L"sourceUrl", item.sourceUrl);
        writer.stringArray(L"overwritesModIds", item.overwritesModIds);
        writer.stringArray(L"overwrittenByModIds", item.overwrittenByModIds);
        writer.endObject();
    }

    std::wstring serializeProfileModOrder(const std::vector<fluxora::ProfileModOrderItem>& items)
    {
        fluxora::JsonWriter writer;
        writer.beginArray();
        for (const auto& item : items)
        {
            writeProfileModOrderItem(writer, item);
        }
        writer.endArray();
        return writer.str();
    }

    void writeModFileTreeEntry(fluxora::JsonWriter& writer, const fluxora::ModFileTreeEntry& entry)
    {
        writer.beginObject();
        writer.field(L"name", entry.name);
        writer.field(L"relativePath", entry.relativePath);
        writer.field(L"isDirectory", entry.isDirectory);
        writer.field(L"hasChildren", entry.hasChildren);
        writer.field(L"size", entry.size);
        writer.field(L"conflictState", entry.conflictState);
        writer.stringArray(L"conflictOwners", entry.conflictOwners);
        writer.endObject();
    }

    std::wstring serializeModFileTree(const std::vector<fluxora::ModFileTreeEntry>& entries)
    {
        fluxora::JsonWriter writer;
        writer.beginArray();
        for (const auto& entry : entries)
        {
            writeModFileTreeEntry(writer, entry);
        }
        writer.endArray();
        return writer.str();
    }

    std::wstring serializeModWorkspaceSnapshot(const fluxora::ModWorkspaceSnapshot& snapshot)
    {
        fluxora::JsonWriter writer;
        writer.beginObject();
        writer.key(L"installedMods").beginArray();
        for (const fluxora::InstalledModEntry& mod : snapshot.installedMods)
        {
            writeInstalledModEntry(writer, mod);
        }
        writer.endArray();
        writer.key(L"modOrder").beginArray();
        for (const fluxora::ProfileModOrderItem& item : snapshot.modOrder)
        {
            writeProfileModOrderItem(writer, item);
        }
        writer.endArray();
        writer.endObject();
        return writer.str();
    }

    std::wstring serializeFomodInstaller(const fluxora::FomodInstallerDescriptor& descriptor)
    {
        fluxora::JsonWriter writer;
        writeFomodInstaller(writer, descriptor);
        return writer.str();
    }

    std::wstring identityResolutionKindName(fluxora::ModIdentityResolutionKind kind)
    {
        switch (kind)
        {
        case fluxora::ModIdentityResolutionKind::Exact:
            return L"exact";
        case fluxora::ModIdentityResolutionKind::Probable:
            return L"probable";
        case fluxora::ModIdentityResolutionKind::None:
        default:
            return L"none";
        }
    }

    std::wstring serializeInstallPlan(const fluxora::FluxoraInstallPlan& plan)
    {
        fluxora::JsonWriter writer;
        writer.beginObject();
        writer.field(L"suggestedModName", plan.suggestedModName);
        writer.field(L"resolutionKind", identityResolutionKindName(plan.resolutionKind));
        writer.key(L"matchedTarget");
        if (plan.matchedTarget.has_value())
        {
            writer.beginObject();
            writer.field(L"modUuid", plan.matchedTarget->modUuid);
            writer.field(L"displayName", plan.matchedTarget->displayName);
            writer.field(L"folderName", plan.matchedTarget->folderName);
            writer.endObject();
        }
        else
        {
            writer.nullValue();
        }
        writer.field(L"resolutionId", plan.resolutionId);
        writer.key(L"fomodInstaller");
        writeFomodInstaller(writer, plan.fomodInstaller);
        writer.stringArray(L"evidenceCodes", plan.evidenceCodes);
        writer.field(L"score", plan.score);
        writer.endObject();
        return writer.str();
    }

    void writeModConflictTree(fluxora::JsonWriter& writer, const fluxora::ModConflictTreePage& page)
    {
        writer.beginObject();
        writer.field(L"modPath", page.modPath.wstring());
        writer.field(L"totalOverwrites", page.totalOverwrites);
        writer.field(L"totalOverwritten", page.totalOverwritten);
        writer.field(L"limit", page.limit);
        if (page.nextCursor.empty())
        {
            writer.key(L"nextCursor").nullValue();
        }
        else
        {
            writer.field(L"nextCursor", page.nextCursor);
        }
        writer.key(L"overwrites").beginArray();
        for (const auto& entry : page.overwrites)
        {
            writeModFileTreeEntry(writer, entry);
        }
        writer.endArray();
        writer.key(L"overwritten").beginArray();
        for (const auto& entry : page.overwritten)
        {
            writeModFileTreeEntry(writer, entry);
        }
        writer.endArray();
        writer.endObject();
    }

    std::wstring serializeModConflictTree(const fluxora::ModConflictTreePage& page)
    {
        fluxora::JsonWriter writer;
        writeModConflictTree(writer, page);
        return writer.str();
    }

    std::wstring serializeModDetailsContent(const fluxora::ModDetailsContent& content)
    {
        fluxora::JsonWriter writer;
        writer.beginObject();
        writer.field(L"modPath", content.modPath.wstring());
        writer.key(L"directories").beginArray();
        for (const fluxora::ModFileTreeDirectory& directory : content.directories)
        {
            writer.beginObject();
            writer.field(L"relativePath", directory.relativePath);
            writer.key(L"entries").beginArray();
            for (const fluxora::ModFileTreeEntry& entry : directory.entries)
            {
                writeModFileTreeEntry(writer, entry);
            }
            writer.endArray();
            writer.endObject();
        }
        writer.endArray();
        writer.key(L"conflictTree");
        writeModConflictTree(writer, content.conflictTree);
        writer.endObject();
        return writer.str();
    }

    std::wstring serializeModDetailsSummary(const fluxora::ProfileModOrderItem& item)
    {
        fluxora::JsonWriter writer;
        writeProfileModOrderItem(writer, item);
        return writer.str();
    }

    void writeEffectiveFileTreeEntry(
        fluxora::JsonWriter& writer,
        const fluxora::EffectiveFileTreeEntry& entry)
    {
        writer.beginObject();
        writer.field(L"name", entry.name);
        writer.field(L"relativePath", entry.relativePath);
        writer.field(L"parentPath", entry.parentPath);
        writer.field(L"isDirectory", entry.isDirectory);
        writer.field(L"hasChildren", entry.hasChildren);
        writer.field(L"size", entry.size);
        writer.field(L"virtualPath", entry.virtualPath);
        writer.field(L"sourceKind", entry.sourceKind);
        writer.field(L"sourceName", entry.sourceName);
        writer.field(L"sourcePath", entry.sourcePath.wstring());
        writer.endObject();
    }

    std::wstring serializeEffectiveFileTree(
        const fluxora::EffectiveFileTreeSnapshot& snapshot)
    {
        fluxora::JsonWriter writer;
        writer.beginObject();
        writer.field(L"profileName", snapshot.profileName);
        writer.field(L"revision", snapshot.revision);
        writer.field(L"totalFileCount", snapshot.totalFileCount);
        writer.field(L"totalFileCountKnown", snapshot.totalFileCountKnown);
        writer.key(L"entries").beginArray();
        for (const auto& entry : snapshot.entries)
        {
            writeEffectiveFileTreeEntry(writer, entry);
        }
        writer.endArray();
        writer.endObject();
        return writer.str();
    }

    std::wstring serializeEffectiveFileTreePage(const fluxora::EffectiveFileTreePage& page)
    {
        fluxora::JsonWriter writer;
        writer.beginObject();
        writer.field(L"profileName", page.profileName);
        writer.field(L"revision", page.revision);
        writer.field(L"parentPath", page.parentPath);
        writer.field(L"totalFileCount", page.totalFileCount);
        writer.field(L"totalFileCountKnown", page.totalFileCountKnown);
        writer.field(L"totalChildCount", page.totalChildCount);
        writer.field(L"limit", page.limit);
        if (page.nextCursor.empty())
        {
            writer.key(L"nextCursor").nullValue();
        }
        else
        {
            writer.field(L"nextCursor", page.nextCursor);
        }
        writer.key(L"entries").beginArray();
        for (const auto& entry : page.entries)
        {
            writeEffectiveFileTreeEntry(writer, entry);
        }
        writer.endArray();
        writer.endObject();
        return writer.str();
    }

    std::wstring serializeEffectiveFileTreeWarmup(
        const fluxora::EffectiveFileTreeIndexWarmupResult& result)
    {
        fluxora::JsonWriter writer;
        writer.beginObject();
        writer.field(L"profileName", result.profileName);
        writer.field(L"revision", result.revision);
        writer.field(L"totalFileCount", result.totalFileCount);
        writer.field(L"totalEntryCount", result.totalEntryCount);
        writer.field(L"cacheHit", result.cacheHit);
        writer.endObject();
        return writer.str();
    }

    void writeModPreviewVariant(fluxora::JsonWriter& writer, const fluxora::ModPreviewVariant& variant)
    {
        writer.beginObject();
        writer.field(L"modPath", variant.modPath.wstring());
        writer.field(L"modName", variant.modName);
        writer.field(L"order", variant.order);
        writer.field(L"enabled", variant.enabled);
        writer.field(L"relativePath", variant.relativePath);
        writer.field(L"size", variant.size);
        writer.endObject();
    }

    void writeNifPreviewPreparedAsset(
        fluxora::JsonWriter& writer,
        const fluxora::NifPreviewPreparedAsset& asset)
    {
        writer.beginObject();
        writer.field(L"resolvedPath", asset.resolvedPath.wstring());
        writer.field(L"kind", asset.kind);
        writer.field(L"relativePath", asset.relativePath);
        writer.field(L"fileName", asset.fileName);
        writer.field(L"size", asset.size);
        writer.field(L"mimeType", asset.mimeType);
        writer.field(L"source", asset.source);
        writer.field(L"contentKey", asset.contentKey);
        writer.endObject();
    }

    std::wstring serializeNifPreviewStart(const fluxora::NifPreviewStartResult& result)
    {
        fluxora::JsonWriter writer;
        writer.beginObject();
        writer.key(L"variants").beginArray();
        for (const auto& variant : result.variants)
        {
            writeModPreviewVariant(writer, variant);
        }
        writer.endArray();
        writer.field(L"activeIndex", result.activeIndex);
        writer.key(L"model");
        writeNifPreviewPreparedAsset(writer, result.model);
        writer.endObject();
        return writer.str();
    }

    std::wstring serializeNifPreviewPreparedAsset(
        const fluxora::NifPreviewPreparedAsset& asset)
    {
        fluxora::JsonWriter writer;
        writeNifPreviewPreparedAsset(writer, asset);
        return writer.str();
    }

    std::wstring serializeNifPreviewTextureBatch(
        const fluxora::NifPreviewTextureBatchResult& result)
    {
        fluxora::JsonWriter writer;
        writer.beginObject();
        writer.key(L"assets").beginArray();
        for (const auto& asset : result.assets)
        {
            writeNifPreviewPreparedAsset(writer, asset);
        }
        writer.endArray();
        writer.stringArray(L"missing", result.missing);
        writer.field(L"totalBytes", result.totalBytes);
        writer.field(L"archiveIndexHits", result.archiveIndexHits);
        writer.field(L"archiveIndexMisses", result.archiveIndexMisses);
        writer.field(L"archiveAssetCacheHits", result.archiveAssetCacheHits);
        writer.field(L"archiveAssetCacheMisses", result.archiveAssetCacheMisses);
        writer.endObject();
        return writer.str();
    }

    void writePluginEntry(fluxora::JsonWriter& writer, const fluxora::PluginEntry& plugin)
    {
        const bool isSeparator = plugin.kind == L"separator";

        writer.beginObject();
        writer.field(L"id", isSeparator ? plugin.orderId : plugin.name);
        writer.field(L"orderId", plugin.orderId);
        writer.field(L"kind", plugin.kind);
        writer.field(L"order", plugin.order);
        writer.field(L"isSeparator", isSeparator);
        writer.field(L"isPlugin", !isSeparator);
        writer.field(L"name", plugin.name);
        writer.field(L"separatorTitle", plugin.separatorTitle);
        writer.field(L"extension", plugin.extension);
        writer.field(L"sourceMod", plugin.sourceMod);
        writer.field(L"path", plugin.path.wstring());
        writer.field(L"isEnabled", plugin.isEnabled);
        writer.field(L"isMaster", plugin.isMaster);
        writer.field(L"isLight", plugin.isLight);
        writer.field(L"hasLightFlag", plugin.hasLightFlag);
        writer.field(L"isLocked", plugin.isLocked);
        writer.field(L"lockReason", plugin.lockReason);
        writer.stringArray(L"masterFiles", plugin.masterFiles);
        writer.stringArray(L"missingMasters", plugin.missingMasters);
        writer.endObject();
    }

    std::wstring serializePlugins(const std::vector<fluxora::PluginEntry>& plugins)
    {
        fluxora::JsonWriter writer;
        writer.beginArray();
        for (const auto& plugin : plugins)
        {
            writePluginEntry(writer, plugin);
        }
        writer.endArray();
        return writer.str();
    }

    std::wstring serializeNxmProtocolStatus(bool isRegistered)
    {
        fluxora::JsonWriter writer;
        writer.beginObject();
        writer.field(L"isRegistered", isRegistered);
        writer.endObject();
        return writer.str();
    }

    std::wstring serializeModOrganizerImportAnalysis(const fluxora::ModOrganizerImportAnalysis& analysis)
    {
        fluxora::JsonWriter writer;
        writer.beginObject();
        writer.field(L"sourceDirectory", analysis.sourceDirectory.wstring());
        writer.field(L"destinationRootDirectory", analysis.destinationRootDirectory.wstring());
        writer.field(L"targetProjectDirectory", analysis.targetProjectDirectory.wstring());
        writer.field(L"targetConfigPath", analysis.targetConfigPath.wstring());
        writer.field(L"projectName", analysis.projectName);
        writer.field(L"profileName", analysis.profileName);
        writer.field(L"templateId", analysis.templateId);
        writer.field(L"gameName", analysis.gameName);
        writer.field(L"gamePath", analysis.gamePath.wstring());
        writer.field(L"totalBytes", analysis.totalBytes);
        writer.field(L"availableBytes", analysis.availableBytes);
        writer.field(L"modCount", analysis.modCount);
        writer.field(L"separatorCount", analysis.separatorCount);
        writer.field(L"hasEnoughSpace", analysis.hasEnoughSpace);
        writer.field(L"willOverwrite", analysis.willOverwrite);
        writer.field(L"canImport", analysis.canImport);
        writer.field(L"statusMessage", analysis.statusMessage);
        writer.field(L"warningMessage", analysis.warningMessage);
        writer.endObject();
        return writer.str();
    }

    std::wstring serializeModOrganizerImportProgress(const fluxora::ModOrganizerImportProgress& progress)
    {
        fluxora::JsonWriter writer;
        writer.beginObject();
        writer.field(L"phase", progress.phase);
        writer.field(L"currentStep", progress.currentStep);
        writer.field(L"currentItem", progress.currentItem);
        writer.field(L"overallPercent", progress.overallPercent);
        writer.field(L"copyPercent", progress.copyPercent);
        writer.field(L"databasePercent", progress.databasePercent);
        writer.field(L"copiedBytes", progress.copiedBytes);
        writer.field(L"totalBytes", progress.totalBytes);
        writer.endObject();
        return writer.str();
    }

    std::wstring serializeFluxPackInstallProgress(const fluxora::FluxPackInstallProgress& progress)
    {
        fluxora::JsonWriter writer;
        writer.beginObject();
        writer.field(L"phase", progress.phase);
        writer.field(L"currentStep", progress.currentStep);
        writer.field(L"currentItem", progress.currentItem);
        writer.field(L"statusMessage", progress.statusMessage);
        writer.field(L"overallPercent", progress.overallPercent);
        writer.field(L"totalSourceCount", progress.totalSourceCount);
        writer.field(L"installedSourceCount", progress.installedSourceCount);
        writer.field(L"pendingSourceCount", progress.pendingSourceCount);
        writer.field(L"failedSourceCount", progress.failedSourceCount);
        writer.key(L"providers").beginArray();
        for (const fluxora::FluxPackProviderProgress& provider : progress.providers)
        {
            writer.beginObject();
            writer.field(L"providerId", provider.providerId);
            writer.field(L"displayName", provider.displayName);
            writer.field(L"totalCount", provider.totalCount);
            writer.field(L"completedCount", provider.completedCount);
            writer.field(L"pendingCount", provider.pendingCount);
            writer.field(L"failedCount", provider.failedCount);
            writer.field(L"currentItem", provider.currentItem);
            writer.field(L"statusText", provider.statusText);
            writer.field(L"progressPercent", provider.progressPercent);
            writer.endObject();
        }
        writer.endArray();
        writer.endObject();
        return writer.str();
    }

    std::wstring serializeProjectDeleteProgress(const fluxora::ProjectDeleteProgress& progress)
    {
        fluxora::JsonWriter writer;
        writer.beginObject();
        writer.field(L"phase", progress.phase);
        writer.field(L"currentStep", progress.currentStep);
        writer.field(L"currentItem", progress.currentItem);
        writer.field(L"overallPercent", progress.overallPercent);
        writer.field(L"deletedBytes", progress.deletedBytes);
        writer.field(L"totalBytes", progress.totalBytes);
        writer.field(L"deletedEntries", progress.deletedEntries);
        writer.field(L"totalEntries", progress.totalEntries);
        writer.endObject();
        return writer.str();
    }

    std::vector<std::wstring> parseStringArrayJson(const wchar_t* json)
    {
        if (isBlank(json))
        {
            return {};
        }

        const fluxora::JsonValue root = fluxora::JsonReader::parse(json);
        if (!root.isArray())
        {
            throw std::invalid_argument("Expected a JSON string array.");
        }

        std::vector<std::wstring> values;
        for (const fluxora::JsonValue& item : root.asArray())
        {
            if (!item.isString())
            {
                throw std::invalid_argument("Expected a JSON string array.");
            }

            values.push_back(item.asString());
        }

        return values;
    }

    std::vector<fluxora::FomodManualDecision> parseFomodManualDecisionsJson(const wchar_t* json)
    {
        if (isBlank(json))
        {
            return {};
        }
        const fluxora::JsonValue root = fluxora::JsonReader::parse(json);
        if (!root.isArray())
        {
            throw std::invalid_argument("Expected a JSON FOMOD manual decision array.");
        }
        std::vector<fluxora::FomodManualDecision> decisions;
        for (const fluxora::JsonValue& item : root.asArray())
        {
            if (!item.isObject())
            {
                throw std::invalid_argument("FOMOD manual decision must be an object.");
            }
            const fluxora::JsonValue* optionId = item.find(L"optionId");
            const fluxora::JsonValue* selected = item.find(L"selected");
            if (optionId == nullptr || !optionId->isString() || selected == nullptr ||
                selected->type() != fluxora::JsonValue::Type::Boolean)
            {
                throw std::invalid_argument("FOMOD manual decision has invalid fields.");
            }
            if (!optionId->asString().empty())
            {
                decisions.push_back(fluxora::FomodManualDecision{
                    optionId->asString(),
                    selected->asBoolean()
                });
            }
        }
        return decisions;
    }

    std::wstring serializeStringArray(const std::vector<std::wstring>& values)
    {
        fluxora::JsonWriter writer;
        writer.beginArray();
        for (const std::wstring& value : values)
        {
            writer.value(value);
        }
        writer.endArray();
        return writer.str();
    }

    std::wstring serializeInstallOperation(const fluxora::InstallOperationRecord& operation)
    {
        fluxora::JsonWriter writer;
        writer.beginObject();
        writer.field(L"operationId", operation.operationId);
        writer.field(L"sourceKind", operation.sourceKind);
        writer.field(L"sourcePath", operation.sourcePath.wstring());
        writer.field(L"archiveFingerprint", operation.archiveFingerprint);
        writer.field(L"profileName", operation.profileName);
        writer.field(L"existingModMode", operation.existingModMode);
        writer.field(L"targetModUuid", operation.targetModUuid);
        writer.field(L"targetFolder", operation.targetFolder);
        writer.key(L"selectedOptionIds");
        writer.numberValue(operation.selectedOptionIdsJson.empty() ? L"[]" : operation.selectedOptionIdsJson);
        writer.key(L"manualDecisions");
        writer.numberValue(operation.manualDecisionsJson.empty() ? L"[]" : operation.manualDecisionsJson);
        writer.field(L"placementOverridesJson", operation.placementOverridesJson);
        writer.key(L"resume");
        writer.numberValue(operation.requestJson.empty() ? L"{}" : operation.requestJson);
        writer.field(L"beforeOrderId", operation.beforeOrderId);
        writer.field(L"afterOrderId", operation.afterOrderId);
        writer.field(L"enqueueSequence", operation.enqueueSequence);
        writer.field(L"state", operation.state);
        writer.field(L"stage", operation.stage);
        writer.field(L"progressPercent", operation.progressPercent);
        writer.field(L"indeterminate", operation.indeterminate);
        writer.field(L"errorCode", operation.errorCode);
        writer.field(L"errorMessage", operation.errorMessage);
        writer.key(L"result");
        if (operation.resultJson.empty())
        {
            writer.nullValue();
        }
        else
        {
            writer.numberValue(operation.resultJson);
        }
        writer.endObject();
        return writer.str();
    }

    std::wstring serializeInstallOperations(
        const std::vector<fluxora::InstallOperationRecord>& operations)
    {
        fluxora::JsonWriter writer;
        writer.beginArray();
        for (const fluxora::InstallOperationRecord& operation : operations)
        {
            writer.numberValue(serializeInstallOperation(operation));
        }
        writer.endArray();
        return writer.str();
    }

    std::wstring serializeFluxPackExportProgress(const fluxora::FluxPackExportProgress& progress)
    {
        fluxora::JsonWriter writer;
        writer.beginObject();
        writer.field(L"phase", progress.phase);
        writer.field(L"currentStep", progress.currentStep);
        writer.field(L"currentItem", progress.currentItem);
        writer.field(L"statusMessage", progress.statusMessage);
        writer.field(L"overallPercent", progress.overallPercent);
        writer.field(L"processedFileCount", progress.processedFileCount);
        writer.field(L"totalFileCount", progress.totalFileCount);
        writer.field(L"processedBytes", progress.processedBytes);
        writer.field(L"totalBytes", progress.totalBytes);
        writer.endObject();
        return writer.str();
    }

    std::wstring serializeGrassCacheProgress(const fluxora::GrassCacheGenerationProgress& progress)
    {
        fluxora::JsonWriter writer;
        writer.beginObject();
        writer.field(L"phase", progress.phase);
        writer.field(L"currentStep", progress.currentStep);
        writer.field(L"currentItem", progress.currentItem);
        writer.field(L"overallPercent", progress.overallPercent);
        writer.field(L"launchCount", progress.launchCount);
        writer.endObject();
        return writer.str();
    }

    std::wstring serializeGrassCacheResult(const fluxora::GrassCacheGenerationResult& result)
    {
        fluxora::JsonWriter writer;
        writer.beginObject();
        writer.field(L"accepted", result.accepted);
        writer.field(L"outputModName", result.outputModName);
        writer.field(L"outputModPath", result.outputModPath.wstring());
        writer.field(L"launchCount", result.launchCount);
        writer.field(L"generatedFileCount", result.generatedFileCount);
        writer.field(L"failedFileCount", result.failedFileCount);
        writer.endObject();
        return writer.str();
    }

    std::vector<fluxora::PlacementOverride> parsePlacementOverridesJson(const wchar_t* json)
    {
        if (isBlank(json))
        {
            return {};
        }

        const fluxora::JsonValue root = fluxora::JsonReader::parse(json);
        if (!root.isArray())
        {
            throw std::invalid_argument("Expected a JSON placement override array.");
        }

        std::vector<fluxora::PlacementOverride> values;
        for (const fluxora::JsonValue& item : root.asArray())
        {
            if (!item.isObject())
            {
                throw std::invalid_argument("Placement override entry must be an object.");
            }

            const auto readRequiredString = [&item](std::wstring_view field) -> std::wstring
            {
                const fluxora::JsonValue* value = item.find(field);
                if (value == nullptr || !value->isString())
                {
                    throw std::invalid_argument("Placement override has a field with the wrong type.");
                }

                return value->asString();
            };

            const std::wstring sourcePath = readRequiredString(L"sourcePath");
            const std::wstring target = readRequiredString(L"target");

            std::optional<fluxora::GameRelativePath> targetRelativePath;
            if (const fluxora::JsonValue* value = item.find(L"targetRelativePath"))
            {
                if (!value->isString())
                {
                    throw std::invalid_argument("Placement override targetRelativePath must be a string.");
                }

                const std::wstring rawTargetRelativePath = value->asString();
                if (!rawTargetRelativePath.empty())
                {
                    targetRelativePath = fluxora::GameRelativePath::parse(rawTargetRelativePath).valueOrThrow();
                }
            }

            values.push_back(fluxora::PlacementOverride{
                fluxora::GameRelativePath::parse(sourcePath).valueOrThrow(),
                fluxora::parsePlacementTarget(target).valueOrThrow(),
                std::move(targetRelativePath)
            });
        }

        return values;
    }

    std::vector<fluxora::GameExecutable> parseGameExecutablesJson(const wchar_t* json)
    {
        if (isBlank(json))
        {
            return {};
        }

        const fluxora::JsonValue root = fluxora::JsonReader::parse(json);
        if (!root.isArray())
        {
            throw std::invalid_argument("Expected a JSON executable array.");
        }

        std::vector<fluxora::GameExecutable> values;
        for (const fluxora::JsonValue& item : root.asArray())
        {
            if (!item.isObject())
            {
                throw std::invalid_argument("Executable entry must be an object.");
            }

            const auto readString = [&item](std::wstring_view field) -> std::wstring
            {
                const fluxora::JsonValue* value = item.find(field);
                if (value == nullptr || value->isNull())
                {
                    return {};
                }
                if (!value->isString())
                {
                    throw std::invalid_argument("Executable entry has a field with the wrong type.");
                }

                return value->asString();
            };

            fluxora::GameExecutable executable{
                readString(L"id"),
                readString(L"displayName"),
                readString(L"executablePath"),
                readString(L"arguments"),
                readString(L"workingDirectory"),
                readString(L"iconPath")
            };
            executable.managedToolKind = readString(L"managedToolKind");
            values.push_back(std::move(executable));
        }

        return values;
    }

    fluxora::BuildPathSettings parseBuildPathSettingsJson(const wchar_t* json)
    {
        if (isBlank(json))
        {
            throw std::invalid_argument("Build path settings JSON is required.");
        }

        const fluxora::JsonValue root = fluxora::JsonReader::parse(json);
        if (!root.isObject())
        {
            throw std::invalid_argument("Expected a JSON build path settings object.");
        }

        const auto readString = [&root](std::wstring_view field) -> std::wstring
        {
            const fluxora::JsonValue* value = root.find(field);
            if (value == nullptr || value->isNull())
            {
                return {};
            }
            if (!value->isString())
            {
                throw std::invalid_argument("Build path settings have a field with the wrong type.");
            }

            return value->asString();
        };

        return fluxora::BuildPathSettings{
            std::filesystem::path(readString(L"gameDirectory")),
            std::filesystem::path(readString(L"modsDirectory")),
            std::filesystem::path(readString(L"profilesDirectory")),
            std::filesystem::path(readString(L"downloadsDirectory")),
            std::filesystem::path(readString(L"overwriteDirectory"))
        };
    }

    fluxora::PluginRuleContext resolvePluginRuleContextForTemplate(const wchar_t* templateId)
    {
        if (isBlank(templateId))
        {
            throw std::invalid_argument("Template id is required.");
        }

        const fluxora::GameSupportRegistry& registry = fluxora::GameSupportRegistry::embedded();
        const fluxora::GameSupportLookupResult lookup = registry.lookupById(templateId);
        if (!lookup.supported || lookup.support == nullptr)
        {
            throw std::invalid_argument("Plugin management is not supported by the selected game.");
        }

        const fluxora::GameSupportComponents& components = lookup.support->components();
        return fluxora::PluginRuleContext{
            components.pluginRulesProvider,
            &lookup.support->capabilities(),
            nullptr,
            lookup.support->identity().defaultProfileName,
            lookup.support->identity().id.value()
        };
    }

    [[nodiscard]] bool shouldSyncSkyrimPluginsForProject(const std::filesystem::path& projectDirectory)
    {
        const std::wstring gameId = fluxora::InstanceMetadataStore::gameId(projectDirectory);
        return fluxora::toAsciiLower(fluxora::trimAscii(gameId)) == L"skyrimse";
    }

    void syncSkyrimPluginsForInstalledMods(
        const std::filesystem::path& projectDirectory,
        std::string_view sourceOperation,
        bool enablePluginsFromEnabledMods)
    {
        try
        {
            if (!shouldSyncSkyrimPluginsForProject(projectDirectory))
            {
                return;
            }

            const fluxora::PluginRuleContext rules = resolvePluginRuleContextForTemplate(L"skyrimse");
            core().plugins().syncPluginsForInstalledMods(
                projectDirectory,
                rules,
                L"",
                enablePluginsFromEnabledMods);
            logOperation(
                fluxora::LogLevel::Info,
                "Plugins",
                std::string(sourceOperation) + " synced Skyrim plugin state files.");
        }
        catch (const std::exception& exception)
        {
            logOperation(
                fluxora::LogLevel::Warning,
                "Plugins",
                std::string(sourceOperation) +
                    " could not sync Skyrim plugin state files: " + exception.what());
        }
    }

    fluxora::Core& core()
    {
        static fluxora::Core instance;
        currentCore = &instance;
        if (!instance.isInitialized())
        {
            instance.initialize();
        }

        return instance;
    }

    bool isBlank(const wchar_t* value)
    {
        return value == nullptr || value[0] == L'\0';
    }

    std::string textForLog(std::wstring_view value)
    {
        if (value.empty())
        {
            return {};
        }

#ifdef _WIN32
        const int requiredLength = WideCharToMultiByte(
            CP_UTF8,
            0,
            value.data(),
            static_cast<int>(value.size()),
            nullptr,
            0,
            nullptr,
            nullptr);
        if (requiredLength > 0)
        {
            std::string out(static_cast<std::size_t>(requiredLength), '\0');
            WideCharToMultiByte(
                CP_UTF8,
                0,
                value.data(),
                static_cast<int>(value.size()),
                out.data(),
                requiredLength,
                nullptr,
                nullptr);
            return out;
        }
#endif

        std::string fallback;
        fallback.reserve(value.size());
        for (wchar_t ch : value)
        {
            fallback.push_back(ch >= 0 && ch < 0x80 ? static_cast<char>(ch) : '?');
        }
        return fallback;
    }

    std::string pathForLog(const std::filesystem::path& path)
    {
        return textForLog(path.wstring());
    }

    bool tryParseExistingModInstallMode(int value, fluxora::ExistingModInstallMode& mode)
    {
        switch (value)
        {
        case 0:
            mode = fluxora::ExistingModInstallMode::FailIfExists;
            return true;
        case 1:
            mode = fluxora::ExistingModInstallMode::Replace;
            return true;
        case 2:
            mode = fluxora::ExistingModInstallMode::Merge;
            return true;
        default:
            return false;
        }
    }

    const char* existingModInstallModeForLog(fluxora::ExistingModInstallMode mode)
    {
        switch (mode)
        {
        case fluxora::ExistingModInstallMode::Replace:
            return "replace";
        case fluxora::ExistingModInstallMode::Merge:
            return "merge";
        case fluxora::ExistingModInstallMode::FailIfExists:
        default:
            return "failIfExists";
        }
    }

    std::wstring messageToWide(std::string_view message)
    {
        if (message.empty())
        {
            return {};
        }

#ifdef _WIN32
        const int requiredLength = MultiByteToWideChar(
            CP_UTF8,
            MB_ERR_INVALID_CHARS,
            message.data(),
            static_cast<int>(message.size()),
            nullptr,
            0);
        if (requiredLength > 0)
        {
            std::wstring value(static_cast<std::size_t>(requiredLength), L'\0');
            MultiByteToWideChar(
                CP_UTF8,
                MB_ERR_INVALID_CHARS,
                message.data(),
                static_cast<int>(message.size()),
                value.data(),
                requiredLength);
            return value;
        }
#endif

        return std::wstring(message.begin(), message.end());
    }

    std::string utf8FromWide(std::wstring_view value)
    {
        if (value.empty())
        {
            return {};
        }

#ifdef _WIN32
        const int requiredLength = WideCharToMultiByte(
            CP_UTF8,
            0,
            value.data(),
            static_cast<int>(value.size()),
            nullptr,
            0,
            nullptr,
            nullptr);
        if (requiredLength <= 0)
        {
            throw std::invalid_argument("Text could not be encoded as UTF-8.");
        }

        std::string out(static_cast<std::size_t>(requiredLength), '\0');
        WideCharToMultiByte(
            CP_UTF8,
            0,
            value.data(),
            static_cast<int>(value.size()),
            out.data(),
            requiredLength,
            nullptr,
            nullptr);
        return out;
#else
        return std::string(value.begin(), value.end());
#endif
    }

    std::wstring readUtf8TextFileForEditor(const std::filesystem::path& path)
    {
        if (path.empty())
        {
            throw std::invalid_argument("Text file path is required.");
        }

        std::error_code statusError;
        if (!std::filesystem::is_regular_file(path, statusError) || statusError)
        {
            throw std::invalid_argument("Text editor can only open regular files.");
        }

        const std::uintmax_t size = std::filesystem::file_size(path, statusError);
        if (statusError)
        {
            throw std::runtime_error("Failed to inspect text file size.");
        }
        if (size > maxTextEditorFileBytes)
        {
            throw std::invalid_argument("Text file is too large for the editor.");
        }

        std::ifstream file(path, std::ios::binary);
        if (!file)
        {
            throw std::runtime_error("Failed to open text file.");
        }

        std::string content(
            (std::istreambuf_iterator<char>(file)),
            std::istreambuf_iterator<char>());
        if (content.find('\0') != std::string::npos)
        {
            throw std::invalid_argument("File is not a text document.");
        }

        return messageToWide(content);
    }

    void validateTextFileWritePath(
        const std::filesystem::path& path,
        std::uintmax_t contentBytes)
    {
        if (path.empty())
        {
            throw std::invalid_argument("Text file path is required.");
        }

        const std::filesystem::path absolutePath = std::filesystem::absolute(path);
        fluxora::PathSafetyWriteOptions writeOptions;
        writeOptions.requiredBytes = contentBytes;
        fluxora::PathSafetyService()
            .validateWritePath(absolutePath.parent_path(), absolutePath, writeOptions)
            .throwIfUnsafe("Text editor save");

        std::error_code statusError;
        if (std::filesystem::exists(absolutePath, statusError) &&
            !std::filesystem::is_regular_file(absolutePath, statusError))
        {
            throw std::invalid_argument("Text editor can only save regular files.");
        }
    }

    bool tryParseIdentityInstallSelection(
        const wchar_t* resolutionId,
        int identityDecision,
        const wchar_t* targetModUuid,
        int newNamePolicy,
        fluxora::ModIdentityInstallSelection& selection)
    {
        if (isBlank(resolutionId) || newNamePolicy != 0)
        {
            return false;
        }
        if (identityDecision == 0)
        {
            if (isBlank(targetModUuid))
            {
                return false;
            }
            selection.decision = fluxora::InstallIdentityDecision::UseMatch;
        }
        else if (identityDecision == 1)
        {
            selection.decision = fluxora::InstallIdentityDecision::InstallNew;
        }
        else
        {
            return false;
        }
        selection.resolutionId = resolutionId;
        selection.targetModUuid = isBlank(targetModUuid) ? std::wstring{} : std::wstring(targetModUuid);
        selection.newNamePolicy = fluxora::NewNamePolicy::FirstFreeCopySuffix;
        return true;
    }

    void writeTextFileDocumentJson(
        fluxora::JsonWriter& writer,
        const std::filesystem::path& path,
        std::wstring_view content,
        std::uintmax_t size,
        std::wstring_view relativePath = {})
    {
        writer.beginObject();
        writer.field(L"path", path.wstring());
        writer.field(L"fileName", path.filename().wstring());
        if (!relativePath.empty())
        {
            writer.field(L"relativePath", relativePath);
        }
        writer.field(L"content", content);
        writer.field(L"size", size);
        writer.endObject();
    }

    std::wstring serializeTextFileDocument(
        const std::filesystem::path& path,
        std::wstring_view content,
        std::uintmax_t size,
        std::wstring_view relativePath = {})
    {
        fluxora::JsonWriter writer;
        writeTextFileDocumentJson(writer, path, content, size, relativePath);
        return writer.str();
    }

    std::wstring serializeTextFileSaveResult(
        const std::filesystem::path& path,
        std::uintmax_t size,
        std::wstring_view relativePath = {})
    {
        fluxora::JsonWriter writer;
        writer.beginObject();
        writer.field(L"path", path.wstring());
        writer.field(L"fileName", path.filename().wstring());
        if (!relativePath.empty())
        {
            writer.field(L"relativePath", relativePath);
        }
        writer.field(L"size", size);
        writer.endObject();
        return writer.str();
    }

    std::wstring serializeTextFilePreview(
        const std::filesystem::path& path,
        std::wstring_view contentPreview,
        std::uintmax_t bytesRead,
        std::uintmax_t size,
        bool truncated,
        std::wstring_view relativePath = {})
    {
        fluxora::JsonWriter writer;
        writer.beginObject();
        writer.field(L"path", path.wstring());
        writer.field(L"fileName", path.filename().wstring());
        if (!relativePath.empty())
        {
            writer.field(L"relativePath", relativePath);
        }
        writer.field(L"contentPreview", contentPreview);
        writer.field(L"bytesRead", bytesRead);
        writer.field(L"size", size);
        writer.field(L"truncated", truncated);
        writer.endObject();
        return writer.str();
    }

    std::wstring serializeModTextFileDocument(const fluxora::ModTextFileDocument& document)
    {
        return serializeTextFileDocument(
            document.path,
            document.content,
            document.size,
            document.relativePath);
    }

    std::wstring serializeModTextFileSaveResult(const fluxora::ModTextFileSaveResult& result)
    {
        return serializeTextFileSaveResult(result.path, result.size, result.relativePath);
    }

    std::wstring serializeModTextFilePreview(const fluxora::ModTextFilePreview& preview)
    {
        return serializeTextFilePreview(
            preview.path,
            preview.contentPreview,
            preview.bytesRead,
            preview.size,
            preview.truncated,
            preview.relativePath);
    }

    std::wstring serializeProfileTextFilePreview(const fluxora::ProfileTextFilePreview& preview)
    {
        return serializeTextFilePreview(
            preview.path,
            preview.contentPreview,
            preview.bytesRead,
            preview.size,
            preview.truncated,
            preview.relativePath);
    }

    void logApiException(fluxora::LogLevel level, const std::exception& exception) noexcept
    {
        try
        {
            if (currentCore != nullptr && currentCore->logger().isInitialized())
            {
                currentCore->logger().write(
                    level,
                    "NativeApi",
                    std::string("Unhandled native API exception: ") + exception.what());
            }
        }
        catch (...)
        {
        }
    }

    void logBridge(fluxora::LogLevel level, std::string_view message) noexcept
    {
        try
        {
            if (currentCore != nullptr && currentCore->logger().isInitialized())
            {
                currentCore->logger().write(fluxora::LogChannel::Bridge, level, "NativeApi", message);
            }
        }
        catch (...)
        {
        }
    }

    void logOperation(fluxora::LogLevel level, std::string_view category, std::string_view message) noexcept
    {
        try
        {
            if (currentCore != nullptr && currentCore->logger().isInitialized())
            {
                currentCore->logger().writeOperation(level, category, message);
            }
        }
        catch (...)
        {
        }
    }

    int writeToBuffer(const std::wstring& value, wchar_t* buffer, int bufferLength)
    {
        if (buffer == nullptr || bufferLength <= 0)
        {
            lastRequiredBufferLength = 0;
            lastBufferedOutput.clear();
            hasLastBufferedOutput = false;
            lastError = L"Output buffer is required.";
            return FluxoraCoreResultInvalidArgument;
        }

        const auto requiredLength = static_cast<int>(value.size() + 1);
        if (requiredLength > bufferLength)
        {
            lastRequiredBufferLength = requiredLength;
            lastBufferedOutput = value;
            hasLastBufferedOutput = true;
            lastError =
                L"Output buffer is too small. Required length: " +
                std::to_wstring(requiredLength) +
                L", available: " +
                std::to_wstring(bufferLength) +
                L".";
            try
            {
                if (currentCore != nullptr && currentCore->logger().isInitialized())
                {
                    currentCore->logger().write(
                        fluxora::LogLevel::Warning,
                        "NativeApi",
                        "Native API output buffer is too small. required=" +
                            std::to_string(requiredLength) +
                            ", available=" +
                            std::to_string(bufferLength));
                }
            }
            catch (...)
            {
            }
            return FluxoraCoreResultBufferTooSmall;
        }

        std::wmemcpy(buffer, value.c_str(), value.size() + 1);
        lastRequiredBufferLength = 0;
        lastBufferedOutput.clear();
        hasLastBufferedOutput = false;
        lastError.clear();
        return FluxoraCoreResultOk;
    }

    int mapException(const std::exception& exception)
    {
        lastRequiredBufferLength = 0;
        lastBufferedOutput.clear();
        hasLastBufferedOutput = false;
        const char* message = exception.what();
        const bool isBadAllocation = dynamic_cast<const std::bad_alloc*>(&exception) != nullptr;
        if (const auto* bodySlideError = dynamic_cast<const fluxora::BodySlideIntegrationError*>(&exception);
            bodySlideError != nullptr)
        {
            lastError = L"bodyslide:" + bodySlideError->code() + L":" +
                messageToWide(std::string_view(message, std::strlen(message)));
        }
        else
        {
            lastError = isBadAllocation
                ? L"Fluxora ran out of memory while processing this operation. Close memory-intensive apps and retry."
                : messageToWide(std::string_view(message, std::strlen(message)));
        }
        const bool isInvalidArgument = dynamic_cast<const std::invalid_argument*>(&exception) != nullptr;
        logApiException(isInvalidArgument ? fluxora::LogLevel::Warning : fluxora::LogLevel::Error, exception);
        logBridge(
            isInvalidArgument ? fluxora::LogLevel::Warning : fluxora::LogLevel::Error,
            std::string("Native API call failed: ") + message);
        logOperation(
            isInvalidArgument ? fluxora::LogLevel::Warning : fluxora::LogLevel::Error,
            "NativeApi",
            std::string("Native operation failed: ") + message);
        return isInvalidArgument
            ? FluxoraCoreResultInvalidArgument
            : FluxoraCoreResultCoreError;
    }

    int mapUnknownException(std::string_view operation)
    {
        lastRequiredBufferLength = 0;
        lastBufferedOutput.clear();
        hasLastBufferedOutput = false;
        const std::string message =
            std::string("Unknown native exception during ") + std::string(operation) + ".";
        lastError = messageToWide(message);
        logBridge(fluxora::LogLevel::Error, message);
        logOperation(fluxora::LogLevel::Error, "NativeApi", message);
        return FluxoraCoreResultCoreError;
    }

    int installDownloadWithMode(
        const wchar_t* projectDirectory,
        const wchar_t* downloadPath,
        const wchar_t* modName,
        int existingModMode,
        const wchar_t* placementOverridesJson,
        const fluxora::ModIdentityInstallSelection* identitySelection,
        wchar_t* jsonBuffer,
        int jsonBufferLength,
        const wchar_t* profileName = nullptr,
        int modOrderTargetIndex = -1,
        FluxoraCoreProgressCallback progressCallback = nullptr,
        void* progressUserData = nullptr)
    {
        try
        {
            if (isBlank(projectDirectory) || isBlank(downloadPath) || isBlank(modName))
            {
                lastError = L"Project directory, download path, and mod name are required.";
                return FluxoraCoreResultInvalidArgument;
            }

            fluxora::ExistingModInstallMode mode = fluxora::ExistingModInstallMode::FailIfExists;
            if (!tryParseExistingModInstallMode(existingModMode, mode))
            {
                lastError = L"Existing mod install mode is invalid.";
                return FluxoraCoreResultInvalidArgument;
            }

            const std::vector<fluxora::PlacementOverride> placementOverrides =
                parsePlacementOverridesJson(placementOverridesJson);
            logBridge(fluxora::LogLevel::Info, "fluxora_install_download started.");
            logOperation(
                fluxora::LogLevel::Info,
                "Downloads",
                std::string("Install download requested. projectDirectory=\"") +
                    pathForLog(std::filesystem::path(projectDirectory)) + "\", downloadPath=\"" +
                    pathForLog(std::filesystem::path(downloadPath)) + "\", modName=\"" +
                    textForLog(modName) + "\", existingModMode=\"" +
                    existingModInstallModeForLog(mode) + "\", placementOverrideCount=" +
                    std::to_string(placementOverrides.size()));
            const std::wstring json = serializeInstalledMod(
                core().downloads().installDownload(
                    std::filesystem::path(projectDirectory),
                    std::filesystem::path(downloadPath),
                    modName,
                    mode,
                    placementOverrides,
                    identitySelection,
                    isBlank(profileName) ? std::wstring_view{} : std::wstring_view(profileName),
                    modOrderTargetIndex,
                    installConflictProgressCallback(progressCallback, progressUserData)));
            syncSkyrimPluginsForInstalledMods(std::filesystem::path(projectDirectory), "Install download", true);
            logOperation(fluxora::LogLevel::Info, "Downloads", "Install download completed.");
            return writeToBuffer(json, jsonBuffer, jsonBufferLength);
        }
        catch (const std::exception& exception)
        {
            return mapException(exception);
        }
    }

    std::wstring buildFilesRequiredString(
        const fluxora::JsonValue& object,
        std::wstring_view field)
    {
        const fluxora::JsonValue* value = object.find(field);
        if (value == nullptr || !value->isString() || value->asString().empty())
        {
            throw std::invalid_argument("Required build-files string field is missing.");
        }
        return value->asString();
    }

    std::wstring buildFilesLower(std::wstring value)
    {
        std::transform(value.begin(), value.end(), value.begin(), [](wchar_t character)
        {
            return static_cast<wchar_t>(std::towlower(character));
        });
        return value;
    }

    std::wstring buildFilesOptionalString(
        const fluxora::JsonValue& object,
        std::wstring_view field)
    {
        const fluxora::JsonValue* value = object.find(field);
        return value != nullptr && value->isString() ? value->asString() : L"";
    }

    int buildFilesOptionalInt(
        const fluxora::JsonValue& object,
        std::wstring_view field,
        int fallback)
    {
        const fluxora::JsonValue* value = object.find(field);
        if (value == nullptr)
        {
            return fallback;
        }
        if (!value->isNumber())
        {
            throw std::invalid_argument("Build-files numeric field is invalid.");
        }
        return std::stoi(value->asNumber());
    }

    bool buildFilesOptionalBool(
        const fluxora::JsonValue& object,
        std::wstring_view field,
        bool fallback)
    {
        const fluxora::JsonValue* value = object.find(field);
        if (value == nullptr)
        {
            return fallback;
        }
        if (value->type() != fluxora::JsonValue::Type::Boolean)
        {
            throw std::invalid_argument("Build-files boolean field is invalid.");
        }
        return value->asBoolean();
    }

    std::vector<std::wstring> buildFilesOptionalStringArray(
        const fluxora::JsonValue& object,
        std::wstring_view field)
    {
        const fluxora::JsonValue* value = object.find(field);
        if (value == nullptr)
        {
            return {};
        }
        if (!value->isArray())
        {
            throw std::invalid_argument("Build-files string-array field is invalid.");
        }
        std::vector<std::wstring> result;
        result.reserve(value->asArray().size());
        for (const auto& item : value->asArray())
        {
            if (!item.isString())
            {
                throw std::invalid_argument("Build-files string-array item is invalid.");
            }
            result.push_back(item.asString());
        }
        return result;
    }

    fluxora::BuildFileScope buildFileScopeFromText(std::wstring value)
    {
        value = buildFilesLower(std::move(value));
        if (value == L"build") return fluxora::BuildFileScope::Build;
        if (value == L"game") return fluxora::BuildFileScope::Game;
        if (value == L"downloads") return fluxora::BuildFileScope::Downloads;
        throw std::invalid_argument("Build-files scope is invalid.");
    }

    std::vector<fluxora::BuildFileScope> buildFilesOptionalScopes(
        const fluxora::JsonValue& object)
    {
        std::vector<fluxora::BuildFileScope> result;
        for (auto scope : buildFilesOptionalStringArray(object, L"scopes"))
        {
            result.push_back(buildFileScopeFromText(std::move(scope)));
        }
        return result;
    }

    std::wstring buildFileScopeText(fluxora::BuildFileScope scope)
    {
        switch (scope)
        {
        case fluxora::BuildFileScope::Build: return L"build";
        case fluxora::BuildFileScope::Game: return L"game";
        case fluxora::BuildFileScope::Downloads: return L"downloads";
        }
        return L"build";
    }

    std::wstring buildFileKindText(fluxora::BuildFileKind kind)
    {
        switch (kind)
        {
        case fluxora::BuildFileKind::Directory: return L"directory";
        case fluxora::BuildFileKind::Text: return L"text";
        case fluxora::BuildFileKind::Archive: return L"archive";
        case fluxora::BuildFileKind::Unsupported: return L"unsupported";
        }
        return L"unsupported";
    }

    std::wstring buildFileEncodingText(fluxora::BuildFileTextEncoding encoding)
    {
        switch (encoding)
        {
        case fluxora::BuildFileTextEncoding::Utf8: return L"utf-8";
        case fluxora::BuildFileTextEncoding::Utf8Bom: return L"utf-8-bom";
        case fluxora::BuildFileTextEncoding::Utf16Le: return L"utf-16-le";
        case fluxora::BuildFileTextEncoding::Utf16Be: return L"utf-16-be";
        case fluxora::BuildFileTextEncoding::Windows1251: return L"windows-1251";
        case fluxora::BuildFileTextEncoding::Windows1252: return L"windows-1252";
        case fluxora::BuildFileTextEncoding::Unsupported: return L"unsupported";
        }
        return L"unsupported";
    }

    std::wstring buildFileLineEndingText(fluxora::BuildFileLineEnding lineEnding)
    {
        switch (lineEnding)
        {
        case fluxora::BuildFileLineEnding::None: return L"none";
        case fluxora::BuildFileLineEnding::Lf: return L"lf";
        case fluxora::BuildFileLineEnding::CrLf: return L"crlf";
        case fluxora::BuildFileLineEnding::Mixed: return L"mixed";
        }
        return L"none";
    }

    std::wstring buildFileChangeStatusText(fluxora::BuildFileChangeStatus status)
    {
        switch (status)
        {
        case fluxora::BuildFileChangeStatus::Applied: return L"applied";
        case fluxora::BuildFileChangeStatus::Created: return L"created";
        case fluxora::BuildFileChangeStatus::RolledBack: return L"rolled-back";
        case fluxora::BuildFileChangeStatus::Conflict: return L"conflict";
        }
        return L"conflict";
    }

    std::wstring buildFileRollbackStateText(fluxora::BuildFileRollbackState state)
    {
        switch (state)
        {
        case fluxora::BuildFileRollbackState::Available: return L"available";
        case fluxora::BuildFileRollbackState::RolledBack: return L"rolled-back";
        case fluxora::BuildFileRollbackState::Conflict: return L"conflict";
        case fluxora::BuildFileRollbackState::Unavailable: return L"unavailable";
        }
        return L"unavailable";
    }

    std::wstring buildFileRollbackModeText(fluxora::BuildFileRollbackMode mode)
    {
        return mode == fluxora::BuildFileRollbackMode::InverseMerge
            ? L"inverse-merge"
            : L"exact";
    }

    std::wstring buildFileRollbackReasonText(fluxora::BuildFileRollbackReason reason)
    {
        switch (reason)
        {
        case fluxora::BuildFileRollbackReason::None: return L"";
        case fluxora::BuildFileRollbackReason::OverlappingEdit: return L"overlapping-edit";
        case fluxora::BuildFileRollbackReason::CheckpointExpired: return L"checkpoint-expired";
        case fluxora::BuildFileRollbackReason::CheckpointCorrupt: return L"checkpoint-corrupt";
        case fluxora::BuildFileRollbackReason::EncodingChanged: return L"encoding-changed";
        case fluxora::BuildFileRollbackReason::PathChanged: return L"path-changed";
        case fluxora::BuildFileRollbackReason::CreatedFileModified: return L"created-file-modified";
        }
        return L"checkpoint-corrupt";
    }

    std::wstring buildFileResolutionText(fluxora::BuildFileResolution resolution)
    {
        switch (resolution)
        {
        case fluxora::BuildFileResolution::Unique: return L"unique";
        case fluxora::BuildFileResolution::Ambiguous: return L"ambiguous";
        case fluxora::BuildFileResolution::NotFound: return L"not-found";
        }
        return L"not-found";
    }

    fluxora::BuildFileMutationFormat buildFileMutationFormatFromText(std::wstring value)
    {
        value = buildFilesLower(std::move(value));
        if (value == L"plain-text") return fluxora::BuildFileMutationFormat::PlainText;
        if (value == L"json") return fluxora::BuildFileMutationFormat::Json;
        if (value == L"jsonc") return fluxora::BuildFileMutationFormat::Jsonc;
        if (value == L"ini") return fluxora::BuildFileMutationFormat::Ini;
        return fluxora::BuildFileMutationFormat::ExactText;
    }

    void writeBuildFileMetadata(
        fluxora::JsonWriter& writer,
        const fluxora::BuildFileMetadata& metadata)
    {
        writer.beginObject();
        writer.field(L"fileRef", metadata.fileRef);
        writer.field(L"parentRef", metadata.parentRef);
        writer.field(L"scope", buildFileScopeText(metadata.scope));
        writer.field(L"kind", buildFileKindText(metadata.kind));
        writer.field(L"ownerMod", metadata.ownerMod);
        writer.field(L"relativePath", metadata.relativePath);
        writer.field(L"fileName", metadata.fileName);
        writer.field(L"extension", metadata.extension);
        writer.field(L"size", metadata.size);
        writer.field(L"createdAt", metadata.createdAt);
        writer.field(L"modifiedAt", metadata.modifiedAt);
        writer.field(L"readOnly", metadata.readOnly);
        writer.field(L"hidden", metadata.hidden);
        writer.stringArray(L"conflictingOwners", metadata.conflictingOwners);
        writer.field(L"indexRevision", metadata.indexRevision);
        writer.field(L"version", metadata.version);
        writer.endObject();
    }

    void writeBuildFileChange(
        fluxora::JsonWriter& writer,
        const fluxora::BuildFileChange& change)
    {
        writer.beginObject();
        writer.field(L"fileRef", change.fileRef);
        writer.field(L"scope", buildFileScopeText(change.scope));
        writer.field(L"ownerMod", change.ownerMod);
        writer.field(L"relativePath", change.relativePath);
        writer.field(L"status", buildFileChangeStatusText(change.status));
        writer.field(L"addedLines", static_cast<std::uintmax_t>(change.addedLines));
        writer.field(L"removedLines", static_cast<std::uintmax_t>(change.removedLines));
        writer.field(L"validation", change.validation);
        writer.field(L"verification", change.verification);
        writer.field(L"beforeVersion", change.beforeVersion);
        writer.field(L"afterVersion", change.afterVersion);
        writer.field(L"rollbackState", buildFileRollbackStateText(change.rollbackState));
        writer.key(L"hunks").beginArray();
        for (const auto& hunk : change.hunks)
        {
            writer.beginObject();
            writer.field(L"oldStart", static_cast<std::uintmax_t>(hunk.oldStart));
            writer.field(L"oldLines", static_cast<std::uintmax_t>(hunk.oldLines));
            writer.field(L"newStart", static_cast<std::uintmax_t>(hunk.newStart));
            writer.field(L"newLines", static_cast<std::uintmax_t>(hunk.newLines));
            writer.stringArray(L"lines", hunk.lines);
            writer.endObject();
        }
        writer.endArray();
        writer.endObject();
    }

    std::wstring serializeBuildFileSearch(const fluxora::BuildFileSearchPage& page)
    {
        fluxora::JsonWriter writer;
        writer.beginObject();
        writer.key(L"entries").beginArray();
        for (const auto& entry : page.entries)
        {
            writeBuildFileMetadata(writer, entry);
        }
        writer.endArray();
        writer.field(L"nextCursor", page.nextCursor);
        writer.field(L"revision", page.revision);
        writer.field(L"totalMatches", static_cast<std::uintmax_t>(page.totalMatches));
        writer.field(L"indexedCount", static_cast<std::uintmax_t>(page.indexedCount));
        writer.field(L"complete", page.complete);
        writer.field(L"cancelled", page.cancelled);
        writer.field(L"indexed", page.indexed);
        writer.endObject();
        return writer.str();
    }

    std::wstring serializeBuildFileDiscovery(const fluxora::BuildFileDiscoveryPage& page)
    {
        fluxora::JsonWriter writer;
        writer.beginObject();
        writer.key(L"candidates").beginArray();
        for (const auto& candidate : page.candidates)
        {
            writer.beginObject();
            writer.key(L"file");
            writeBuildFileMetadata(writer, candidate.file);
            writer.key(L"confidence").numberValue(std::to_wstring(candidate.confidence));
            writer.stringArray(L"matchReasons", candidate.matchReasons);
            writer.field(L"virtualPath", candidate.virtualPath);
            writer.field(L"effectiveOwner", candidate.effectiveOwner);
            writer.field(L"effectiveWinner", candidate.effectiveWinner);
            writer.endObject();
        }
        writer.endArray();
        writer.key(L"statistics").beginObject();
        writer.field(L"scannedEntries", static_cast<std::uintmax_t>(page.statistics.scannedEntries));
        writer.field(L"skippedEntries", static_cast<std::uintmax_t>(page.statistics.skippedEntries));
        writer.field(L"unavailableRoots", static_cast<std::uintmax_t>(page.statistics.unavailableRoots));
        writer.field(L"candidateCount", static_cast<std::uintmax_t>(page.statistics.candidateCount));
        writer.endObject();
        writer.field(L"revision", page.revision);
        writer.field(L"nextCursor", page.nextCursor);
        writer.field(L"totalMatches", static_cast<std::uintmax_t>(page.totalMatches));
        writer.field(L"indexedCount", static_cast<std::uintmax_t>(page.indexedCount));
        writer.field(L"resolution", buildFileResolutionText(page.resolution));
        writer.field(L"complete", page.complete);
        writer.field(L"cancelled", page.cancelled);
        writer.endObject();
        return writer.str();
    }

    std::wstring serializeBuildFileRead(const fluxora::BuildFileTextRead& read)
    {
        fluxora::JsonWriter writer;
        writer.beginObject();
        writer.field(L"fileRef", read.fileRef);
        writer.field(L"scope", buildFileScopeText(read.scope));
        writer.field(L"relativePath", read.relativePath);
        writer.field(L"content", read.content);
        writer.field(L"startLine", static_cast<std::uintmax_t>(read.startLine));
        writer.field(L"endLine", static_cast<std::uintmax_t>(read.endLine));
        writer.field(L"truncated", read.truncated);
        writer.field(L"encoding", buildFileEncodingText(read.encoding));
        writer.field(L"lineEnding", buildFileLineEndingText(read.lineEnding));
        writer.field(L"sha256", read.sha256);
        writer.field(L"revision", read.revision);
        writer.field(L"version", read.version);
        writer.endObject();
        return writer.str();
    }

    std::wstring serializeBuildFileQuery(const fluxora::BuildFileQueryResult& query)
    {
        fluxora::JsonWriter writer;
        writer.beginObject();
        writer.field(L"fileRef", query.fileRef);
        writer.field(L"query", query.query);
        writer.field(L"kind", query.kind);
        writer.field(L"value", query.value);
        writer.field(L"sha256", query.sha256);
        writer.field(L"version", query.version);
        writer.endObject();
        return writer.str();
    }

    std::wstring serializeConfigRecipeInspection(const fluxora::ConfigRecipeInspection& inspection)
    {
        fluxora::JsonWriter writer;
        writer.beginObject();
        writer.field(L"matched", inspection.matched);
        writer.field(L"recipeId", inspection.recipeId);
        writer.field(L"format", inspection.format);
        writer.field(L"targetPointer", inspection.targetPointer);
        writer.field(L"currentValue", inspection.currentValue);
        writer.field(L"encodedValue", inspection.encodedValue);
        writer.field(L"needsInput", inspection.needsInput);
        writer.field(L"question", inspection.question);
        writer.key(L"conflicts").beginArray();
        for (const auto& conflict : inspection.conflicts)
        {
            writer.beginObject();
            writer.field(L"semanticKey", conflict.semanticKey);
            writer.field(L"encodedValue", conflict.encodedValue);
            writer.endObject();
        }
        writer.endArray();
        writer.endObject();
        return writer.str();
    }

    std::wstring serializeBuildFileTextSearch(const fluxora::BuildFileTextSearchPage& page)
    {
        fluxora::JsonWriter writer;
        writer.beginObject();
        writer.key(L"matches").beginArray();
        for (const auto& match : page.matches)
        {
            writer.beginObject();
            writer.field(L"fileRef", match.fileRef);
            writer.field(L"scope", buildFileScopeText(match.scope));
            writer.field(L"relativePath", match.relativePath);
            writer.field(L"line", static_cast<std::uintmax_t>(match.line));
            writer.field(L"before", match.before);
            writer.field(L"match", match.match);
            writer.field(L"after", match.after);
            writer.endObject();
        }
        writer.endArray();
        writer.field(L"nextCursor", page.nextCursor);
        writer.field(L"revision", page.revision);
        writer.field(L"totalMatches", static_cast<std::uintmax_t>(page.totalMatches));
        writer.field(L"indexedCount", static_cast<std::uintmax_t>(page.indexedCount));
        writer.field(L"complete", page.complete);
        writer.field(L"cancelled", page.cancelled);
        writer.endObject();
        return writer.str();
    }

    std::wstring serializeBuildFileChangeSet(const fluxora::FluxoraAiFileChangeSet& changeSet)
    {
        fluxora::JsonWriter writer;
        writer.beginObject();
        writer.field(L"schema", L"fluxora.ai.file-change-set.v1");
        writer.field(L"operationId", changeSet.operationId);
        writer.field(L"runId", changeSet.runId);
        writer.field(L"chatId", changeSet.chatId);
        writer.field(L"rollbackState", buildFileRollbackStateText(changeSet.rollbackState));
        writer.key(L"files").beginArray();
        for (const auto& file : changeSet.files)
        {
            writeBuildFileChange(writer, file);
        }
        writer.endArray();
        writer.endObject();
        return writer.str();
    }

    std::wstring serializeBuildFileRollback(const fluxora::BuildFileRollbackResult& rollback)
    {
        fluxora::JsonWriter writer;
        writer.beginObject();
        writer.field(L"operationId", rollback.operationId);
        writer.field(L"runId", rollback.runId);
        writer.field(L"state", buildFileRollbackStateText(rollback.state));
        writer.field(L"mode", buildFileRollbackModeText(rollback.mode));
        if (rollback.reason != fluxora::BuildFileRollbackReason::None)
        {
            writer.field(L"reason", buildFileRollbackReasonText(rollback.reason));
        }
        writer.field(L"preservedNewerChanges", rollback.preservedNewerChanges);
        writer.key(L"files").beginArray();
        for (const auto& file : rollback.files)
        {
            writeBuildFileChange(writer, file);
        }
        writer.endArray();
        writer.endObject();
        return writer.str();
    }

    std::wstring serializeBuildFileRollbackStates(
        const std::vector<fluxora::BuildFileRollbackRunState>& states)
    {
        fluxora::JsonWriter writer;
        writer.beginArray();
        for (const auto& state : states)
        {
            writer.beginObject();
            writer.field(L"runId", state.runId);
            writer.field(L"state", buildFileRollbackStateText(state.state));
            if (state.reason != fluxora::BuildFileRollbackReason::None)
            {
                writer.field(L"reason", buildFileRollbackReasonText(state.reason));
            }
            writer.endObject();
        }
        writer.endArray();
        return writer.str();
    }

    std::vector<fluxora::BuildFileMutation> parseBuildFileMutations(
        const fluxora::JsonValue& params)
    {
        const fluxora::JsonValue* mutations = params.find(L"mutations");
        if (mutations == nullptr || !mutations->isArray())
        {
            throw std::invalid_argument("Build-files mutations array is required.");
        }
        std::vector<fluxora::BuildFileMutation> result;
        for (const auto& item : mutations->asArray())
        {
            if (!item.isObject())
            {
                throw std::invalid_argument("Build-files mutation item is invalid.");
            }
            const std::wstring kind = buildFilesLower(buildFilesRequiredString(item, L"kind"));
            const auto format = buildFileMutationFormatFromText(
                buildFilesOptionalString(item, L"format"));
            if (kind == L"create")
            {
                auto mutation = fluxora::BuildFileMutation::create(
                    buildFilesRequiredString(item, L"parentRef"),
                    buildFilesRequiredString(item, L"fileName"),
                    buildFilesOptionalString(item, L"content"),
                    format);
                mutation.expectedAbsent = buildFilesOptionalBool(item, L"expectedAbsent", false);
                result.push_back(std::move(mutation));
            }
            else if (kind == L"patch" || kind == L"replace-document")
            {
                auto mutation = fluxora::BuildFileMutation::patch(
                    buildFilesRequiredString(item, L"fileRef"),
                    buildFilesRequiredString(item, L"baseSha256"),
                    kind == L"replace-document"
                        ? buildFilesOptionalString(item, L"expectedText")
                        : buildFilesRequiredString(item, L"expectedText"),
                    buildFilesOptionalString(item, L"replacementText"),
                    format);
                mutation.wholeDocument = kind == L"replace-document";
                result.push_back(std::move(mutation));
            }
            else if (kind == L"ini-set" || kind == L"ini-add" || kind == L"ini-remove")
            {
                const auto operation = kind == L"ini-set"
                    ? fluxora::BuildFileMutationOperation::IniSetKey
                    : kind == L"ini-add"
                        ? fluxora::BuildFileMutationOperation::IniAddKey
                        : fluxora::BuildFileMutationOperation::IniRemoveKey;
                auto mutation = fluxora::BuildFileMutation::iniKey(
                    operation,
                    buildFilesRequiredString(item, L"fileRef"),
                    buildFilesRequiredString(item, L"baseSha256"),
                    buildFilesOptionalString(item, L"section"),
                    buildFilesRequiredString(item, L"key"),
                    buildFilesOptionalString(item, L"value"));
                mutation.expectedValue = buildFilesOptionalString(item, L"expectedValue");
                result.push_back(std::move(mutation));
            }
            else if (kind == L"json-set-pointer")
            {
                auto mutation = fluxora::BuildFileMutation::jsonPointer(
                    buildFilesRequiredString(item, L"fileRef"),
                    buildFilesRequiredString(item, L"baseSha256"),
                    buildFilesRequiredString(item, L"pointer"),
                    buildFilesRequiredString(item, L"expectedValue"),
                    buildFilesRequiredString(item, L"value"));
                mutation.format = format == fluxora::BuildFileMutationFormat::Jsonc
                    ? fluxora::BuildFileMutationFormat::Jsonc
                    : fluxora::BuildFileMutationFormat::Json;
                mutation.allowKnownConflict = buildFilesOptionalBool(
                    item,
                    L"allowKnownConflict",
                    false);
                result.push_back(std::move(mutation));
            }
            else
            {
                throw std::invalid_argument("Build-files mutation kind is invalid.");
            }
            result.back().revision = buildFilesOptionalString(item, L"revision");
        }
        return result;
    }

    std::wstring dispatchBuildFilesRequest(
        std::wstring_view method,
        const fluxora::JsonValue& params)
    {
        if (method == L"resetRollbackCheckpoints")
        {
            core().buildFiles().eraseAllCheckpoints(
                buildFilesRequiredString(params, L"operationId"));
            return L"{\"reset\":true}";
        }
        const std::wstring chatId = buildFilesRequiredString(params, L"chatId");
        if (method == L"beginChat")
        {
            core().buildFiles().beginChat(
                chatId,
                std::filesystem::path(buildFilesRequiredString(params, L"projectDirectory")),
                buildFilesOptionalString(params, L"profile"));
            return L"{\"active\":true}";
        }
        if (method == L"endChat")
        {
            core().buildFiles().endChat(chatId);
            return L"{\"active\":false}";
        }
        if (method == L"search")
        {
            return serializeBuildFileSearch(core().buildFiles().search(
                chatId,
                fluxora::BuildFileSearchRequest{
                    buildFileScopeFromText(buildFilesRequiredString(params, L"scope")),
                    buildFilesOptionalString(params, L"query"),
                    static_cast<std::size_t>(buildFilesOptionalInt(params, L"limit", 20)),
                    buildFilesOptionalString(params, L"cursor"),
                    {},
                    buildFilesOptionalString(params, L"revision")
                }));
        }
        if (method == L"discover")
        {
            return serializeBuildFileDiscovery(core().buildFiles().discover(
                chatId,
                fluxora::BuildFileDiscoveryRequest{
                    buildFilesOptionalScopes(params),
                    buildFilesOptionalStringArray(params, L"aliases"),
                    buildFilesOptionalStringArray(params, L"extensions"),
                    buildFilesOptionalStringArray(params, L"configHints"),
                    buildFilesOptionalStringArray(params, L"semanticKeys"),
                    static_cast<std::size_t>(buildFilesOptionalInt(params, L"limit", 20)),
                    buildFilesOptionalString(params, L"revision"),
                    buildFilesOptionalString(params, L"cursor"),
                    {}}));
        }
        if (method == L"searchText")
        {
            return serializeBuildFileTextSearch(core().buildFiles().searchText(
                chatId,
                fluxora::BuildFileSearchRequest{
                    buildFileScopeFromText(buildFilesRequiredString(params, L"scope")),
                    buildFilesRequiredString(params, L"query"),
                    static_cast<std::size_t>(buildFilesOptionalInt(params, L"limit", 20)),
                    buildFilesOptionalString(params, L"cursor"),
                    {},
                    buildFilesOptionalString(params, L"revision")}));
        }
        if (method == L"stat")
        {
            fluxora::JsonWriter writer;
            writeBuildFileMetadata(
                writer,
                core().buildFiles().stat(chatId, buildFilesRequiredString(params, L"fileRef")));
            return writer.str();
        }
        if (method == L"readText")
        {
            return serializeBuildFileRead(core().buildFiles().readText(
                chatId,
                fluxora::BuildFileTextReadRequest{
                    buildFilesRequiredString(params, L"fileRef"),
                    static_cast<std::size_t>(buildFilesOptionalInt(params, L"startLine", 1)),
                    static_cast<std::size_t>(buildFilesOptionalInt(params, L"maxLines", 120)),
                    static_cast<std::size_t>(buildFilesOptionalInt(params, L"maxBytes", 8192)),
                    buildFilesOptionalBool(params, L"editorMode", false)
                }));
        }
        if (method == L"queryJson")
        {
            return serializeBuildFileQuery(core().buildFiles().queryJson(
                chatId,
                buildFilesRequiredString(params, L"fileRef"),
                buildFilesOptionalString(params, L"pointer")));
        }
        if (method == L"queryIni")
        {
            return serializeBuildFileQuery(core().buildFiles().queryIni(
                chatId,
                buildFilesRequiredString(params, L"fileRef"),
                buildFilesOptionalString(params, L"section"),
                buildFilesOptionalString(params, L"key")));
        }
        if (method == L"inspectConfigRecipe")
        {
            return serializeConfigRecipeInspection(core().buildFiles().inspectConfigRecipe(
                chatId,
                buildFilesRequiredString(params, L"fileRef"),
                buildFilesOptionalString(params, L"targetPointer"),
                buildFilesRequiredString(params, L"requestedValue")));
        }
        if (method == L"apply")
        {
            return serializeBuildFileChangeSet(core().buildFiles().apply(
                chatId,
                buildFilesRequiredString(params, L"runId"),
                buildFilesRequiredString(params, L"operationId"),
                parseBuildFileMutations(params)));
        }
        if (method == L"rollbackFile")
        {
            return serializeBuildFileRollback(core().buildFiles().rollbackFile(
                chatId,
                buildFilesRequiredString(params, L"runId"),
                buildFilesRequiredString(params, L"fileRef"),
                buildFilesRequiredString(params, L"operationId")));
        }
        if (method == L"rollbackRun")
        {
            return serializeBuildFileRollback(core().buildFiles().rollbackRun(
                chatId,
                buildFilesRequiredString(params, L"runId"),
                buildFilesRequiredString(params, L"operationId")));
        }
        if (method == L"getRollbackStates")
        {
            return serializeBuildFileRollbackStates(core().buildFiles().getFileRollbackStates(
                chatId,
                buildFilesRequiredString(params, L"operationId")));
        }
        throw std::invalid_argument("Unsupported build-files method.");
    }

    int installArchiveWithMode(
        const wchar_t* projectDirectory,
        const wchar_t* archivePath,
        const wchar_t* modName,
        int existingModMode,
        const wchar_t* placementOverridesJson,
        const fluxora::ModIdentityInstallSelection* identitySelection,
        wchar_t* jsonBuffer,
        int jsonBufferLength,
        const wchar_t* profileName = nullptr,
        int modOrderTargetIndex = -1,
        FluxoraCoreProgressCallback progressCallback = nullptr,
        void* progressUserData = nullptr)
    {
        try
        {
            if (isBlank(projectDirectory) || isBlank(archivePath) || isBlank(modName))
            {
                lastError = L"Project directory, archive path, and mod name are required.";
                return FluxoraCoreResultInvalidArgument;
            }

            fluxora::ExistingModInstallMode mode = fluxora::ExistingModInstallMode::FailIfExists;
            if (!tryParseExistingModInstallMode(existingModMode, mode))
            {
                lastError = L"Existing mod install mode is invalid.";
                return FluxoraCoreResultInvalidArgument;
            }

            const std::vector<fluxora::PlacementOverride> placementOverrides =
                parsePlacementOverridesJson(placementOverridesJson);
            logBridge(fluxora::LogLevel::Info, "fluxora_install_archive started.");
            logOperation(
                fluxora::LogLevel::Info,
                "Mods",
                std::string("Install archive requested. projectDirectory=\"") +
                    pathForLog(std::filesystem::path(projectDirectory)) + "\", archivePath=\"" +
                    pathForLog(std::filesystem::path(archivePath)) + "\", modName=\"" +
                    textForLog(modName) + "\", existingModMode=\"" +
                    existingModInstallModeForLog(mode) + "\", placementOverrideCount=" +
                    std::to_string(placementOverrides.size()));
            const std::wstring json = serializeInstalledMod(
                core().downloads().installArchive(
                    std::filesystem::path(projectDirectory),
                    std::filesystem::path(archivePath),
                    modName,
                    mode,
                    placementOverrides,
                    identitySelection,
                    isBlank(profileName) ? std::wstring_view{} : std::wstring_view(profileName),
                    modOrderTargetIndex,
                    installConflictProgressCallback(progressCallback, progressUserData)));
            syncSkyrimPluginsForInstalledMods(std::filesystem::path(projectDirectory), "Install archive", true);
            logOperation(fluxora::LogLevel::Info, "Mods", "Install archive completed.");
            return writeToBuffer(json, jsonBuffer, jsonBufferLength);
        }
        catch (const std::exception& exception)
        {
            return mapException(exception);
        }
    }
}

extern "C"
{
    int fluxora_build_files_request(
        const wchar_t* method,
        const wchar_t* paramsJson,
        wchar_t* jsonBuffer,
        int jsonBufferLength)
    {
        try
        {
            if (isBlank(method) || isBlank(paramsJson))
            {
                lastError = L"Build-files method and params are required.";
                return FluxoraCoreResultInvalidArgument;
            }
            const fluxora::JsonValue params = fluxora::JsonReader::parse(paramsJson);
            if (!params.isObject())
            {
                lastError = L"Build-files params must be an object.";
                return FluxoraCoreResultInvalidArgument;
            }
            return writeToBuffer(
                dispatchBuildFilesRequest(method, params),
                jsonBuffer,
                jsonBufferLength);
        }
        catch (const fluxora::BuildFileWorkspaceError& exception)
        {
            lastError = L"build-files:" + messageToWide(exception.code()) + L":" +
                messageToWide(exception.what());
            return FluxoraCoreResultCoreError;
        }
        catch (const std::exception& exception)
        {
            return mapException(exception);
        }
    }

    int fluxora_core_is_available()
    {
        try
        {
            core();
            return 1;
        }
        catch (const std::exception& exception)
        {
            mapException(exception);
            return 0;
        }
    }

    int fluxora_core_shutdown()
    {
        try
        {
            if (currentCore != nullptr)
            {
                currentCore->shutdown();
            }

            fluxora::Logger::clearOperationId();
            return FluxoraCoreResultOk;
        }
        catch (const std::exception& exception)
        {
            return mapException(exception);
        }
    }

    int fluxora_set_operation_context(const wchar_t* operationId)
    {
        if (isBlank(operationId))
        {
            fluxora::Logger::clearOperationId();
        }
        else
        {
            fluxora::Logger::setOperationId(operationId);
        }

        return FluxoraCoreResultOk;
    }

    int fluxora_submit_install_operation(
        const wchar_t* projectDirectory,
        const wchar_t* operationId,
        const wchar_t* sourceKind,
        const wchar_t* sourcePath,
        int isFomod,
        const wchar_t* modName,
        int existingModMode,
        const wchar_t* selectedOptionIdsJson,
        const wchar_t* placementOverridesJson,
        const wchar_t* resolutionId,
        int identityDecision,
        const wchar_t* targetModUuid,
        int newNamePolicy,
        const wchar_t* profileName,
        const wchar_t* fomodContextId,
        const wchar_t* manualDecisionsJson,
        int modOrderTargetIndex,
        const wchar_t* beforeOrderId,
        const wchar_t* afterOrderId,
        FluxoraCoreProgressCallback progressCallback,
        void* progressUserData,
        wchar_t* jsonBuffer,
        int jsonBufferLength)
    {
        try
        {
            if (isBlank(projectDirectory) || isBlank(sourceKind) ||
                isBlank(sourcePath) || isBlank(modName))
            {
                throw std::invalid_argument(
                    "Project directory, source kind, source path, and mod name are required.");
            }

            fluxora::ExistingModInstallMode mode;
            if (!tryParseExistingModInstallMode(existingModMode, mode))
            {
                throw std::invalid_argument("Existing mod install mode is invalid.");
            }

            fluxora::InstallOperationRequest request;
            request.operationId = isBlank(operationId) ? std::wstring{} : std::wstring(operationId);
            request.projectDirectory = std::filesystem::path(projectDirectory);
            request.sourceKind = sourceKind;
            request.sourcePath = std::filesystem::path(sourcePath);
            request.fomod = isFomod != 0;
            request.modName = modName;
            request.existingModMode = mode;
            request.selectedOptionIds = parseStringArrayJson(selectedOptionIdsJson);
            request.placementOverrides = parsePlacementOverridesJson(placementOverridesJson);
            request.profileName = isBlank(profileName) ? std::wstring{} : std::wstring(profileName);
            request.fomodContextId = isBlank(fomodContextId) ? std::wstring{} : std::wstring(fomodContextId);
            request.manualDecisions = parseFomodManualDecisionsJson(manualDecisionsJson);
            request.modOrderTargetIndex = modOrderTargetIndex;
            request.beforeOrderId = isBlank(beforeOrderId) ? std::wstring{} : std::wstring(beforeOrderId);
            request.afterOrderId = isBlank(afterOrderId) ? std::wstring{} : std::wstring(afterOrderId);
            request.selectedOptionIdsJson = isBlank(selectedOptionIdsJson)
                ? L"[]"
                : std::wstring(selectedOptionIdsJson);
            request.placementOverridesJson = isBlank(placementOverridesJson)
                ? L"[]"
                : std::wstring(placementOverridesJson);
            request.manualDecisionsJson = isBlank(manualDecisionsJson)
                ? L"[]"
                : std::wstring(manualDecisionsJson);

            if (!isBlank(resolutionId))
            {
                fluxora::ModIdentityInstallSelection selection;
                if (!tryParseIdentityInstallSelection(
                        resolutionId,
                        identityDecision,
                        targetModUuid,
                        newNamePolicy,
                        selection))
                {
                    throw std::invalid_argument("Install identity selection is invalid.");
                }
                request.identitySelection = std::move(selection);
                fluxora::JsonWriter identityWriter;
                identityWriter.beginObject();
                identityWriter.field(L"resolutionId", resolutionId);
                identityWriter.field(L"decision", identityDecision);
                identityWriter.field(
                    L"targetModUuid",
                    isBlank(targetModUuid) ? std::wstring{} : std::wstring(targetModUuid));
                identityWriter.field(L"newNamePolicy", newNamePolicy);
                identityWriter.endObject();
                request.identityPlanJson = identityWriter.str();
            }

            const auto publish = [progressCallback, progressUserData](
                const fluxora::InstallOperationRecord& operation)
            {
                if (progressCallback == nullptr)
                {
                    return;
                }
                const std::wstring json = serializeInstallOperation(operation);
                progressCallback(json.c_str(), progressUserData);
            };
            const fluxora::InstallOperationRecord operation =
                core().installs().submit(std::move(request), publish);
            return writeToBuffer(
                serializeInstallOperation(operation),
                jsonBuffer,
                jsonBufferLength);
        }
        catch (const std::exception& exception)
        {
            return mapException(exception);
        }
    }

    int fluxora_restore_install_operations(
        const wchar_t* projectDirectory,
        FluxoraCoreProgressCallback progressCallback,
        void* progressUserData,
        wchar_t* jsonBuffer,
        int jsonBufferLength)
    {
        try
        {
            if (isBlank(projectDirectory))
            {
                throw std::invalid_argument("Project directory is required.");
            }
            const auto publish = [progressCallback, progressUserData](
                const fluxora::InstallOperationRecord& operation)
            {
                if (progressCallback != nullptr)
                {
                    const std::wstring json = serializeInstallOperation(operation);
                    progressCallback(json.c_str(), progressUserData);
                }
            };
            return writeToBuffer(
                serializeInstallOperations(core().installs().restore(projectDirectory, publish)),
                jsonBuffer,
                jsonBufferLength);
        }
        catch (const std::exception& exception)
        {
            return mapException(exception);
        }
    }

    int fluxora_cancel_install_operation(
        const wchar_t* projectDirectory,
        const wchar_t* operationId,
        wchar_t* jsonBuffer,
        int jsonBufferLength)
    {
        try
        {
            if (isBlank(projectDirectory) || isBlank(operationId))
            {
                throw std::invalid_argument("Project directory and operation id are required.");
            }
            return writeToBuffer(
                serializeInstallOperation(core().installs().cancel(projectDirectory, operationId)),
                jsonBuffer,
                jsonBufferLength);
        }
        catch (const std::exception& exception)
        {
            return mapException(exception);
        }
    }

    int fluxora_list_install_operations(
        const wchar_t* projectDirectory,
        int includeTerminal,
        wchar_t* jsonBuffer,
        int jsonBufferLength)
    {
        try
        {
            if (isBlank(projectDirectory))
            {
                throw std::invalid_argument("Project directory is required.");
            }
            return writeToBuffer(
                serializeInstallOperations(
                    core().installs().list(projectDirectory, includeTerminal != 0)),
                jsonBuffer,
                jsonBufferLength);
        }
        catch (const std::exception& exception)
        {
            return mapException(exception);
        }
    }

    int fluxora_get_install_operation(
        const wchar_t* projectDirectory,
        const wchar_t* operationId,
        wchar_t* jsonBuffer,
        int jsonBufferLength)
    {
        try
        {
            if (isBlank(projectDirectory) || isBlank(operationId))
            {
                throw std::invalid_argument("Project directory and operation id are required.");
            }
            const std::optional<fluxora::InstallOperationRecord> operation =
                core().installs().get(projectDirectory, operationId);
            if (!operation.has_value())
            {
                throw std::invalid_argument("Install operation was not found.");
            }
            return writeToBuffer(
                serializeInstallOperation(*operation),
                jsonBuffer,
                jsonBufferLength);
        }
        catch (const std::exception& exception)
        {
            return mapException(exception);
        }
    }

    int fluxora_get_last_required_buffer_length()
    {
        return lastRequiredBufferLength;
    }

    int fluxora_copy_last_output(wchar_t* jsonBuffer, int jsonBufferLength)
    {
        if (!hasLastBufferedOutput)
        {
            lastRequiredBufferLength = 0;
            lastError = L"No buffered output is available.";
            return FluxoraCoreResultInvalidArgument;
        }

        return writeToBuffer(lastBufferedOutput, jsonBuffer, jsonBufferLength);
    }

    int fluxora_preview_project_directory(
        const wchar_t* projectName,
        const wchar_t* installRootDirectory,
        wchar_t* projectDirectoryBuffer,
        int projectDirectoryBufferLength)
    {
        try
        {
            if (isBlank(projectName) || isBlank(installRootDirectory))
            {
                lastError = L"Project name and install root directory are required.";
                return FluxoraCoreResultInvalidArgument;
            }

            const auto projectDirectory = core().projects().buildProjectDirectory(
                std::filesystem::path(installRootDirectory),
                projectName);

            return writeToBuffer(projectDirectory.wstring(), projectDirectoryBuffer, projectDirectoryBufferLength);
        }
        catch (const std::exception& exception)
        {
            return mapException(exception);
        }
    }

    int fluxora_get_game_templates(wchar_t* jsonBuffer, int jsonBufferLength)
    {
        try
        {
            const std::wstring json = serializeGameTemplateList(core().templates().gameTemplates());
            return writeToBuffer(json, jsonBuffer, jsonBufferLength);
        }
        catch (const std::exception& exception)
        {
            return mapException(exception);
        }
    }

    int fluxora_resolve_template(const wchar_t* templateId, wchar_t* jsonBuffer, int jsonBufferLength)
    {
        try
        {
            if (isBlank(templateId))
            {
                lastError = L"Template id is required.";
                return FluxoraCoreResultInvalidArgument;
            }

            const fluxora::BuildTemplate resolved = core().templates().resolve(templateId);
            return writeToBuffer(serializeResolvedTemplate(resolved), jsonBuffer, jsonBufferLength);
        }
        catch (const std::exception& exception)
        {
            return mapException(exception);
        }
    }

    int fluxora_create_project(
        const wchar_t* projectName,
        const wchar_t* templateId,
        const wchar_t* gamePath,
        const wchar_t* installRootDirectory,
        wchar_t* jsonBuffer,
        int jsonBufferLength)
    {
        try
        {
            if (isBlank(projectName) || isBlank(templateId) || isBlank(gamePath) || isBlank(installRootDirectory))
            {
                lastError = L"Project name, template, game path, and install root directory are required.";
                return FluxoraCoreResultInvalidArgument;
            }

            const fluxora::ProjectCreateRequest request{
                projectName,
                templateId,
                std::filesystem::path(gamePath),
                std::filesystem::path(installRootDirectory)
            };

            logBridge(fluxora::LogLevel::Info, "fluxora_create_project started.");
            logOperation(
                fluxora::LogLevel::Info,
                "Project",
                std::string("Create project requested. name=\"") + textForLog(projectName) +
                    "\", template=\"" + textForLog(templateId) +
                    "\", gamePath=\"" + pathForLog(request.gamePath) +
                    "\", installRoot=\"" + pathForLog(request.installRootDirectory) + "\"");
            const fluxora::ProjectDescriptor project = core().projects().createProject(request);
            const fluxora::ProjectOpenResult result{
                project,
                core().templates().resolve(project.templateId)
            };
            logOperation(
                fluxora::LogLevel::Info,
                "Project",
                std::string("Create project completed. projectDirectory=\"") +
                    pathForLog(project.projectDirectory) + "\", configPath=\"" +
                    pathForLog(project.configPath) + "\"");
            return writeToBuffer(serializeOpenedProject(result), jsonBuffer, jsonBufferLength);
        }
        catch (const std::exception& exception)
        {
            return mapException(exception);
        }
    }

    int fluxora_list_project_configs(
        const wchar_t* buildConfigsDirectory,
        wchar_t* jsonBuffer,
        int jsonBufferLength)
    {
        try
        {
            if (isBlank(buildConfigsDirectory))
            {
                lastError = L"Build configs directory is required.";
                return FluxoraCoreResultInvalidArgument;
            }

            const std::vector<fluxora::ProjectOpenResult> results =
                core().projects().listProjectConfigSummaries(std::filesystem::path(buildConfigsDirectory));
            return writeToBuffer(serializeProjectConfigList(results), jsonBuffer, jsonBufferLength);
        }
        catch (const std::exception& exception)
        {
            return mapException(exception);
        }
    }

    int fluxora_open_project_config(
        const wchar_t* configPath,
        wchar_t* jsonBuffer,
        int jsonBufferLength)
    {
        try
        {
            if (isBlank(configPath))
            {
                lastError = L"Build config path is required.";
                return FluxoraCoreResultInvalidArgument;
            }

            const fluxora::ProjectOpenResult result = core().projects().openProjectConfig(
                std::filesystem::path(configPath));
            fluxora::InstanceMetadataStore::beginProjectActivation(
                result.project.projectDirectory);
            return writeToBuffer(serializeOpenedProject(result), jsonBuffer, jsonBufferLength);
        }
        catch (const std::exception& exception)
        {
            return mapException(exception);
        }
    }

    int fluxora_rename_project(
        const wchar_t* configPath,
        const wchar_t* newName,
        wchar_t* jsonBuffer,
        int jsonBufferLength)
    {
        try
        {
            if (isBlank(configPath) || isBlank(newName))
            {
                lastError = L"Build config path and new project name are required.";
                return FluxoraCoreResultInvalidArgument;
            }

            logBridge(fluxora::LogLevel::Info, "fluxora_rename_project started.");
            logOperation(
                fluxora::LogLevel::Info,
                "Project",
                std::string("Rename project requested. configPath=\"") +
                    pathForLog(std::filesystem::path(configPath)) + "\", newName=\"" +
                    textForLog(newName) + "\"");
            const fluxora::ProjectOpenResult result = core().projects().renameProject(
                std::filesystem::path(configPath),
                newName);
            logOperation(
                fluxora::LogLevel::Info,
                "Project",
                std::string("Rename project completed. configPath=\"") +
                    pathForLog(result.project.configPath) + "\", name=\"" +
                    textForLog(result.project.name) + "\"");
            return writeToBuffer(serializeOpenedProject(result), jsonBuffer, jsonBufferLength);
        }
        catch (const std::exception& exception)
        {
            return mapException(exception);
        }
    }

    int fluxora_delete_project(const wchar_t* configPath)
    {
        try
        {
            if (isBlank(configPath))
            {
                lastError = L"Build config path is required.";
                return FluxoraCoreResultInvalidArgument;
            }

            logBridge(fluxora::LogLevel::Info, "fluxora_delete_project started.");
            logOperation(
                fluxora::LogLevel::Info,
                "Project",
                std::string("Delete project requested. configPath=\"") +
                    pathForLog(std::filesystem::path(configPath)) + "\"");
            const auto project = core().projects().readProjectConfigSummary(
                std::filesystem::path(configPath)).project;
            core().projects().deleteProject(std::filesystem::path(configPath));
            core().buildFiles().eraseBuildCheckpoints(project.projectDirectory);
            logOperation(fluxora::LogLevel::Info, "Project", "Delete project completed.");
            return FluxoraCoreResultOk;
        }
        catch (const std::exception& exception)
        {
            return mapException(exception);
        }
        catch (...)
        {
            return mapUnknownException("delete project");
        }
    }

    int fluxora_delete_project_with_progress(
        const wchar_t* configPath,
        FluxoraCoreProgressCallback progressCallback,
        void* progressUserData)
    {
        try
        {
            if (isBlank(configPath))
            {
                lastError = L"Build config path is required.";
                return FluxoraCoreResultInvalidArgument;
            }

            logBridge(fluxora::LogLevel::Info, "fluxora_delete_project_with_progress started.");
            logOperation(
                fluxora::LogLevel::Info,
                "Project",
                std::string("Delete project requested. configPath=\"") +
                    pathForLog(std::filesystem::path(configPath)) + "\"");
            fluxora::ProjectDeleteRequest request;
            request.configPath = std::filesystem::path(configPath);
            if (progressCallback != nullptr)
            {
                request.progress = [progressCallback, progressUserData](const fluxora::ProjectDeleteProgress& progress)
                {
                    const std::wstring json = serializeProjectDeleteProgress(progress);
                    progressCallback(json.c_str(), progressUserData);
                };
            }

            const auto project = core().projects().readProjectConfigSummary(request.configPath).project;
            core().projects().deleteProject(request);
            core().buildFiles().eraseBuildCheckpoints(project.projectDirectory);
            logOperation(fluxora::LogLevel::Info, "Project", "Delete project completed.");
            return FluxoraCoreResultOk;
        }
        catch (const std::exception& exception)
        {
            return mapException(exception);
        }
        catch (...)
        {
            return mapUnknownException("delete project with progress");
        }
    }

    int fluxora_get_build_path_settings(
        const wchar_t* configPath,
        wchar_t* jsonBuffer,
        int jsonBufferLength)
    {
        try
        {
            if (isBlank(configPath))
            {
                lastError = L"Build config path is required.";
                return FluxoraCoreResultInvalidArgument;
            }

            const fluxora::BuildPathSettings settings =
                core().buildPathSettings().loadForConfig(std::filesystem::path(configPath));
            return writeToBuffer(serializeBuildPathSettings(settings), jsonBuffer, jsonBufferLength);
        }
        catch (const std::exception& exception)
        {
            return mapException(exception);
        }
    }

    int fluxora_save_build_path_settings(
        const wchar_t* configPath,
        const wchar_t* settingsJson,
        wchar_t* jsonBuffer,
        int jsonBufferLength)
    {
        try
        {
            if (isBlank(configPath) || isBlank(settingsJson))
            {
                lastError = L"Build config path and build path settings are required.";
                return FluxoraCoreResultInvalidArgument;
            }

            logBridge(fluxora::LogLevel::Info, "fluxora_save_build_path_settings started.");
            logOperation(
                fluxora::LogLevel::Info,
                "BuildPaths",
                std::string("Save build path settings requested. configPath=\"") +
                    pathForLog(std::filesystem::path(configPath)) + "\"");
            const fluxora::BuildPathSettings saved =
                core().buildPathSettings().saveForConfig(
                    std::filesystem::path(configPath),
                    parseBuildPathSettingsJson(settingsJson));
            logOperation(
                fluxora::LogLevel::Info,
                "BuildPaths",
                std::string("Save build path settings completed. gameDirectory=\"") +
                    pathForLog(saved.gameDirectory) + "\", modsDirectory=\"" +
                    pathForLog(saved.modsDirectory) + "\", downloadsDirectory=\"" +
                    pathForLog(saved.downloadsDirectory) + "\"");
            return writeToBuffer(serializeBuildPathSettings(saved), jsonBuffer, jsonBufferLength);
        }
        catch (const std::exception& exception)
        {
            return mapException(exception);
        }
    }

    int fluxora_export_fluxpack(
        const wchar_t* configPath,
        const wchar_t* outputPath,
        int includeGeneratedAssets,
        wchar_t* jsonBuffer,
        int jsonBufferLength)
    {
        return fluxora_export_fluxpack_with_progress(
            configPath,
            outputPath,
            includeGeneratedAssets,
            nullptr,
            nullptr,
            jsonBuffer,
            jsonBufferLength);
    }

    int fluxora_export_fluxpack_with_progress(
        const wchar_t* configPath,
        const wchar_t* outputPath,
        int includeGeneratedAssets,
        FluxoraCoreProgressCallback progressCallback,
        void* progressUserData,
        wchar_t* jsonBuffer,
        int jsonBufferLength)
    {
        return fluxora_export_fluxpack_with_options_and_progress(
            configPath,
            outputPath,
            includeGeneratedAssets,
            static_cast<int>(fluxora::FluxPackPackageType::Recipe),
            progressCallback,
            progressUserData,
            jsonBuffer,
            jsonBufferLength);
    }

    int fluxora_export_fluxpack_with_options_and_progress(
        const wchar_t* configPath,
        const wchar_t* outputPath,
        int includeGeneratedAssets,
        int packageType,
        FluxoraCoreProgressCallback progressCallback,
        void* progressUserData,
        wchar_t* jsonBuffer,
        int jsonBufferLength)
    {
        try
        {
            if (isBlank(configPath) || isBlank(outputPath))
            {
                lastError = L"Build config path and FluxPack output path are required.";
                return FluxoraCoreResultInvalidArgument;
            }

            fluxora::FluxPackPackageType resolvedPackageType;
            switch (packageType)
            {
            case static_cast<int>(fluxora::FluxPackPackageType::Full):
                resolvedPackageType = fluxora::FluxPackPackageType::Full;
                break;
            case static_cast<int>(fluxora::FluxPackPackageType::Recipe):
                resolvedPackageType = fluxora::FluxPackPackageType::Recipe;
                break;
            default:
                lastError = L"FluxPack package type must be 1 (full) or 2 (recipe).";
                return FluxoraCoreResultInvalidArgument;
            }

            logBridge(fluxora::LogLevel::Info, "fluxora_export_fluxpack started.");
            const fluxora::FluxPackSummary summary = core().fluxPacks().exportProject(
                fluxora::FluxPackExportRequest{
                    std::filesystem::path(configPath),
                    std::filesystem::path(outputPath),
                    includeGeneratedAssets != 0,
                    [progressCallback, progressUserData](const fluxora::FluxPackExportProgress& progress)
                    {
                        if (progressCallback != nullptr)
                        {
                            const std::wstring json = serializeFluxPackExportProgress(progress);
                            progressCallback(json.c_str(), progressUserData);
                        }
                    },
                    resolvedPackageType
                });
            return writeToBuffer(serializeFluxPackSummary(summary), jsonBuffer, jsonBufferLength);
        }
        catch (const std::exception& exception)
        {
            return mapException(exception);
        }
    }

    int fluxora_inspect_fluxpack(
        const wchar_t* fluxPackPath,
        wchar_t* jsonBuffer,
        int jsonBufferLength)
    {
        try
        {
            if (isBlank(fluxPackPath))
            {
                lastError = L"FluxPack path is required.";
                return FluxoraCoreResultInvalidArgument;
            }

            logBridge(fluxora::LogLevel::Info, "fluxora_inspect_fluxpack started.");
            const fluxora::FluxPackSummary summary =
                core().fluxPacks().inspectFluxPack(std::filesystem::path(fluxPackPath));
            return writeToBuffer(serializeFluxPackSummary(summary), jsonBuffer, jsonBufferLength);
        }
        catch (const std::exception& exception)
        {
            return mapException(exception);
        }
    }

    int fluxora_plan_fluxpack_install(
        const wchar_t* fluxPackPath,
        const wchar_t* existingConfigPath,
        wchar_t* jsonBuffer,
        int jsonBufferLength)
    {
        try
        {
            if (isBlank(fluxPackPath))
            {
                lastError = L"FluxPack path is required.";
                return FluxoraCoreResultInvalidArgument;
            }

            logBridge(fluxora::LogLevel::Info, "fluxora_plan_fluxpack_install started.");
            const fluxora::FluxPackInstallPlan plan = core().fluxPacks().planInstall(
                fluxora::FluxPackInstallPlanRequest{
                    std::filesystem::path(fluxPackPath),
                    isBlank(existingConfigPath)
                        ? std::filesystem::path{}
                        : std::filesystem::path(existingConfigPath)
                });
            return writeToBuffer(serializeFluxPackInstallPlan(plan), jsonBuffer, jsonBufferLength);
        }
        catch (const std::exception& exception)
        {
            return mapException(exception);
        }
    }

    int fluxora_install_fluxpack(
        const wchar_t* fluxPackPath,
        const wchar_t* installRootDirectory,
        FluxoraCoreProgressCallback progressCallback,
        void* progressUserData,
        wchar_t* jsonBuffer,
        int jsonBufferLength)
    {
        return fluxora_install_fluxpack_with_target(
            fluxPackPath,
            installRootDirectory,
            nullptr,
            progressCallback,
            progressUserData,
            jsonBuffer,
            jsonBufferLength);
    }

    int fluxora_install_fluxpack_with_target(
        const wchar_t* fluxPackPath,
        const wchar_t* installRootDirectory,
        const wchar_t* existingConfigPath,
        FluxoraCoreProgressCallback progressCallback,
        void* progressUserData,
        wchar_t* jsonBuffer,
        int jsonBufferLength)
    {
        return fluxora_install_fluxpack_with_options_and_progress(
            fluxPackPath,
            installRootDirectory,
            existingConfigPath,
            nullptr,
            nullptr,
            progressCallback,
            progressUserData,
            jsonBuffer,
            jsonBufferLength);
    }

    int fluxora_install_fluxpack_with_options_and_progress(
        const wchar_t* fluxPackPath,
        const wchar_t* installRootDirectory,
        const wchar_t* existingConfigPath,
        const wchar_t* manualSourceIdsJson,
        const wchar_t* manualSourcePathsJson,
        FluxoraCoreProgressCallback progressCallback,
        void* progressUserData,
        wchar_t* jsonBuffer,
        int jsonBufferLength)
    {
        try
        {
            if (isBlank(fluxPackPath) || isBlank(installRootDirectory))
            {
                lastError = L"FluxPack path and install root directory are required.";
                return FluxoraCoreResultInvalidArgument;
            }

            const std::vector<std::wstring> manualSourceIds = isBlank(manualSourceIdsJson)
                ? std::vector<std::wstring>{}
                : parseStringArrayJson(manualSourceIdsJson);
            const std::vector<std::wstring> manualSourcePaths = isBlank(manualSourcePathsJson)
                ? std::vector<std::wstring>{}
                : parseStringArrayJson(manualSourcePathsJson);
            if (manualSourceIds.size() != manualSourcePaths.size())
            {
                lastError = L"Manual FluxPack source id and path arrays must have the same length.";
                return FluxoraCoreResultInvalidArgument;
            }

            std::vector<fluxora::FluxPackManualSourceArchive> manualSourceArchives;
            manualSourceArchives.reserve(manualSourceIds.size());
            for (std::size_t index = 0; index < manualSourceIds.size(); ++index)
            {
                if (manualSourceIds[index].empty() || manualSourcePaths[index].empty())
                {
                    lastError = L"Manual FluxPack source ids and paths must not be empty.";
                    return FluxoraCoreResultInvalidArgument;
                }
                manualSourceArchives.push_back(fluxora::FluxPackManualSourceArchive{
                    manualSourceIds[index],
                    std::filesystem::path(manualSourcePaths[index])
                });
            }

            logBridge(fluxora::LogLevel::Info, "fluxora_install_fluxpack_with_options_and_progress started.");
            const fluxora::FluxPackInstallResult result =
                core().fluxPacks().installFluxPack(fluxora::FluxPackInstallRequest{
                    std::filesystem::path(fluxPackPath),
                    std::filesystem::path(installRootDirectory),
                    [progressCallback, progressUserData](const fluxora::FluxPackInstallProgress& progress)
                    {
                        if (progressCallback != nullptr)
                        {
                            const std::wstring json = serializeFluxPackInstallProgress(progress);
                            progressCallback(json.c_str(), progressUserData);
                        }
                    },
                    isBlank(existingConfigPath)
                        ? std::filesystem::path{}
                        : std::filesystem::path(existingConfigPath),
                    std::move(manualSourceArchives)
                });
            return writeToBuffer(serializeFluxPackInstallResult(result), jsonBuffer, jsonBufferLength);
        }
        catch (const std::exception& exception)
        {
            return mapException(exception);
        }
    }

    int fluxora_analyze_mod_organizer_instance(
        const wchar_t* sourceDirectory,
        const wchar_t* destinationRootDirectory,
        const wchar_t* existingConfigPath,
        wchar_t* jsonBuffer,
        int jsonBufferLength)
    {
        try
        {
            if (isBlank(sourceDirectory) || isBlank(destinationRootDirectory))
            {
                lastError = L"Source directory and destination root directory are required.";
                return FluxoraCoreResultInvalidArgument;
            }

            const fluxora::ModOrganizerImportAnalysis analysis =
                core().modOrganizerImport().analyze(
                    std::filesystem::path(sourceDirectory),
                    std::filesystem::path(destinationRootDirectory),
                    isBlank(existingConfigPath) ? std::filesystem::path{} : std::filesystem::path(existingConfigPath));
            return writeToBuffer(
                serializeModOrganizerImportAnalysis(analysis),
                jsonBuffer,
                jsonBufferLength);
        }
        catch (const std::exception& exception)
        {
            return mapException(exception);
        }
    }

    int fluxora_import_mod_organizer_instance(
        const wchar_t* sourceDirectory,
        const wchar_t* destinationRootDirectory,
        const wchar_t* existingConfigPath,
        int replaceExisting,
        FluxoraCoreProgressCallback progressCallback,
        void* progressUserData,
        wchar_t* jsonBuffer,
        int jsonBufferLength)
    {
        try
        {
            if (isBlank(sourceDirectory) || isBlank(destinationRootDirectory))
            {
                lastError = L"Source directory and destination root directory are required.";
                return FluxoraCoreResultInvalidArgument;
            }

            if (replaceExisting != 0 && isBlank(existingConfigPath))
            {
                lastError = L"Existing build config path is required for overwrite import.";
                return FluxoraCoreResultInvalidArgument;
            }

            logBridge(fluxora::LogLevel::Info, "fluxora_import_mod_organizer_instance started.");
            fluxora::ModOrganizerImportRequest request;
            request.sourceDirectory = std::filesystem::path(sourceDirectory);
            request.destinationRootDirectory = std::filesystem::path(destinationRootDirectory);
            request.existingConfigPath = isBlank(existingConfigPath)
                ? std::filesystem::path{}
                : std::filesystem::path(existingConfigPath);
            request.mode = replaceExisting != 0
                ? fluxora::ModOrganizerImportMode::ReplaceExisting
                : fluxora::ModOrganizerImportMode::CreateNew;
            logOperation(
                fluxora::LogLevel::Info,
                "MO2Import",
                std::string("Mod Organizer import requested. source=\"") +
                    pathForLog(request.sourceDirectory) + "\", destinationRoot=\"" +
                    pathForLog(request.destinationRootDirectory) + "\", existingConfig=\"" +
                    pathForLog(request.existingConfigPath) + "\", replaceExisting=" +
                    (replaceExisting != 0 ? "true" : "false"));
            if (progressCallback != nullptr)
            {
                request.progress = [progressCallback, progressUserData](const fluxora::ModOrganizerImportProgress& progress)
                {
                    const std::wstring json = serializeModOrganizerImportProgress(progress);
                    progressCallback(json.c_str(), progressUserData);
                };
            }

            const fluxora::ModOrganizerImportResult result =
                core().modOrganizerImport().importInstance(request);
            logOperation(
                fluxora::LogLevel::Info,
                "MO2Import",
                std::string("Mod Organizer import completed. projectDirectory=\"") +
                    pathForLog(result.project.project.projectDirectory) + "\", configPath=\"" +
                    pathForLog(result.project.project.configPath) + "\"");
            return writeToBuffer(serializeOpenedProject(result.project), jsonBuffer, jsonBufferLength);
        }
        catch (const std::exception& exception)
        {
            return mapException(exception);
        }
    }

    int fluxora_get_game_executables(
        const wchar_t* configPath,
        wchar_t* jsonBuffer,
        int jsonBufferLength)
    {
        try
        {
            if (isBlank(configPath))
            {
                lastError = L"Build config path is required.";
                return FluxoraCoreResultInvalidArgument;
            }

            const std::wstring json = serializeGameExecutables(
                core().executables().listProjectExecutables(std::filesystem::path(configPath)));
            return writeToBuffer(json, jsonBuffer, jsonBufferLength);
        }
        catch (const std::exception& exception)
        {
            return mapException(exception);
        }
    }

    int fluxora_save_game_executables(
        const wchar_t* configPath,
        const wchar_t* executablesJson,
        wchar_t* jsonBuffer,
        int jsonBufferLength)
    {
        try
        {
            if (isBlank(configPath))
            {
                lastError = L"Build config path is required.";
                return FluxoraCoreResultInvalidArgument;
            }

            logBridge(fluxora::LogLevel::Info, "fluxora_save_game_executables started.");
            logOperation(
                fluxora::LogLevel::Info,
                "Executables",
                std::string("Save executable list requested. configPath=\"") +
                    pathForLog(std::filesystem::path(configPath)) + "\"");
            const std::vector<fluxora::GameExecutable> executables = parseGameExecutablesJson(executablesJson);
            const std::wstring json = serializeGameExecutables(
                core().executables().saveProjectExecutables(
                    std::filesystem::path(configPath),
                    executables));
            logOperation(
                fluxora::LogLevel::Info,
                "Executables",
                std::string("Save executable list completed. count=") + std::to_string(executables.size()));
            return writeToBuffer(json, jsonBuffer, jsonBufferLength);
        }
        catch (const std::exception& exception)
        {
            return mapException(exception);
        }
    }

    int fluxora_launch_game_executable(
        const wchar_t* configPath,
        const wchar_t* executableId,
        const wchar_t* profileName,
        wchar_t* jsonBuffer,
        int jsonBufferLength)
    {
        try
        {
            if (isBlank(configPath) || isBlank(executableId))
            {
                lastError = L"Build config path and executable id are required.";
                return FluxoraCoreResultInvalidArgument;
            }

            // Launching always goes through the virtual file system so the game
            // sees the merged mod data directory, exactly like Mod Organizer 2.
            // The service only falls back to a plain launch when there is
            // nothing to virtualize; missing VFS support is a build error.
            logBridge(fluxora::LogLevel::Info, "fluxora_launch_game_executable started.");
            logOperation(
                fluxora::LogLevel::Info,
                "Launch",
                std::string("Launch executable requested. configPath=\"") +
                    pathForLog(std::filesystem::path(configPath)) + "\", executableId=\"" +
                    textForLog(executableId) + "\", profile=\"" +
                    textForLog(isBlank(profileName) ? L"" : profileName) + "\"");
            const auto launchStartedAt = std::chrono::steady_clock::now();
            (void)core().grassCache().clearStaleNgioPrecacheMarkersForLaunch(
                std::filesystem::path(configPath));
            const auto grassCleanupCompletedAt = std::chrono::steady_clock::now();
            const fluxora::GameExecutableLaunchResult launchResult =
                core().virtualFileSystem().launchExecutable(
                    std::filesystem::path(configPath),
                    executableId,
                    isBlank(profileName) ? L"" : std::wstring_view(profileName));
            const auto processCreatedAt = std::chrono::steady_clock::now();
            const std::wstring json = serializeGameExecutableLaunch(launchResult);
            const auto serializedAt = std::chrono::steady_clock::now();
            const auto elapsedMicroseconds = [](const auto start, const auto end)
            {
                return std::chrono::duration_cast<std::chrono::microseconds>(end - start).count();
            };
            logOperation(
                fluxora::LogLevel::Info,
                "Performance",
                "launchApiTiming grassCleanupUs=" +
                    std::to_string(elapsedMicroseconds(launchStartedAt, grassCleanupCompletedAt)) +
                    ", vfsAndProcessCreateUs=" +
                    std::to_string(elapsedMicroseconds(grassCleanupCompletedAt, processCreatedAt)) +
                    ", serializeUs=" +
                    std::to_string(elapsedMicroseconds(processCreatedAt, serializedAt)) +
                    ", totalUs=" +
                    std::to_string(elapsedMicroseconds(launchStartedAt, serializedAt)) + ".");
            logOperation(fluxora::LogLevel::Info, "Launch", "Launch executable completed.");
            return writeToBuffer(json, jsonBuffer, jsonBufferLength);
        }
        catch (const std::exception& exception)
        {
            return mapException(exception);
        }
    }

    int fluxora_get_executable_icon(
        const wchar_t* executablePath,
        wchar_t* iconPathBuffer,
        int iconPathBufferLength)
    {
        try
        {
            if (isBlank(executablePath))
            {
                lastError = L"Executable path is required.";
                return FluxoraCoreResultInvalidArgument;
            }

            const std::wstring iconPath =
                core().executableIcons().resolveIconPath(std::filesystem::path(executablePath)).wstring();
            return writeToBuffer(iconPath, iconPathBuffer, iconPathBufferLength);
        }
        catch (const std::exception& exception)
        {
            return mapException(exception);
        }
    }

    int fluxora_get_nexusmods_auth_status(wchar_t* jsonBuffer, int jsonBufferLength)
    {
        try
        {
            const std::wstring json = serializeNexusModsAuthStatus(core().nexusModsAuth().status());
            return writeToBuffer(json, jsonBuffer, jsonBufferLength);
        }
        catch (const std::exception& exception)
        {
            return mapException(exception);
        }
    }

    int fluxora_complete_managed_executable_launch(
        const wchar_t* sessionId,
        const wchar_t* outcome,
        wchar_t* jsonBuffer,
        int jsonBufferLength)
    {
        try
        {
            if (isBlank(sessionId))
            {
                lastError = L"Managed launch session id is required.";
                return FluxoraCoreResultInvalidArgument;
            }
            const fluxora::ManagedLaunchCompletion completion =
                core().bodySlideIntegration().completeManagedLaunch(
                    sessionId,
                    isBlank(outcome) ? L"completed" : std::wstring_view(outcome));
            return writeToBuffer(
                serializeManagedLaunchCompletion(completion),
                jsonBuffer,
                jsonBufferLength);
        }
        catch (const std::exception& exception)
        {
            return mapException(exception);
        }
    }

    int fluxora_get_nexusmods_api_auth_header(wchar_t* jsonBuffer, int jsonBufferLength)
    {
        try
        {
            const std::wstring json = serializeNexusModsApiAuthHeader(core().nexusModsAuth().apiAuthHeader());
            return writeToBuffer(json, jsonBuffer, jsonBufferLength);
        }
        catch (const std::exception& exception)
        {
            return mapException(exception);
        }
    }

    int fluxora_get_api_limit_status(wchar_t* jsonBuffer, int jsonBufferLength)
    {
        try
        {
            const std::wstring json = serializeApiLimitStatus(core().nexusModsAuth().apiLimits());
            return writeToBuffer(json, jsonBuffer, jsonBufferLength);
        }
        catch (const std::exception& exception)
        {
            return mapException(exception);
        }
    }

    int fluxora_connect_nexusmods(wchar_t* jsonBuffer, int jsonBufferLength)
    {
        try
        {
            const std::wstring json = serializeNexusModsAuthStatus(core().nexusModsAuth().connect());
            return writeToBuffer(json, jsonBuffer, jsonBufferLength);
        }
        catch (const std::exception& exception)
        {
            return mapException(exception);
        }
    }

    int fluxora_connect_nexusmods_with_api_key(
        const wchar_t* apiKey,
        wchar_t* jsonBuffer,
        int jsonBufferLength)
    {
        try
        {
            if (isBlank(apiKey))
            {
                lastError = L"NexusMods API key is required.";
                return FluxoraCoreResultInvalidArgument;
            }

            const std::wstring json = serializeNexusModsAuthStatus(
                core().nexusModsAuth().connectWithApiKey(apiKey));
            return writeToBuffer(json, jsonBuffer, jsonBufferLength);
        }
        catch (const std::exception& exception)
        {
            return mapException(exception);
        }
    }

    int fluxora_disconnect_nexusmods(wchar_t* jsonBuffer, int jsonBufferLength)
    {
        try
        {
            const std::wstring json = serializeNexusModsAuthStatus(core().nexusModsAuth().disconnect());
            return writeToBuffer(json, jsonBuffer, jsonBufferLength);
        }
        catch (const std::exception& exception)
        {
            return mapException(exception);
        }
    }

    int fluxora_get_app_language(wchar_t* languageBuffer, int languageBufferLength)
    {
        try
        {
            logOperation(fluxora::LogLevel::Info, "Settings", "Read app language requested.");
            const std::wstring languageCode = core().settings().loadLanguageCode();
            logOperation(fluxora::LogLevel::Info, "Settings", "Read app language completed.");
            return writeToBuffer(languageCode, languageBuffer, languageBufferLength);
        }
        catch (const std::exception& exception)
        {
            return mapException(exception);
        }
    }

    int fluxora_set_app_language(const wchar_t* languageCode)
    {
        try
        {
            if (isBlank(languageCode))
            {
                lastError = L"Language code is required.";
                return FluxoraCoreResultInvalidArgument;
            }

            core().settings().saveLanguageCode(languageCode);
            logOperation(
                fluxora::LogLevel::Info,
                "Settings",
                "Saved app language: " + textForLog(languageCode));
            return FluxoraCoreResultOk;
        }
        catch (const std::exception& exception)
        {
            return mapException(exception);
        }
    }

    int fluxora_list_external_connections(
        const wchar_t* operationId,
        wchar_t* jsonBuffer,
        int jsonBufferLength)
    {
        try
        {
            const std::wstring json = serializeExternalConnectionSnapshot(
                core().externalConnections().listStatus(operationId == nullptr ? L"" : operationId));
            return writeToBuffer(json, jsonBuffer, jsonBufferLength);
        }
        catch (const std::exception& exception)
        {
            return mapException(exception);
        }
    }

    int fluxora_restore_external_connections(
        const wchar_t* operationId,
        int deadlineMilliseconds,
        int attempt,
        wchar_t* jsonBuffer,
        int jsonBufferLength)
    {
        try
        {
            const std::wstring json = serializeExternalConnectionSnapshot(
                core().externalConnections().restoreAll(
                    operationId == nullptr ? L"" : operationId,
                    std::chrono::milliseconds((std::max)(1, deadlineMilliseconds)),
                    static_cast<std::size_t>((std::max)(1, attempt))));
            return writeToBuffer(json, jsonBuffer, jsonBufferLength);
        }
        catch (const std::exception& exception)
        {
            return mapException(exception);
        }
    }

    int fluxora_connect_external_connection(
        const wchar_t* providerId,
        const wchar_t* operationId,
        wchar_t* jsonBuffer,
        int jsonBufferLength)
    {
        try
        {
            if (isBlank(providerId))
            {
                lastError = L"External connection provider id is required.";
                return FluxoraCoreResultInvalidArgument;
            }
            const std::wstring json = serializeExternalConnectionStatus(
                core().externalConnections().connect(
                    providerId,
                    operationId == nullptr ? L"" : operationId));
            return writeToBuffer(json, jsonBuffer, jsonBufferLength);
        }
        catch (const std::exception& exception)
        {
            return mapException(exception);
        }
    }

    int fluxora_disconnect_external_connection(
        const wchar_t* providerId,
        const wchar_t* operationId,
        wchar_t* jsonBuffer,
        int jsonBufferLength)
    {
        try
        {
            if (isBlank(providerId))
            {
                lastError = L"External connection provider id is required.";
                return FluxoraCoreResultInvalidArgument;
            }
            const std::wstring json = serializeExternalConnectionStatus(
                core().externalConnections().disconnect(
                    providerId,
                    operationId == nullptr ? L"" : operationId));
            return writeToBuffer(json, jsonBuffer, jsonBufferLength);
        }
        catch (const std::exception& exception)
        {
            return mapException(exception);
        }
    }

    int fluxora_get_app_theme(wchar_t* themeBuffer, int themeBufferLength)
    {
        try
        {
            logOperation(fluxora::LogLevel::Info, "Settings", "Read app theme requested.");
            const std::wstring themeMode = core().settings().loadThemeMode();
            logOperation(fluxora::LogLevel::Info, "Settings", "Read app theme completed.");
            return writeToBuffer(themeMode, themeBuffer, themeBufferLength);
        }
        catch (const std::exception& exception)
        {
            return mapException(exception);
        }
    }

    int fluxora_set_app_theme(const wchar_t* themeMode)
    {
        try
        {
            if (isBlank(themeMode))
            {
                lastError = L"Theme mode is required.";
                return FluxoraCoreResultInvalidArgument;
            }

            core().settings().saveThemeMode(themeMode);
            logOperation(
                fluxora::LogLevel::Info,
                "Settings",
                "Saved app theme: " + textForLog(themeMode));
            return FluxoraCoreResultOk;
        }
        catch (const std::exception& exception)
        {
            return mapException(exception);
        }
    }

    int fluxora_register_nxm_protocol(
        const wchar_t* executablePath,
        wchar_t* jsonBuffer,
        int jsonBufferLength)
    {
        try
        {
            if (isBlank(executablePath))
            {
                lastError = L"Executable path is required.";
                return FluxoraCoreResultInvalidArgument;
            }

            core().downloads().registerNxmProtocol(std::filesystem::path(executablePath));
            const std::wstring json = serializeNxmProtocolStatus(
                core().downloads().isNxmProtocolRegistered(std::filesystem::path(executablePath)));
            return writeToBuffer(json, jsonBuffer, jsonBufferLength);
        }
        catch (const std::exception& exception)
        {
            return mapException(exception);
        }
    }

    int fluxora_get_installed_mods(
        const wchar_t* projectDirectory,
        wchar_t* jsonBuffer,
        int jsonBufferLength)
    {
        try
        {
            if (isBlank(projectDirectory))
            {
                lastError = L"Project directory is required.";
                return FluxoraCoreResultInvalidArgument;
            }

            const std::wstring json = serializeInstalledModList(
                core().mods().listInstalledMods(std::filesystem::path(projectDirectory)));
            return writeToBuffer(json, jsonBuffer, jsonBufferLength);
        }
        catch (const std::exception& exception)
        {
            return mapException(exception);
        }
    }

    int fluxora_get_mod_workspace(
        const wchar_t* projectDirectory,
        const wchar_t* profileName,
        wchar_t* jsonBuffer,
        int jsonBufferLength)
    {
        try
        {
            if (isBlank(projectDirectory))
            {
                lastError = L"Project directory is required.";
                return FluxoraCoreResultInvalidArgument;
            }

            const std::wstring json = serializeModWorkspaceSnapshot(
                core().profileOrder().workspaceSnapshot(
                    std::filesystem::path(projectDirectory),
                    isBlank(profileName) ? L"" : std::wstring_view(profileName)));
            return writeToBuffer(json, jsonBuffer, jsonBufferLength);
        }
        catch (const std::exception& exception)
        {
            return mapException(exception);
        }
    }

    int fluxora_get_persisted_mod_workspace(
        const wchar_t* projectDirectory,
        const wchar_t* profileName,
        wchar_t* jsonBuffer,
        int jsonBufferLength)
    {
        try
        {
            if (isBlank(projectDirectory))
            {
                lastError = L"Project directory is required.";
                return FluxoraCoreResultInvalidArgument;
            }

            const std::wstring json = serializeModWorkspaceSnapshot(
                core().profileOrder().persistedWorkspaceSnapshot(
                    std::filesystem::path(projectDirectory),
                    isBlank(profileName) ? L"" : std::wstring_view(profileName)));
            return writeToBuffer(json, jsonBuffer, jsonBufferLength);
        }
        catch (const std::exception& exception)
        {
            return mapException(exception);
        }
    }

    int fluxora_invalidate_mod_file_caches(
        const wchar_t* projectDirectory,
        const wchar_t* changedPathsJson,
        wchar_t* jsonBuffer,
        int jsonBufferLength)
    {
        try
        {
            if (isBlank(projectDirectory))
            {
                lastError = L"Project directory is required.";
                return FluxoraCoreResultInvalidArgument;
            }

            const std::vector<std::wstring> changedPathValues =
                isBlank(changedPathsJson)
                    ? std::vector<std::wstring>{}
                    : parseStringArrayJson(changedPathsJson);
            std::vector<std::filesystem::path> changedPaths;
            changedPaths.reserve(changedPathValues.size());
            for (const std::wstring& changedPath : changedPathValues)
            {
                changedPaths.emplace_back(changedPath);
            }
            core().mods().invalidateFileCaches(
                std::filesystem::path(projectDirectory),
                changedPaths);
            core().plugins().invalidateDiscoveryCaches();

            fluxora::JsonWriter writer;
            writer.beginObject();
            writer.field(L"invalidated", !changedPaths.empty());
            writer.field(L"changedPathCount", static_cast<int>(changedPaths.size()));
            writer.endObject();
            return writeToBuffer(writer.str(), jsonBuffer, jsonBufferLength);
        }
        catch (const std::exception& exception)
        {
            return mapException(exception);
        }
    }

    int fluxora_get_profiles(
        const wchar_t* projectDirectory,
        const wchar_t* defaultProfileName,
        wchar_t* jsonBuffer,
        int jsonBufferLength)
    {
        try
        {
            if (isBlank(projectDirectory))
            {
                lastError = L"Project directory is required.";
                return FluxoraCoreResultInvalidArgument;
            }

            const std::wstring json = serializeStringArray(
                core().profiles().listProfiles(
                    std::filesystem::path(projectDirectory),
                    isBlank(defaultProfileName) ? L"" : std::wstring_view(defaultProfileName)));
            return writeToBuffer(json, jsonBuffer, jsonBufferLength);
        }
        catch (const std::exception& exception)
        {
            return mapException(exception);
        }
    }

    int fluxora_preview_profile_text_file(
        const wchar_t* projectDirectory,
        const wchar_t* profileName,
        const wchar_t* fileName,
        int maxBytes,
        wchar_t* jsonBuffer,
        int jsonBufferLength)
    {
        try
        {
            if (isBlank(projectDirectory) || isBlank(profileName) || isBlank(fileName))
            {
                lastError = L"Project directory, profile name and profile text file name are required.";
                return FluxoraCoreResultInvalidArgument;
            }

            const std::wstring json = serializeProfileTextFilePreview(
                core().profiles().previewProfileTextFile(
                    std::filesystem::path(projectDirectory),
                    profileName,
                    fileName,
                    maxBytes > 0 ? static_cast<std::uintmax_t>(maxBytes) : 0));
            return writeToBuffer(json, jsonBuffer, jsonBufferLength);
        }
        catch (const std::exception& exception)
        {
            return mapException(exception);
        }
    }

    int fluxora_create_profile(
        const wchar_t* projectDirectory,
        const wchar_t* profileName,
        const wchar_t* defaultProfileName,
        const wchar_t* profileFilesJson,
        wchar_t* jsonBuffer,
        int jsonBufferLength)
    {
        try
        {
            if (isBlank(projectDirectory) || isBlank(profileName))
            {
                lastError = L"Project directory and profile name are required.";
                return FluxoraCoreResultInvalidArgument;
            }

            logBridge(fluxora::LogLevel::Info, "fluxora_create_profile started.");
            const std::wstring json = serializeStringArray(
                core().profiles().createProfile(
                    std::filesystem::path(projectDirectory),
                    profileName,
                    isBlank(defaultProfileName) ? L"" : std::wstring_view(defaultProfileName),
                    parseStringArrayJson(profileFilesJson)));
            return writeToBuffer(json, jsonBuffer, jsonBufferLength);
        }
        catch (const std::exception& exception)
        {
            return mapException(exception);
        }
    }

    int fluxora_clone_profile(
        const wchar_t* projectDirectory,
        const wchar_t* sourceProfileName,
        const wchar_t* targetProfileName,
        const wchar_t* defaultProfileName,
        wchar_t* jsonBuffer,
        int jsonBufferLength)
    {
        try
        {
            if (isBlank(projectDirectory) || isBlank(sourceProfileName) || isBlank(targetProfileName))
            {
                lastError = L"Project directory, source profile, and target profile are required.";
                return FluxoraCoreResultInvalidArgument;
            }

            logBridge(fluxora::LogLevel::Info, "fluxora_clone_profile started.");
            const std::wstring json = serializeStringArray(
                core().profiles().cloneProfile(
                    std::filesystem::path(projectDirectory),
                    sourceProfileName,
                    targetProfileName,
                    isBlank(defaultProfileName) ? L"" : std::wstring_view(defaultProfileName)));
            return writeToBuffer(json, jsonBuffer, jsonBufferLength);
        }
        catch (const std::exception& exception)
        {
            return mapException(exception);
        }
    }

    int fluxora_rename_profile(
        const wchar_t* projectDirectory,
        const wchar_t* sourceProfileName,
        const wchar_t* targetProfileName,
        const wchar_t* defaultProfileName,
        wchar_t* jsonBuffer,
        int jsonBufferLength)
    {
        try
        {
            if (isBlank(projectDirectory) || isBlank(sourceProfileName) || isBlank(targetProfileName))
            {
                lastError = L"Project directory, source profile, and target profile are required.";
                return FluxoraCoreResultInvalidArgument;
            }

            logBridge(fluxora::LogLevel::Info, "fluxora_rename_profile started.");
            const std::wstring json = serializeStringArray(
                core().profiles().renameProfile(
                    std::filesystem::path(projectDirectory),
                    sourceProfileName,
                    targetProfileName,
                    isBlank(defaultProfileName) ? L"" : std::wstring_view(defaultProfileName)));
            return writeToBuffer(json, jsonBuffer, jsonBufferLength);
        }
        catch (const std::exception& exception)
        {
            return mapException(exception);
        }
    }

    int fluxora_delete_profile(
        const wchar_t* projectDirectory,
        const wchar_t* profileName,
        const wchar_t* defaultProfileName,
        wchar_t* jsonBuffer,
        int jsonBufferLength)
    {
        try
        {
            if (isBlank(projectDirectory) || isBlank(profileName))
            {
                lastError = L"Project directory and profile name are required.";
                return FluxoraCoreResultInvalidArgument;
            }

            logBridge(fluxora::LogLevel::Info, "fluxora_delete_profile started.");
            const std::wstring json = serializeStringArray(
                core().profiles().deleteProfile(
                    std::filesystem::path(projectDirectory),
                    profileName,
                    isBlank(defaultProfileName) ? L"" : std::wstring_view(defaultProfileName)));
            return writeToBuffer(json, jsonBuffer, jsonBufferLength);
        }
        catch (const std::exception& exception)
        {
            return mapException(exception);
        }
    }

    int fluxora_get_mod_order(
        const wchar_t* projectDirectory,
        const wchar_t* profileName,
        wchar_t* jsonBuffer,
        int jsonBufferLength)
    {
        try
        {
            if (isBlank(projectDirectory))
            {
                lastError = L"Project directory is required.";
                return FluxoraCoreResultInvalidArgument;
            }

            const std::wstring json = serializeProfileModOrder(
                core().profileOrder().listModOrder(
                    std::filesystem::path(projectDirectory),
                    isBlank(profileName) ? L"" : std::wstring_view(profileName)));
            return writeToBuffer(json, jsonBuffer, jsonBufferLength);
        }
        catch (const std::exception& exception)
        {
            return mapException(exception);
        }
    }

    int fluxora_create_mod_separator(
        const wchar_t* projectDirectory,
        const wchar_t* profileName,
        const wchar_t* title,
        int targetIndex,
        wchar_t* jsonBuffer,
        int jsonBufferLength)
    {
        try
        {
            if (isBlank(projectDirectory) || isBlank(title))
            {
                lastError = L"Project directory and separator title are required.";
                return FluxoraCoreResultInvalidArgument;
            }

            fluxora::InstallProjectGate projectGate(projectDirectory);
            const std::wstring json = serializeProfileModOrder(
                core().profileOrder().createModSeparator(
                    std::filesystem::path(projectDirectory),
                    isBlank(profileName) ? L"" : std::wstring_view(profileName),
                    title,
                    targetIndex));
            return writeToBuffer(json, jsonBuffer, jsonBufferLength);
        }
        catch (const std::exception& exception)
        {
            return mapException(exception);
        }
    }

    int fluxora_delete_mod_separator(
        const wchar_t* projectDirectory,
        const wchar_t* profileName,
        const wchar_t* separatorId,
        wchar_t* jsonBuffer,
        int jsonBufferLength)
    {
        try
        {
            if (isBlank(projectDirectory) || isBlank(separatorId))
            {
                lastError = L"Project directory and separator id are required.";
                return FluxoraCoreResultInvalidArgument;
            }

            fluxora::InstallProjectGate projectGate(projectDirectory);
            const std::wstring json = serializeProfileModOrder(
                core().profileOrder().deleteModSeparator(
                    std::filesystem::path(projectDirectory),
                    isBlank(profileName) ? L"" : std::wstring_view(profileName),
                    separatorId));
            return writeToBuffer(json, jsonBuffer, jsonBufferLength);
        }
        catch (const std::exception& exception)
        {
            return mapException(exception);
        }
    }

    int fluxora_move_mod_order_item(
        const wchar_t* projectDirectory,
        const wchar_t* profileName,
        const wchar_t* orderItemId,
        int targetIndex,
        wchar_t* jsonBuffer,
        int jsonBufferLength)
    {
        try
        {
            if (isBlank(projectDirectory) || isBlank(orderItemId))
            {
                lastError = L"Project directory and order item id are required.";
                return FluxoraCoreResultInvalidArgument;
            }

            fluxora::InstallProjectGate projectGate(projectDirectory);
            const std::wstring json = serializeProfileModOrder(
                core().profileOrder().moveModOrderItem(
                    std::filesystem::path(projectDirectory),
                    isBlank(profileName) ? L"" : std::wstring_view(profileName),
                    orderItemId,
                    targetIndex));
            return writeToBuffer(json, jsonBuffer, jsonBufferLength);
        }
        catch (const std::exception& exception)
        {
            return mapException(exception);
        }
    }

    int fluxora_delete_installed_mod(
        const wchar_t* projectDirectory,
        const wchar_t* modPath)
    {
        try
        {
            if (isBlank(projectDirectory) || isBlank(modPath))
            {
                lastError = L"Project directory and mod path are required.";
                return FluxoraCoreResultInvalidArgument;
            }

            logBridge(fluxora::LogLevel::Info, "fluxora_delete_installed_mod started.");
            logOperation(
                fluxora::LogLevel::Info,
                "Mods",
                std::string("Delete installed mod requested. projectDirectory=\"") +
                    pathForLog(std::filesystem::path(projectDirectory)) + "\", modPath=\"" +
                    pathForLog(std::filesystem::path(modPath)) + "\"");
            core().mods().deleteInstalledMod(
                std::filesystem::path(projectDirectory),
                std::filesystem::path(modPath));
            syncSkyrimPluginsForInstalledMods(std::filesystem::path(projectDirectory), "Delete installed mod", false);
            logOperation(fluxora::LogLevel::Info, "Mods", "Delete installed mod completed.");
            return FluxoraCoreResultOk;
        }
        catch (const std::exception& exception)
        {
            return mapException(exception);
        }
    }

    int fluxora_create_empty_mod(
        const wchar_t* projectDirectory,
        const wchar_t* modName,
        wchar_t* jsonBuffer,
        int jsonBufferLength)
    {
        try
        {
            if (isBlank(projectDirectory) || isBlank(modName))
            {
                lastError = L"Project directory and mod name are required.";
                return FluxoraCoreResultInvalidArgument;
            }

            logBridge(fluxora::LogLevel::Info, "fluxora_create_empty_mod started.");
            logOperation(
                fluxora::LogLevel::Info,
                "Mods",
                std::string("Create empty mod requested. projectDirectory=\"") +
                    pathForLog(std::filesystem::path(projectDirectory)) + "\", modName=\"" +
                    textForLog(modName) + "\"");
            const std::wstring json = serializeInstalledModEntry(
                core().mods().createEmptyMod(
                    std::filesystem::path(projectDirectory),
                    modName));
            syncSkyrimPluginsForInstalledMods(std::filesystem::path(projectDirectory), "Create empty mod", true);
            logOperation(fluxora::LogLevel::Info, "Mods", "Create empty mod completed.");
            return writeToBuffer(json, jsonBuffer, jsonBufferLength);
        }
        catch (const std::exception& exception)
        {
            return mapException(exception);
        }
    }

    int fluxora_set_installed_mod_enabled(
        const wchar_t* projectDirectory,
        const wchar_t* modPath,
        int isEnabled)
    {
        try
        {
            if (isBlank(projectDirectory) || isBlank(modPath))
            {
                lastError = L"Project directory and mod path are required.";
                return FluxoraCoreResultInvalidArgument;
            }

            logOperation(
                fluxora::LogLevel::Info,
                "Mods",
                std::string("Set installed mod state requested. projectDirectory=\"") +
                    pathForLog(std::filesystem::path(projectDirectory)) + "\", modPath=\"" +
                    pathForLog(std::filesystem::path(modPath)) + "\", enabled=" +
                    (isEnabled != 0 ? "true" : "false"));
            core().mods().setInstalledModEnabled(
                std::filesystem::path(projectDirectory),
                std::filesystem::path(modPath),
                isEnabled != 0);
            syncSkyrimPluginsForInstalledMods(
                std::filesystem::path(projectDirectory),
                "Set installed mod state",
                isEnabled != 0);
            logOperation(fluxora::LogLevel::Info, "Mods", "Set installed mod state completed.");
            return FluxoraCoreResultOk;
        }
        catch (const std::exception& exception)
        {
            return mapException(exception);
        }
    }

    int fluxora_set_all_installed_mods_enabled(
        const wchar_t* projectDirectory,
        int isEnabled)
    {
        try
        {
            if (isBlank(projectDirectory))
            {
                lastError = L"Project directory is required.";
                return FluxoraCoreResultInvalidArgument;
            }

            logOperation(
                fluxora::LogLevel::Info,
                "Mods",
                std::string("Set all installed mods state requested. projectDirectory=\"") +
                    pathForLog(std::filesystem::path(projectDirectory)) + "\", enabled=" +
                    (isEnabled != 0 ? "true" : "false"));
            core().mods().setAllInstalledModsEnabled(
                std::filesystem::path(projectDirectory),
                isEnabled != 0);
            syncSkyrimPluginsForInstalledMods(
                std::filesystem::path(projectDirectory),
                "Set all installed mods state",
                isEnabled != 0);
            logOperation(fluxora::LogLevel::Info, "Mods", "Set all installed mods state completed.");
            return FluxoraCoreResultOk;
        }
        catch (const std::exception& exception)
        {
            return mapException(exception);
        }
    }

    int fluxora_clear_overwrite_folder(
        const wchar_t* projectDirectory)
    {
        try
        {
            if (isBlank(projectDirectory))
            {
                lastError = L"Project directory is required.";
                return FluxoraCoreResultInvalidArgument;
            }

            logOperation(
                fluxora::LogLevel::Info,
                "Overwrite",
                std::string("Clear overwrite folder requested. projectDirectory=\"") +
                    pathForLog(std::filesystem::path(projectDirectory)) + "\"");
            core().mods().clearOverwriteFolder(std::filesystem::path(projectDirectory));
            logOperation(fluxora::LogLevel::Info, "Overwrite", "Clear overwrite folder completed.");
            return FluxoraCoreResultOk;
        }
        catch (const std::exception& exception)
        {
            return mapException(exception);
        }
    }

    int fluxora_generate_ngio_grass_cache(
        const wchar_t* configPath,
        const wchar_t* profileName,
        FluxoraCoreProgressCallback progressCallback,
        void* progressUserData,
        wchar_t* jsonBuffer,
        int jsonBufferLength)
    {
        try
        {
            if (isBlank(configPath))
            {
                lastError = L"Build config path is required.";
                return FluxoraCoreResultInvalidArgument;
            }

            logBridge(fluxora::LogLevel::Info, "fluxora_generate_ngio_grass_cache started.");
            logOperation(
                fluxora::LogLevel::Info,
                "GrassCache",
                std::string("NGIO grass cache generation requested. configPath=\"") +
                    pathForLog(std::filesystem::path(configPath)) + "\", profile=\"" +
                    textForLog(isBlank(profileName) ? L"" : profileName) + "\"");

            const fluxora::GrassCacheGenerationResult result =
                core().grassCache().generateNgioGrassCache(
                    std::filesystem::path(configPath),
                    isBlank(profileName) ? L"" : std::wstring_view(profileName),
                    {},
                    [progressCallback, progressUserData](const fluxora::GrassCacheGenerationProgress& progress)
                    {
                        if (progressCallback != nullptr)
                        {
                            const std::wstring json = serializeGrassCacheProgress(progress);
                            progressCallback(json.c_str(), progressUserData);
                        }
                    });

            logOperation(
                fluxora::LogLevel::Info,
                "GrassCache",
                "NGIO grass cache generation completed.");
            return writeToBuffer(serializeGrassCacheResult(result), jsonBuffer, jsonBufferLength);
        }
        catch (const std::exception& exception)
        {
            return mapException(exception);
        }
    }

    int fluxora_check_mod_updates(
        const wchar_t* projectDirectory,
        wchar_t* jsonBuffer,
        int jsonBufferLength)
    {
        try
        {
            if (isBlank(projectDirectory))
            {
                lastError = L"Project directory is required.";
                return FluxoraCoreResultInvalidArgument;
            }

            fluxora::ModUpdateService service(
                core().logger(),
                core().buildPathSettings(),
                core().nexusUpdateApi());
            (void)service.check(fluxora::ModUpdateCheckRequest{
                std::filesystem::path(projectDirectory),
                fluxora::ModUpdateCheckMode::Manual});
            const std::wstring json = serializeInstalledModList(
                core().mods().listInstalledMods(std::filesystem::path(projectDirectory)));
            return writeToBuffer(json, jsonBuffer, jsonBufferLength);
        }
        catch (const std::exception& exception)
        {
            return mapException(exception);
        }
    }

    int fluxora_check_mod_updates_v2(
        const wchar_t* requestJson,
        FluxoraCoreProgressCallback progressCallback,
        void* progressUserData,
        wchar_t* jsonBuffer,
        int jsonBufferLength)
    {
        try
        {
            if (isBlank(requestJson))
            {
                lastError = L"Mod update request JSON is required.";
                return FluxoraCoreResultInvalidArgument;
            }

            const fluxora::JsonValue root = fluxora::JsonReader::parse(requestJson);
            if (!root.isObject())
            {
                lastError = L"Expected a JSON mod update request object.";
                return FluxoraCoreResultInvalidArgument;
            }
            const fluxora::JsonValue* projectValue = root.find(L"projectDirectory");
            const fluxora::JsonValue* modeValue = root.find(L"mode");
            if (projectValue == nullptr || !projectValue->isString() ||
                isBlank(projectValue->asString().c_str()))
            {
                lastError = L"Project directory is required.";
                return FluxoraCoreResultInvalidArgument;
            }
            if (modeValue == nullptr || !modeValue->isString())
            {
                lastError = L"Mod update check mode is required.";
                return FluxoraCoreResultInvalidArgument;
            }

            fluxora::ModUpdateCheckMode mode;
            if (modeValue->asString() == L"automatic")
            {
                mode = fluxora::ModUpdateCheckMode::Automatic;
            }
            else if (modeValue->asString() == L"manual")
            {
                mode = fluxora::ModUpdateCheckMode::Manual;
            }
            else
            {
                lastError = L"Mod update check mode must be automatic or manual.";
                return FluxoraCoreResultInvalidArgument;
            }

            fluxora::ModUpdateServiceOptions options;
            if (progressCallback != nullptr)
            {
                options.progress = [progressCallback, progressUserData](
                    std::size_t completed,
                    std::size_t total,
                    std::wstring_view modId)
                {
                    fluxora::JsonWriter writer;
                    writer.beginObject();
                    writer.field(L"phase", L"metadata");
                    writer.field(L"completed", static_cast<std::uintmax_t>(completed));
                    writer.field(L"total", static_cast<std::uintmax_t>(total));
                    writer.field(L"modId", modId);
                    writer.endObject();
                    progressCallback(writer.str().c_str(), progressUserData);
                };
            }

            fluxora::ModUpdateService service(
                core().logger(),
                core().buildPathSettings(),
                core().nexusUpdateApi(),
                std::move(options));
            const fluxora::ModUpdateCheckResult result = service.check(fluxora::ModUpdateCheckRequest{
                std::filesystem::path(projectValue->asString()),
                mode});
            return writeToBuffer(
                serializeModUpdateCheckResult(result),
                jsonBuffer,
                jsonBufferLength);
        }
        catch (const std::exception& exception)
        {
            return mapException(exception);
        }
    }

    int fluxora_get_mod_file_tree(
        const wchar_t* projectDirectory,
        const wchar_t* modPath,
        const wchar_t* relativeDirectory,
        wchar_t* jsonBuffer,
        int jsonBufferLength)
    {
        try
        {
            if (isBlank(projectDirectory) || isBlank(modPath))
            {
                lastError = L"Project directory and mod path are required.";
                return FluxoraCoreResultInvalidArgument;
            }

            const std::wstring json = serializeModFileTree(
                core().mods().listModFileTree(
                    std::filesystem::path(projectDirectory),
                    std::filesystem::path(modPath),
                    isBlank(relativeDirectory) ? L"" : std::wstring_view(relativeDirectory)));
            return writeToBuffer(json, jsonBuffer, jsonBufferLength);
        }
        catch (const std::exception& exception)
        {
            return mapException(exception);
        }
    }

    int fluxora_get_mod_details_content(
        const wchar_t* projectDirectory,
        const wchar_t* modPath,
        wchar_t* jsonBuffer,
        int jsonBufferLength)
    {
        try
        {
            if (isBlank(projectDirectory) || isBlank(modPath))
            {
                lastError = L"Project directory and mod path are required.";
                return FluxoraCoreResultInvalidArgument;
            }

            const std::wstring json = serializeModDetailsContent(
                core().mods().getModDetailsContent(
                    std::filesystem::path(projectDirectory),
                    std::filesystem::path(modPath)));
            return writeToBuffer(json, jsonBuffer, jsonBufferLength);
        }
        catch (const std::exception& exception)
        {
            return mapException(exception);
        }
    }

    int fluxora_get_mod_conflict_tree(
        const wchar_t* projectDirectory,
        const wchar_t* modPath,
        const wchar_t* cursor,
        int limit,
        wchar_t* jsonBuffer,
        int jsonBufferLength)
    {
        try
        {
            if (isBlank(projectDirectory) || isBlank(modPath))
            {
                lastError = L"Project directory and mod path are required.";
                return FluxoraCoreResultInvalidArgument;
            }

            const std::wstring json = serializeModConflictTree(
                core().mods().listModConflictTree(
                    std::filesystem::path(projectDirectory),
                    std::filesystem::path(modPath),
                    isBlank(cursor) ? L"" : std::wstring_view(cursor),
                    limit));
            return writeToBuffer(json, jsonBuffer, jsonBufferLength);
        }
        catch (const std::exception& exception)
        {
            return mapException(exception);
        }
    }

    int fluxora_get_mod_details_summary(
        const wchar_t* projectDirectory,
        const wchar_t* profileName,
        const wchar_t* modPath,
        wchar_t* jsonBuffer,
        int jsonBufferLength)
    {
        try
        {
            if (isBlank(projectDirectory) || isBlank(modPath))
            {
                lastError = L"Project directory and mod path are required.";
                return FluxoraCoreResultInvalidArgument;
            }

            const auto normalizedPathKey = [](const std::filesystem::path& path)
            {
                std::filesystem::path normalized = path.lexically_normal();
                std::wstring value = normalized.wstring();
                std::replace(value.begin(), value.end(), L'/', L'\\');
                std::transform(
                    value.begin(),
                    value.end(),
                    value.begin(),
                    [](wchar_t character)
                    {
                        return static_cast<wchar_t>(std::towlower(character));
                    });
                return value;
            };

            const std::filesystem::path requested(modPath);
            const std::wstring requestedKey = normalizedPathKey(requested);
            const std::vector<fluxora::ProfileModOrderItem> order =
                core().profileOrder().listCachedModOrder(
                    std::filesystem::path(projectDirectory),
                    isBlank(profileName) ? L"" : std::wstring_view(profileName));

            const auto match = std::find_if(
                order.begin(),
                order.end(),
                [&requested, &requestedKey, &normalizedPathKey](const fluxora::ProfileModOrderItem& item)
                {
                    if (item.kind != L"mod")
                    {
                        return false;
                    }

                    if (normalizedPathKey(item.id) == requestedKey)
                    {
                        return true;
                    }

                    return item.id.filename().wstring() == requested.filename().wstring();
                });

            if (match == order.end())
            {
                lastError = L"Mod details summary was not found.";
                return FluxoraCoreResultInvalidArgument;
            }

            const std::wstring json = serializeModDetailsSummary(*match);
            return writeToBuffer(json, jsonBuffer, jsonBufferLength);
        }
        catch (const std::exception& exception)
        {
            return mapException(exception);
        }
    }

    int fluxora_prepare_workspace_indexes(
        const wchar_t* projectDirectory,
        const wchar_t* profileName,
        wchar_t* jsonBuffer,
        int jsonBufferLength)
    {
        try
        {
            if (isBlank(projectDirectory))
            {
                lastError = L"Project directory is required.";
                return FluxoraCoreResultInvalidArgument;
            }

            const std::wstring json = serializeEffectiveFileTreeWarmup(
                core().effectiveFileTree().prepareWorkspaceIndexes(
                    std::filesystem::path(projectDirectory),
                    isBlank(profileName) ? L"" : std::wstring_view(profileName)));
            return writeToBuffer(json, jsonBuffer, jsonBufferLength);
        }
        catch (const std::exception& exception)
        {
            return mapException(exception);
        }
    }

    int fluxora_get_effective_file_tree(
        const wchar_t* projectDirectory,
        const wchar_t* profileName,
        wchar_t* jsonBuffer,
        int jsonBufferLength)
    {
        try
        {
            if (isBlank(projectDirectory))
            {
                lastError = L"Project directory is required.";
                return FluxoraCoreResultInvalidArgument;
            }

            const std::wstring json = serializeEffectiveFileTree(
                core().effectiveFileTree().snapshot(
                    std::filesystem::path(projectDirectory),
                    isBlank(profileName) ? L"" : std::wstring_view(profileName)));
            return writeToBuffer(json, jsonBuffer, jsonBufferLength);
        }
        catch (const std::exception& exception)
        {
            return mapException(exception);
        }
    }

    int fluxora_get_effective_file_tree_root(
        const wchar_t* projectDirectory,
        const wchar_t* profileName,
        int limit,
        wchar_t* jsonBuffer,
        int jsonBufferLength)
    {
        try
        {
            if (isBlank(projectDirectory))
            {
                lastError = L"Project directory is required.";
                return FluxoraCoreResultInvalidArgument;
            }

            const std::wstring json = serializeEffectiveFileTreePage(
                core().effectiveFileTree().root(
                    std::filesystem::path(projectDirectory),
                    isBlank(profileName) ? L"" : std::wstring_view(profileName),
                    limit));
            return writeToBuffer(json, jsonBuffer, jsonBufferLength);
        }
        catch (const std::exception& exception)
        {
            return mapException(exception);
        }
    }

    int fluxora_get_effective_file_tree_children(
        const wchar_t* projectDirectory,
        const wchar_t* profileName,
        const wchar_t* revision,
        const wchar_t* relativeDirectory,
        const wchar_t* cursor,
        int limit,
        wchar_t* jsonBuffer,
        int jsonBufferLength)
    {
        try
        {
            if (isBlank(projectDirectory) || isBlank(revision))
            {
                lastError = L"Project directory and revision are required.";
                return FluxoraCoreResultInvalidArgument;
            }

            const std::wstring json = serializeEffectiveFileTreePage(
                core().effectiveFileTree().children(
                    std::filesystem::path(projectDirectory),
                    isBlank(profileName) ? L"" : std::wstring_view(profileName),
                    std::wstring_view(revision),
                    isBlank(relativeDirectory) ? L"" : std::wstring_view(relativeDirectory),
                    isBlank(cursor) ? L"" : std::wstring_view(cursor),
                    limit));
            return writeToBuffer(json, jsonBuffer, jsonBufferLength);
        }
        catch (const std::exception& exception)
        {
            return mapException(exception);
        }
    }

    int fluxora_start_nif_preview(
        const wchar_t* projectDirectory,
        const wchar_t* profileName,
        const wchar_t* initialModPath,
        const wchar_t* relativePath,
        wchar_t* jsonBuffer,
        int jsonBufferLength)
    {
        try
        {
            if (isBlank(projectDirectory) || isBlank(initialModPath) || isBlank(relativePath))
            {
                lastError = L"Project directory, initial mod path and NIF path are required.";
                return FluxoraCoreResultInvalidArgument;
            }

            const std::wstring json = serializeNifPreviewStart(
                core().mods().startNifPreview(
                    std::filesystem::path(projectDirectory),
                    isBlank(profileName) ? L"" : std::wstring_view(profileName),
                    std::filesystem::path(initialModPath),
                    std::wstring_view(relativePath)));
            return writeToBuffer(json, jsonBuffer, jsonBufferLength);
        }
        catch (const std::exception& exception)
        {
            return mapException(exception);
        }
    }

    int fluxora_prepare_nif_preview_variant(
        const wchar_t* projectDirectory,
        const wchar_t* modPath,
        const wchar_t* relativePath,
        wchar_t* jsonBuffer,
        int jsonBufferLength)
    {
        try
        {
            if (isBlank(projectDirectory) || isBlank(modPath) || isBlank(relativePath))
            {
                lastError = L"Project directory, mod path and NIF path are required.";
                return FluxoraCoreResultInvalidArgument;
            }

            const std::wstring json = serializeNifPreviewPreparedAsset(
                core().mods().prepareNifPreviewVariant(
                    std::filesystem::path(projectDirectory),
                    std::filesystem::path(modPath),
                    std::wstring_view(relativePath)));
            return writeToBuffer(json, jsonBuffer, jsonBufferLength);
        }
        catch (const std::exception& exception)
        {
            return mapException(exception);
        }
    }

    int fluxora_prepare_nif_preview_textures(
        const wchar_t* projectDirectory,
        const wchar_t* profileName,
        const wchar_t* modelModPath,
        const wchar_t* texturePathsJson,
        wchar_t* jsonBuffer,
        int jsonBufferLength)
    {
        try
        {
            if (isBlank(projectDirectory) || isBlank(modelModPath))
            {
                lastError = L"Project directory and model mod path are required.";
                return FluxoraCoreResultInvalidArgument;
            }

            const std::vector<std::wstring> texturePaths = isBlank(texturePathsJson)
                ? std::vector<std::wstring>{}
                : parseStringArrayJson(texturePathsJson);
            const std::wstring json = serializeNifPreviewTextureBatch(
                core().mods().prepareNifPreviewTextures(
                    std::filesystem::path(projectDirectory),
                    isBlank(profileName) ? L"" : std::wstring_view(profileName),
                    std::filesystem::path(modelModPath),
                    texturePaths));
            return writeToBuffer(json, jsonBuffer, jsonBufferLength);
        }
        catch (const std::exception& exception)
        {
            return mapException(exception);
        }
    }

    int fluxora_read_mod_text_file(
        const wchar_t* projectDirectory,
        const wchar_t* modPath,
        const wchar_t* relativePath,
        wchar_t* jsonBuffer,
        int jsonBufferLength)
    {
        try
        {
            if (isBlank(projectDirectory) || isBlank(modPath) || isBlank(relativePath))
            {
                lastError = L"Project directory, mod path and text file path are required.";
                return FluxoraCoreResultInvalidArgument;
            }

            const std::wstring json = serializeModTextFileDocument(
                core().mods().readModTextFile(
                    std::filesystem::path(projectDirectory),
                    std::filesystem::path(modPath),
                    std::wstring_view(relativePath)));
            return writeToBuffer(json, jsonBuffer, jsonBufferLength);
        }
        catch (const std::exception& exception)
        {
            return mapException(exception);
        }
    }

    int fluxora_preview_mod_text_file(
        const wchar_t* projectDirectory,
        const wchar_t* modPath,
        const wchar_t* relativePath,
        int maxBytes,
        wchar_t* jsonBuffer,
        int jsonBufferLength)
    {
        try
        {
            if (isBlank(projectDirectory) || isBlank(modPath) || isBlank(relativePath))
            {
                lastError = L"Project directory, mod path and text file path are required.";
                return FluxoraCoreResultInvalidArgument;
            }

            const std::wstring json = serializeModTextFilePreview(
                core().mods().previewModTextFile(
                    std::filesystem::path(projectDirectory),
                    std::filesystem::path(modPath),
                    std::wstring_view(relativePath),
                    maxBytes > 0 ? static_cast<std::uintmax_t>(maxBytes) : 0));
            return writeToBuffer(json, jsonBuffer, jsonBufferLength);
        }
        catch (const std::exception& exception)
        {
            return mapException(exception);
        }
    }

    int fluxora_save_mod_text_file(
        const wchar_t* projectDirectory,
        const wchar_t* modPath,
        const wchar_t* relativePath,
        const wchar_t* content,
        wchar_t* jsonBuffer,
        int jsonBufferLength)
    {
        try
        {
            if (isBlank(projectDirectory) || isBlank(modPath) || isBlank(relativePath) || content == nullptr)
            {
                lastError = L"Project directory, mod path, text file path and content are required.";
                return FluxoraCoreResultInvalidArgument;
            }

            const std::wstring json = serializeModTextFileSaveResult(
                core().mods().saveModTextFile(
                    std::filesystem::path(projectDirectory),
                    std::filesystem::path(modPath),
                    std::wstring_view(relativePath),
                    std::wstring_view(content)));
            return writeToBuffer(json, jsonBuffer, jsonBufferLength);
        }
        catch (const std::exception& exception)
        {
            return mapException(exception);
        }
    }

    int fluxora_read_text_file(
        const wchar_t* filePath,
        wchar_t* jsonBuffer,
        int jsonBufferLength)
    {
        try
        {
            if (isBlank(filePath))
            {
                lastError = L"Text file path is required.";
                return FluxoraCoreResultInvalidArgument;
            }

            const std::filesystem::path path(filePath);
            const std::wstring content = readUtf8TextFileForEditor(path);
            std::error_code sizeError;
            const std::uintmax_t size = std::filesystem::file_size(path, sizeError);
            return writeToBuffer(
                serializeTextFileDocument(path, content, sizeError ? 0 : size),
                jsonBuffer,
                jsonBufferLength);
        }
        catch (const std::exception& exception)
        {
            return mapException(exception);
        }
    }

    int fluxora_save_text_file(
        const wchar_t* filePath,
        const wchar_t* content,
        wchar_t* jsonBuffer,
        int jsonBufferLength)
    {
        try
        {
            if (isBlank(filePath) || content == nullptr)
            {
                lastError = L"Text file path and content are required.";
                return FluxoraCoreResultInvalidArgument;
            }

            const std::filesystem::path path(filePath);
            const std::string bytes = utf8FromWide(std::wstring_view(content));
            validateTextFileWritePath(path, static_cast<std::uintmax_t>(bytes.size()));
            fluxora::AtomicFileStore().writeTextFile(
                path,
                bytes,
                fluxora::AtomicFileWriteOptions{
                    L"Text editor file",
                    fluxora::ProjectStateValidation::Utf8Text,
                    {},
                    true
                });

            logOperation(
                fluxora::LogLevel::Info,
                "TextEditor",
                "Saved text file path=\"" + pathForLog(path) + "\"");

            std::error_code sizeError;
            const std::uintmax_t size = std::filesystem::file_size(path, sizeError);
            return writeToBuffer(
                serializeTextFileSaveResult(path, sizeError ? 0 : size),
                jsonBuffer,
                jsonBufferLength);
        }
        catch (const std::exception& exception)
        {
            return mapException(exception);
        }
    }

    int fluxora_get_plugins(
        const wchar_t* projectDirectory,
        const wchar_t* templateId,
        const wchar_t* profileName,
        wchar_t* jsonBuffer,
        int jsonBufferLength)
    {
        try
        {
            if (isBlank(projectDirectory))
            {
                lastError = L"Project directory is required.";
                return FluxoraCoreResultInvalidArgument;
            }

            const fluxora::PluginRuleContext rules = resolvePluginRuleContextForTemplate(templateId);
            const std::wstring json = serializePlugins(core().plugins().listPlugins(
                std::filesystem::path(projectDirectory),
                rules,
                isBlank(profileName) ? L"" : profileName));
            return writeToBuffer(json, jsonBuffer, jsonBufferLength);
        }
        catch (const std::exception& exception)
        {
            return mapException(exception);
        }
    }

    int fluxora_get_persisted_plugins(
        const wchar_t* projectDirectory,
        const wchar_t* templateId,
        const wchar_t* profileName,
        wchar_t* jsonBuffer,
        int jsonBufferLength)
    {
        try
        {
            if (isBlank(projectDirectory))
            {
                lastError = L"Project directory is required.";
                return FluxoraCoreResultInvalidArgument;
            }

            const fluxora::PluginRuleContext rules = resolvePluginRuleContextForTemplate(templateId);
            const std::wstring json = serializePlugins(core().plugins().listPersistedPlugins(
                std::filesystem::path(projectDirectory),
                rules,
                isBlank(profileName) ? L"" : profileName));
            return writeToBuffer(json, jsonBuffer, jsonBufferLength);
        }
        catch (const std::exception& exception)
        {
            return mapException(exception);
        }
    }

    int fluxora_move_plugin(
        const wchar_t* projectDirectory,
        const wchar_t* templateId,
        const wchar_t* profileName,
        const wchar_t* orderItemId,
        int targetIndex,
        wchar_t* jsonBuffer,
        int jsonBufferLength)
    {
        try
        {
            if (isBlank(projectDirectory) || isBlank(orderItemId))
            {
                lastError = L"Project directory and plugin order item id are required.";
                return FluxoraCoreResultInvalidArgument;
            }

            const fluxora::PluginRuleContext rules = resolvePluginRuleContextForTemplate(templateId);
            const std::wstring json = serializePlugins(core().plugins().movePlugin(
                std::filesystem::path(projectDirectory),
                rules,
                isBlank(profileName) ? L"" : profileName,
                orderItemId,
                targetIndex));
            return writeToBuffer(json, jsonBuffer, jsonBufferLength);
        }
        catch (const std::exception& exception)
        {
            return mapException(exception);
        }
    }

    int fluxora_create_plugin_separator(
        const wchar_t* projectDirectory,
        const wchar_t* templateId,
        const wchar_t* profileName,
        const wchar_t* title,
        int targetIndex,
        wchar_t* jsonBuffer,
        int jsonBufferLength)
    {
        try
        {
            if (isBlank(projectDirectory) || isBlank(title))
            {
                lastError = L"Project directory and separator title are required.";
                return FluxoraCoreResultInvalidArgument;
            }

            const fluxora::PluginRuleContext rules = resolvePluginRuleContextForTemplate(templateId);
            const std::wstring json = serializePlugins(core().plugins().createPluginSeparator(
                std::filesystem::path(projectDirectory),
                rules,
                isBlank(profileName) ? L"" : profileName,
                title,
                targetIndex));
            return writeToBuffer(json, jsonBuffer, jsonBufferLength);
        }
        catch (const std::exception& exception)
        {
            return mapException(exception);
        }
    }

    int fluxora_delete_plugin_separator(
        const wchar_t* projectDirectory,
        const wchar_t* templateId,
        const wchar_t* profileName,
        const wchar_t* separatorId,
        wchar_t* jsonBuffer,
        int jsonBufferLength)
    {
        try
        {
            if (isBlank(projectDirectory) || isBlank(separatorId))
            {
                lastError = L"Project directory and separator id are required.";
                return FluxoraCoreResultInvalidArgument;
            }

            const fluxora::PluginRuleContext rules = resolvePluginRuleContextForTemplate(templateId);
            const std::wstring json = serializePlugins(core().plugins().deletePluginSeparator(
                std::filesystem::path(projectDirectory),
                rules,
                isBlank(profileName) ? L"" : profileName,
                separatorId));
            return writeToBuffer(json, jsonBuffer, jsonBufferLength);
        }
        catch (const std::exception& exception)
        {
            return mapException(exception);
        }
    }

    int fluxora_set_plugin_enabled(
        const wchar_t* projectDirectory,
        const wchar_t* templateId,
        const wchar_t* profileName,
        const wchar_t* pluginName,
        int isEnabled,
        wchar_t* jsonBuffer,
        int jsonBufferLength)
    {
        try
        {
            if (isBlank(projectDirectory) || isBlank(pluginName))
            {
                lastError = L"Project directory and plugin name are required.";
                return FluxoraCoreResultInvalidArgument;
            }

            const fluxora::PluginRuleContext rules = resolvePluginRuleContextForTemplate(templateId);
            const std::wstring json = serializePlugins(core().plugins().setPluginEnabled(
                std::filesystem::path(projectDirectory),
                rules,
                isBlank(profileName) ? L"" : profileName,
                pluginName,
                isEnabled != 0));
            return writeToBuffer(json, jsonBuffer, jsonBufferLength);
        }
        catch (const std::exception& exception)
        {
            return mapException(exception);
        }
    }

    int fluxora_set_all_plugins_enabled(
        const wchar_t* projectDirectory,
        const wchar_t* templateId,
        const wchar_t* profileName,
        int isEnabled,
        wchar_t* jsonBuffer,
        int jsonBufferLength)
    {
        try
        {
            if (isBlank(projectDirectory))
            {
                lastError = L"Project directory is required.";
                return FluxoraCoreResultInvalidArgument;
            }

            const fluxora::PluginRuleContext rules = resolvePluginRuleContextForTemplate(templateId);
            const std::wstring json = serializePlugins(core().plugins().setAllPluginsEnabled(
                std::filesystem::path(projectDirectory),
                rules,
                isBlank(profileName) ? L"" : profileName,
                isEnabled != 0));
            return writeToBuffer(json, jsonBuffer, jsonBufferLength);
        }
        catch (const std::exception& exception)
        {
            return mapException(exception);
        }
    }

    int fluxora_get_downloads(
        const wchar_t* projectDirectory,
        wchar_t* jsonBuffer,
        int jsonBufferLength)
    {
        try
        {
            if (isBlank(projectDirectory))
            {
                lastError = L"Project directory is required.";
                return FluxoraCoreResultInvalidArgument;
            }

            const std::wstring json = serializeDownloads(
                core().downloads().listDownloads(std::filesystem::path(projectDirectory)));
            return writeToBuffer(json, jsonBuffer, jsonBufferLength);
        }
        catch (const std::exception& exception)
        {
            return mapException(exception);
        }
    }

    int fluxora_capture_nxm_links(
        const wchar_t* projectDirectory,
        const wchar_t* nxmLinksJson,
        wchar_t* jsonBuffer,
        int jsonBufferLength)
    {
        try
        {
            const std::vector<std::wstring> links = parseStringArrayJson(nxmLinksJson);
            const std::vector<fluxora::DownloadEntry> downloads = isBlank(projectDirectory)
                ? core().downloads().queueInboundNxmLinks(links)
                : core().downloads().captureNxmLinks(std::filesystem::path(projectDirectory), links);
            return writeToBuffer(serializeDownloads(downloads), jsonBuffer, jsonBufferLength);
        }
        catch (const std::exception& exception)
        {
            return mapException(exception);
        }
    }

    int fluxora_delete_download(
        const wchar_t* projectDirectory,
        const wchar_t* downloadPath)
    {
        try
        {
            if (isBlank(projectDirectory) || isBlank(downloadPath))
            {
                lastError = L"Project directory and download path are required.";
                return FluxoraCoreResultInvalidArgument;
            }

            logBridge(fluxora::LogLevel::Info, "fluxora_delete_download started.");
            logOperation(
                fluxora::LogLevel::Info,
                "Downloads",
                std::string("Delete download requested. projectDirectory=\"") +
                    pathForLog(std::filesystem::path(projectDirectory)) + "\", downloadPath=\"" +
                    pathForLog(std::filesystem::path(downloadPath)) + "\"");
            core().downloads().deleteDownload(
                std::filesystem::path(projectDirectory),
                std::filesystem::path(downloadPath));
            logOperation(fluxora::LogLevel::Info, "Downloads", "Delete download completed.");
            return FluxoraCoreResultOk;
        }
        catch (const std::exception& exception)
        {
            return mapException(exception);
        }
    }

    int fluxora_cancel_download(
        const wchar_t* projectDirectory,
        const wchar_t* downloadPath)
    {
        try
        {
            if (isBlank(projectDirectory) || isBlank(downloadPath))
            {
                lastError = L"Project directory and download path are required.";
                return FluxoraCoreResultInvalidArgument;
            }

            logOperation(
                fluxora::LogLevel::Info,
                "Downloads",
                std::string("Cancel download requested. projectDirectory=\"") +
                    pathForLog(std::filesystem::path(projectDirectory)) + "\", downloadPath=\"" +
                    pathForLog(std::filesystem::path(downloadPath)) + "\"");
            core().downloads().cancelDownload(
                std::filesystem::path(projectDirectory),
                std::filesystem::path(downloadPath));
            logOperation(fluxora::LogLevel::Info, "Downloads", "Cancel download completed.");
            return FluxoraCoreResultOk;
        }
        catch (const std::exception& exception)
        {
            return mapException(exception);
        }
    }

    int fluxora_resume_download(
        const wchar_t* projectDirectory,
        const wchar_t* downloadPath,
        wchar_t* jsonBuffer,
        int jsonBufferLength)
    {
        try
        {
            if (isBlank(projectDirectory) || isBlank(downloadPath))
            {
                lastError = L"Project directory and download path are required.";
                return FluxoraCoreResultInvalidArgument;
            }

            logOperation(
                fluxora::LogLevel::Info,
                "Downloads",
                std::string("Resume download requested. projectDirectory=\"") +
                    pathForLog(std::filesystem::path(projectDirectory)) + "\", downloadPath=\"" +
                    pathForLog(std::filesystem::path(downloadPath)) + "\"");
            const fluxora::DownloadEntry download = core().downloads().resumeDownload(
                std::filesystem::path(projectDirectory),
                std::filesystem::path(downloadPath));
            logOperation(fluxora::LogLevel::Info, "Downloads", "Resume download completed.");
            return writeToBuffer(serializeDownload(download), jsonBuffer, jsonBufferLength);
        }
        catch (const std::exception& exception)
        {
            return mapException(exception);
        }
    }

    int fluxora_import_inbound_downloads(
        const wchar_t* projectDirectory,
        wchar_t* jsonBuffer,
        int jsonBufferLength)
    {
        try
        {
            if (isBlank(projectDirectory))
            {
                lastError = L"Project directory is required.";
                return FluxoraCoreResultInvalidArgument;
            }

            logOperation(
                fluxora::LogLevel::Info,
                "Downloads",
                std::string("Import inbound downloads requested. projectDirectory=\"") +
                    pathForLog(std::filesystem::path(projectDirectory)) + "\"");
            const std::wstring json = serializeDownloads(
                core().downloads().importInboundNxmLinks(std::filesystem::path(projectDirectory)));
            logOperation(fluxora::LogLevel::Info, "Downloads", "Import inbound downloads completed.");
            return writeToBuffer(json, jsonBuffer, jsonBufferLength);
        }
        catch (const std::exception& exception)
        {
            return mapException(exception);
        }
    }

    int fluxora_import_download_file(
        const wchar_t* projectDirectory,
        const wchar_t* sourcePath,
        wchar_t* jsonBuffer,
        int jsonBufferLength)
    {
        try
        {
            if (isBlank(projectDirectory) || isBlank(sourcePath))
            {
                lastError = L"Project directory and source path are required.";
                return FluxoraCoreResultInvalidArgument;
            }

            logBridge(fluxora::LogLevel::Info, "fluxora_import_download_file started.");
            logOperation(
                fluxora::LogLevel::Info,
                "Downloads",
                std::string("Import download file requested. projectDirectory=\"") +
                    pathForLog(std::filesystem::path(projectDirectory)) + "\", sourcePath=\"" +
                    pathForLog(std::filesystem::path(sourcePath)) + "\"");
            const std::wstring json = serializeDownload(
                core().downloads().importLocalFile(
                    std::filesystem::path(projectDirectory),
                    std::filesystem::path(sourcePath)));
            logOperation(fluxora::LogLevel::Info, "Downloads", "Import download file completed.");
            return writeToBuffer(json, jsonBuffer, jsonBufferLength);
        }
        catch (const std::exception& exception)
        {
            return mapException(exception);
        }
    }

    int fluxora_plan_download_install(
        const wchar_t* projectDirectory,
        const wchar_t* downloadPath,
        wchar_t* jsonBuffer,
        int jsonBufferLength)
    {
        try
        {
            if (isBlank(projectDirectory) || isBlank(downloadPath))
            {
                lastError = L"Project directory and download path are required.";
                return FluxoraCoreResultInvalidArgument;
            }
            return writeToBuffer(
                serializeInstallPlan(core().downloads().planDownloadInstall(
                    std::filesystem::path(projectDirectory),
                    std::filesystem::path(downloadPath))),
                jsonBuffer,
                jsonBufferLength);
        }
        catch (const std::exception& exception)
        {
            return mapException(exception);
        }
    }

    int fluxora_resolve_download_duplicate_decision(
        const wchar_t* projectDirectory,
        const wchar_t* downloadPath,
        const wchar_t* decisionId,
        int choice,
        wchar_t* jsonBuffer,
        int jsonBufferLength)
    {
        try
        {
            if (isBlank(projectDirectory) || isBlank(downloadPath) || isBlank(decisionId) ||
                choice < static_cast<int>(fluxora::DownloadDuplicateChoice::Replace) ||
                choice > static_cast<int>(fluxora::DownloadDuplicateChoice::Cancel))
            {
                lastError = L"Project directory, download path, decision id and valid choice are required.";
                return FluxoraCoreResultInvalidArgument;
            }

            const std::optional<fluxora::DownloadEntry> download =
                core().downloads().resolveDuplicateDecision(
                    std::filesystem::path(projectDirectory),
                    std::filesystem::path(downloadPath),
                    std::wstring_view(decisionId),
                    static_cast<fluxora::DownloadDuplicateChoice>(choice));
            if (!download.has_value())
            {
                return writeToBuffer(L"null", jsonBuffer, jsonBufferLength);
            }
            return writeToBuffer(serializeDownload(*download), jsonBuffer, jsonBufferLength);
        }
        catch (const std::exception& exception)
        {
            return mapException(exception);
        }
    }

    int fluxora_plan_archive_install(
        const wchar_t* projectDirectory,
        const wchar_t* archivePath,
        wchar_t* jsonBuffer,
        int jsonBufferLength)
    {
        try
        {
            if (isBlank(projectDirectory) || isBlank(archivePath))
            {
                lastError = L"Project directory and archive path are required.";
                return FluxoraCoreResultInvalidArgument;
            }
            return writeToBuffer(
                serializeInstallPlan(core().downloads().planArchiveInstall(
                    std::filesystem::path(projectDirectory),
                    std::filesystem::path(archivePath))),
                jsonBuffer,
                jsonBufferLength);
        }
        catch (const std::exception& exception)
        {
            return mapException(exception);
        }
    }

    int fluxora_plan_download_install_for_profile(
        const wchar_t* projectDirectory,
        const wchar_t* downloadPath,
        const wchar_t* profileName,
        wchar_t* jsonBuffer,
        int jsonBufferLength)
    {
        try
        {
            if (isBlank(projectDirectory) || isBlank(downloadPath))
            {
                lastError = L"Project directory and download path are required.";
                return FluxoraCoreResultInvalidArgument;
            }
            return writeToBuffer(
                serializeInstallPlan(core().downloads().planDownloadInstall(
                    std::filesystem::path(projectDirectory),
                    std::filesystem::path(downloadPath),
                    isBlank(profileName) ? std::wstring_view{} : std::wstring_view(profileName))),
                jsonBuffer,
                jsonBufferLength);
        }
        catch (const std::exception& exception)
        {
            return mapException(exception);
        }
    }

    int fluxora_plan_download_install_for_profile_with_name(
        const wchar_t* projectDirectory,
        const wchar_t* downloadPath,
        const wchar_t* profileName,
        const wchar_t* modName,
        wchar_t* jsonBuffer,
        int jsonBufferLength)
    {
        try
        {
            if (isBlank(projectDirectory) || isBlank(downloadPath) || isBlank(modName))
            {
                lastError = L"Project directory, download path, and mod name are required.";
                return FluxoraCoreResultInvalidArgument;
            }
            return writeToBuffer(
                serializeInstallPlan(core().downloads().planDownloadInstall(
                    std::filesystem::path(projectDirectory),
                    std::filesystem::path(downloadPath),
                    isBlank(profileName) ? std::wstring_view{} : std::wstring_view(profileName),
                    std::wstring_view(modName))),
                jsonBuffer,
                jsonBufferLength);
        }
        catch (const std::exception& exception)
        {
            return mapException(exception);
        }
    }

    int fluxora_plan_archive_install_for_profile(
        const wchar_t* projectDirectory,
        const wchar_t* archivePath,
        const wchar_t* profileName,
        wchar_t* jsonBuffer,
        int jsonBufferLength)
    {
        try
        {
            if (isBlank(projectDirectory) || isBlank(archivePath))
            {
                lastError = L"Project directory and archive path are required.";
                return FluxoraCoreResultInvalidArgument;
            }
            return writeToBuffer(
                serializeInstallPlan(core().downloads().planArchiveInstall(
                    std::filesystem::path(projectDirectory),
                    std::filesystem::path(archivePath),
                    isBlank(profileName) ? std::wstring_view{} : std::wstring_view(profileName))),
                jsonBuffer,
                jsonBufferLength);
        }
        catch (const std::exception& exception)
        {
            return mapException(exception);
        }
    }

    int fluxora_plan_archive_install_for_profile_with_name(
        const wchar_t* projectDirectory,
        const wchar_t* archivePath,
        const wchar_t* profileName,
        const wchar_t* modName,
        wchar_t* jsonBuffer,
        int jsonBufferLength)
    {
        try
        {
            if (isBlank(projectDirectory) || isBlank(archivePath) || isBlank(modName))
            {
                lastError = L"Project directory, archive path, and mod name are required.";
                return FluxoraCoreResultInvalidArgument;
            }
            return writeToBuffer(
                serializeInstallPlan(core().downloads().planArchiveInstall(
                    std::filesystem::path(projectDirectory),
                    std::filesystem::path(archivePath),
                    isBlank(profileName) ? std::wstring_view{} : std::wstring_view(profileName),
                    std::wstring_view(modName))),
                jsonBuffer,
                jsonBufferLength);
        }
        catch (const std::exception& exception)
        {
            return mapException(exception);
        }
    }

    int fluxora_install_download(
        const wchar_t* projectDirectory,
        const wchar_t* downloadPath,
        const wchar_t* modName,
        wchar_t* jsonBuffer,
        int jsonBufferLength)
    {
        return installDownloadWithMode(
            projectDirectory,
            downloadPath,
            modName,
            0,
            nullptr,
            nullptr,
            jsonBuffer,
            jsonBufferLength);
    }

    int fluxora_install_download_with_mode(
        const wchar_t* projectDirectory,
        const wchar_t* downloadPath,
        const wchar_t* modName,
        int existingModMode,
        wchar_t* jsonBuffer,
        int jsonBufferLength)
    {
        return installDownloadWithMode(
            projectDirectory,
            downloadPath,
            modName,
            existingModMode,
            nullptr,
            nullptr,
            jsonBuffer,
            jsonBufferLength);
    }

    int fluxora_install_download_with_layout(
        const wchar_t* projectDirectory,
        const wchar_t* downloadPath,
        const wchar_t* modName,
        int existingModMode,
        const wchar_t* placementOverridesJson,
        wchar_t* jsonBuffer,
        int jsonBufferLength)
    {
        return installDownloadWithMode(
            projectDirectory,
            downloadPath,
            modName,
            existingModMode,
            placementOverridesJson,
            nullptr,
            jsonBuffer,
            jsonBufferLength);
    }

    int fluxora_install_download_planned(
        const wchar_t* projectDirectory,
        const wchar_t* downloadPath,
        const wchar_t* modName,
        int existingModMode,
        const wchar_t* placementOverridesJson,
        const wchar_t* resolutionId,
        int identityDecision,
        const wchar_t* targetModUuid,
        int newNamePolicy,
        wchar_t* jsonBuffer,
        int jsonBufferLength)
    {
        fluxora::ModIdentityInstallSelection selection;
        if (!tryParseIdentityInstallSelection(
                resolutionId,
                identityDecision,
                targetModUuid,
                newNamePolicy,
                selection))
        {
            lastError = L"Install identity selection is invalid.";
            return FluxoraCoreResultInvalidArgument;
        }
        return installDownloadWithMode(
            projectDirectory,
            downloadPath,
            modName,
            existingModMode,
            placementOverridesJson,
            &selection,
            jsonBuffer,
            jsonBufferLength);
    }

    int fluxora_install_download_planned_with_progress(
        const wchar_t* projectDirectory,
        const wchar_t* downloadPath,
        const wchar_t* modName,
        int existingModMode,
        const wchar_t* placementOverridesJson,
        const wchar_t* resolutionId,
        int identityDecision,
        const wchar_t* targetModUuid,
        int newNamePolicy,
        const wchar_t* profileName,
        int modOrderTargetIndex,
        FluxoraCoreProgressCallback progressCallback,
        void* progressUserData,
        wchar_t* jsonBuffer,
        int jsonBufferLength)
    {
        fluxora::ModIdentityInstallSelection selection;
        if (!tryParseIdentityInstallSelection(
                resolutionId,
                identityDecision,
                targetModUuid,
                newNamePolicy,
                selection))
        {
            lastError = L"Install identity selection is invalid.";
            return FluxoraCoreResultInvalidArgument;
        }
        return installDownloadWithMode(
            projectDirectory,
            downloadPath,
            modName,
            existingModMode,
            placementOverridesJson,
            &selection,
            jsonBuffer,
            jsonBufferLength,
            profileName,
            modOrderTargetIndex,
            progressCallback,
            progressUserData);
    }

    int fluxora_install_archive_with_mode(
        const wchar_t* projectDirectory,
        const wchar_t* archivePath,
        const wchar_t* modName,
        int existingModMode,
        wchar_t* jsonBuffer,
        int jsonBufferLength)
    {
        return installArchiveWithMode(
            projectDirectory,
            archivePath,
            modName,
            existingModMode,
            nullptr,
            nullptr,
            jsonBuffer,
            jsonBufferLength);
    }

    int fluxora_install_archive_with_layout(
        const wchar_t* projectDirectory,
        const wchar_t* archivePath,
        const wchar_t* modName,
        int existingModMode,
        const wchar_t* placementOverridesJson,
        wchar_t* jsonBuffer,
        int jsonBufferLength)
    {
        return installArchiveWithMode(
            projectDirectory,
            archivePath,
            modName,
            existingModMode,
            placementOverridesJson,
            nullptr,
            jsonBuffer,
            jsonBufferLength);
    }

    int fluxora_install_archive_planned(
        const wchar_t* projectDirectory,
        const wchar_t* archivePath,
        const wchar_t* modName,
        int existingModMode,
        const wchar_t* placementOverridesJson,
        const wchar_t* resolutionId,
        int identityDecision,
        const wchar_t* targetModUuid,
        int newNamePolicy,
        wchar_t* jsonBuffer,
        int jsonBufferLength)
    {
        fluxora::ModIdentityInstallSelection selection;
        if (!tryParseIdentityInstallSelection(
                resolutionId,
                identityDecision,
                targetModUuid,
                newNamePolicy,
                selection))
        {
            lastError = L"Install identity selection is invalid.";
            return FluxoraCoreResultInvalidArgument;
        }
        return installArchiveWithMode(
            projectDirectory,
            archivePath,
            modName,
            existingModMode,
            placementOverridesJson,
            &selection,
            jsonBuffer,
            jsonBufferLength);
    }

    int fluxora_install_archive_planned_with_progress(
        const wchar_t* projectDirectory,
        const wchar_t* archivePath,
        const wchar_t* modName,
        int existingModMode,
        const wchar_t* placementOverridesJson,
        const wchar_t* resolutionId,
        int identityDecision,
        const wchar_t* targetModUuid,
        int newNamePolicy,
        const wchar_t* profileName,
        int modOrderTargetIndex,
        FluxoraCoreProgressCallback progressCallback,
        void* progressUserData,
        wchar_t* jsonBuffer,
        int jsonBufferLength)
    {
        fluxora::ModIdentityInstallSelection selection;
        if (!tryParseIdentityInstallSelection(
                resolutionId,
                identityDecision,
                targetModUuid,
                newNamePolicy,
                selection))
        {
            lastError = L"Install identity selection is invalid.";
            return FluxoraCoreResultInvalidArgument;
        }
        return installArchiveWithMode(
            projectDirectory,
            archivePath,
            modName,
            existingModMode,
            placementOverridesJson,
            &selection,
            jsonBuffer,
            jsonBufferLength,
            profileName,
            modOrderTargetIndex,
            progressCallback,
            progressUserData);
    }

    int fluxora_analyze_download_content_layout(
        const wchar_t* projectDirectory,
        const wchar_t* downloadPath,
        int existingModMode,
        wchar_t* jsonBuffer,
        int jsonBufferLength)
    {
        try
        {
            if (isBlank(projectDirectory) || isBlank(downloadPath))
            {
                lastError = L"Project directory and download path are required.";
                return FluxoraCoreResultInvalidArgument;
            }

            fluxora::ExistingModInstallMode mode = fluxora::ExistingModInstallMode::FailIfExists;
            if (!tryParseExistingModInstallMode(existingModMode, mode))
            {
                lastError = L"Existing mod install mode is invalid.";
                return FluxoraCoreResultInvalidArgument;
            }

            logBridge(fluxora::LogLevel::Info, "fluxora_analyze_download_content_layout started.");
            logOperation(
                fluxora::LogLevel::Info,
                "Downloads",
                std::string("Analyze download content layout requested. projectDirectory=\"") +
                    pathForLog(std::filesystem::path(projectDirectory)) + "\", downloadPath=\"" +
                    pathForLog(std::filesystem::path(downloadPath)) + "\", existingModMode=\"" +
                    existingModInstallModeForLog(mode) + "\"");
            const std::wstring json = serializePlacementPlan(
                core().downloads().analyzeDownloadContentLayout(
                    std::filesystem::path(projectDirectory),
                    std::filesystem::path(downloadPath),
                    mode));
            logOperation(fluxora::LogLevel::Info, "Downloads", "Analyze download content layout completed.");
            return writeToBuffer(json, jsonBuffer, jsonBufferLength);
        }
        catch (const std::exception& exception)
        {
            return mapException(exception);
        }
    }

    int fluxora_analyze_fomod_download(
        const wchar_t* projectDirectory,
        const wchar_t* downloadPath,
        wchar_t* jsonBuffer,
        int jsonBufferLength)
    {
        try
        {
            if (isBlank(projectDirectory) || isBlank(downloadPath))
            {
                lastError = L"Project directory and download path are required.";
                return FluxoraCoreResultInvalidArgument;
            }

            logBridge(fluxora::LogLevel::Info, "fluxora_analyze_fomod_download started.");
            logOperation(
                fluxora::LogLevel::Info,
                "Downloads",
                std::string("Analyze FOMOD download requested. projectDirectory=\"") +
                    pathForLog(std::filesystem::path(projectDirectory)) + "\", downloadPath=\"" +
                    pathForLog(std::filesystem::path(downloadPath)) + "\"");
            const std::wstring json = serializeFomodInstaller(
                core().downloads().analyzeFomodDownload(
                    std::filesystem::path(projectDirectory),
                    std::filesystem::path(downloadPath)));
            logOperation(fluxora::LogLevel::Info, "Downloads", "Analyze FOMOD download completed.");
            return writeToBuffer(json, jsonBuffer, jsonBufferLength);
        }
        catch (const std::exception& exception)
        {
            return mapException(exception);
        }
    }

    int fluxora_analyze_fomod_download_for_profile(
        const wchar_t* projectDirectory,
        const wchar_t* downloadPath,
        const wchar_t* profileName,
        const wchar_t* manualDecisionsJson,
        wchar_t* jsonBuffer,
        int jsonBufferLength)
    {
        try
        {
            if (isBlank(projectDirectory) || isBlank(downloadPath))
            {
                lastError = L"Project directory and download path are required.";
                return FluxoraCoreResultInvalidArgument;
            }
            const std::vector<fluxora::FomodManualDecision> manualDecisions =
                parseFomodManualDecisionsJson(manualDecisionsJson);
            const std::wstring json = serializeFomodInstaller(
                core().downloads().analyzeFomodDownload(
                    std::filesystem::path(projectDirectory),
                    std::filesystem::path(downloadPath),
                    isBlank(profileName) ? std::wstring_view{} : std::wstring_view(profileName),
                    manualDecisions));
            return writeToBuffer(json, jsonBuffer, jsonBufferLength);
        }
        catch (const std::exception& exception)
        {
            return mapException(exception);
        }
    }

    int fluxora_analyze_fomod_download_content_layout(
        const wchar_t* projectDirectory,
        const wchar_t* downloadPath,
        int existingModMode,
        const wchar_t* selectedOptionIdsJson,
        wchar_t* jsonBuffer,
        int jsonBufferLength)
    {
        try
        {
            if (isBlank(projectDirectory) || isBlank(downloadPath))
            {
                lastError = L"Project directory and download path are required.";
                return FluxoraCoreResultInvalidArgument;
            }

            fluxora::ExistingModInstallMode mode = fluxora::ExistingModInstallMode::FailIfExists;
            if (!tryParseExistingModInstallMode(existingModMode, mode))
            {
                lastError = L"Existing mod install mode is invalid.";
                return FluxoraCoreResultInvalidArgument;
            }

            const std::vector<std::wstring> selectedOptionIds = parseStringArrayJson(selectedOptionIdsJson);
            logBridge(fluxora::LogLevel::Info, "fluxora_analyze_fomod_download_content_layout started.");
            logOperation(
                fluxora::LogLevel::Info,
                "Downloads",
                std::string("Analyze FOMOD content layout requested. projectDirectory=\"") +
                    pathForLog(std::filesystem::path(projectDirectory)) + "\", downloadPath=\"" +
                    pathForLog(std::filesystem::path(downloadPath)) + "\", existingModMode=\"" +
                    existingModInstallModeForLog(mode) + "\", selectedOptionCount=" +
                    std::to_string(selectedOptionIds.size()));
            const std::wstring json = serializePlacementPlan(
                core().downloads().analyzeFomodDownloadContentLayout(
                    std::filesystem::path(projectDirectory),
                    std::filesystem::path(downloadPath),
                    mode,
                    selectedOptionIds));
            logOperation(fluxora::LogLevel::Info, "Downloads", "Analyze FOMOD content layout completed.");
            return writeToBuffer(json, jsonBuffer, jsonBufferLength);
        }
        catch (const std::exception& exception)
        {
            return mapException(exception);
        }
    }

    int fluxora_analyze_fomod_download_content_layout_for_profile(
        const wchar_t* projectDirectory,
        const wchar_t* downloadPath,
        int existingModMode,
        const wchar_t* selectedOptionIdsJson,
        const wchar_t* profileName,
        const wchar_t* fomodContextId,
        const wchar_t* manualDecisionsJson,
        wchar_t* jsonBuffer,
        int jsonBufferLength)
    {
        try
        {
            if (isBlank(projectDirectory) || isBlank(downloadPath))
            {
                lastError = L"Project directory and download path are required.";
                return FluxoraCoreResultInvalidArgument;
            }
            fluxora::ExistingModInstallMode mode = fluxora::ExistingModInstallMode::FailIfExists;
            if (!tryParseExistingModInstallMode(existingModMode, mode))
            {
                lastError = L"Existing mod install mode is invalid.";
                return FluxoraCoreResultInvalidArgument;
            }
            const std::wstring json = serializePlacementPlan(
                core().downloads().analyzeFomodDownloadContentLayout(
                    std::filesystem::path(projectDirectory),
                    std::filesystem::path(downloadPath),
                    mode,
                    parseStringArrayJson(selectedOptionIdsJson),
                    isBlank(profileName) ? std::wstring_view{} : std::wstring_view(profileName),
                    isBlank(fomodContextId) ? std::wstring_view{} : std::wstring_view(fomodContextId),
                    parseFomodManualDecisionsJson(manualDecisionsJson)));
            return writeToBuffer(json, jsonBuffer, jsonBufferLength);
        }
        catch (const std::exception& exception)
        {
            return mapException(exception);
        }
    }

    int fluxora_install_fomod_download_with_mode(
        const wchar_t* projectDirectory,
        const wchar_t* downloadPath,
        const wchar_t* modName,
        int existingModMode,
        const wchar_t* selectedOptionIdsJson,
        wchar_t* jsonBuffer,
        int jsonBufferLength)
    {
        try
        {
            if (isBlank(projectDirectory) || isBlank(downloadPath) || isBlank(modName))
            {
                lastError = L"Project directory, download path, and mod name are required.";
                return FluxoraCoreResultInvalidArgument;
            }

            fluxora::ExistingModInstallMode mode = fluxora::ExistingModInstallMode::FailIfExists;
            if (!tryParseExistingModInstallMode(existingModMode, mode))
            {
                lastError = L"Existing mod install mode is invalid.";
                return FluxoraCoreResultInvalidArgument;
            }

            const std::vector<std::wstring> selectedOptionIds = parseStringArrayJson(selectedOptionIdsJson);
            logBridge(fluxora::LogLevel::Info, "fluxora_install_fomod_download started.");
            logOperation(
                fluxora::LogLevel::Info,
                "Downloads",
                std::string("Install FOMOD download requested. projectDirectory=\"") +
                    pathForLog(std::filesystem::path(projectDirectory)) + "\", downloadPath=\"" +
                    pathForLog(std::filesystem::path(downloadPath)) + "\", modName=\"" +
                    textForLog(modName) + "\", existingModMode=\"" +
                    existingModInstallModeForLog(mode) + "\", selectedOptionCount=" +
                    std::to_string(selectedOptionIds.size()));
            const std::wstring json = serializeInstalledMod(
                core().downloads().installFomodDownload(
                    std::filesystem::path(projectDirectory),
                    std::filesystem::path(downloadPath),
                    modName,
                    mode,
                    selectedOptionIds));
            syncSkyrimPluginsForInstalledMods(std::filesystem::path(projectDirectory), "Install FOMOD download", true);
            logOperation(fluxora::LogLevel::Info, "Downloads", "Install FOMOD download completed.");
            return writeToBuffer(json, jsonBuffer, jsonBufferLength);
        }
        catch (const std::exception& exception)
        {
            return mapException(exception);
        }
    }

    int fluxora_install_fomod_archive_with_mode(
        const wchar_t* projectDirectory,
        const wchar_t* archivePath,
        const wchar_t* modName,
        int existingModMode,
        const wchar_t* selectedOptionIdsJson,
        wchar_t* jsonBuffer,
        int jsonBufferLength)
    {
        try
        {
            if (isBlank(projectDirectory) || isBlank(archivePath) || isBlank(modName))
            {
                lastError = L"Project directory, archive path, and mod name are required.";
                return FluxoraCoreResultInvalidArgument;
            }

            fluxora::ExistingModInstallMode mode = fluxora::ExistingModInstallMode::FailIfExists;
            if (!tryParseExistingModInstallMode(existingModMode, mode))
            {
                lastError = L"Existing mod install mode is invalid.";
                return FluxoraCoreResultInvalidArgument;
            }

            const std::vector<std::wstring> selectedOptionIds = parseStringArrayJson(selectedOptionIdsJson);
            logBridge(fluxora::LogLevel::Info, "fluxora_install_fomod_archive started.");
            logOperation(
                fluxora::LogLevel::Info,
                "Mods",
                std::string("Install FOMOD archive requested. projectDirectory=\"") +
                    pathForLog(std::filesystem::path(projectDirectory)) + "\", archivePath=\"" +
                    pathForLog(std::filesystem::path(archivePath)) + "\", modName=\"" +
                    textForLog(modName) + "\", existingModMode=\"" +
                    existingModInstallModeForLog(mode) + "\", selectedOptionCount=" +
                    std::to_string(selectedOptionIds.size()));
            const std::wstring json = serializeInstalledMod(
                core().downloads().installFomodArchive(
                    std::filesystem::path(projectDirectory),
                    std::filesystem::path(archivePath),
                    modName,
                    mode,
                    selectedOptionIds));
            syncSkyrimPluginsForInstalledMods(std::filesystem::path(projectDirectory), "Install FOMOD archive", true);
            logOperation(fluxora::LogLevel::Info, "Mods", "Install FOMOD archive completed.");
            return writeToBuffer(json, jsonBuffer, jsonBufferLength);
        }
        catch (const std::exception& exception)
        {
            return mapException(exception);
        }
    }

    int fluxora_install_fomod_download_with_layout(
        const wchar_t* projectDirectory,
        const wchar_t* downloadPath,
        const wchar_t* modName,
        int existingModMode,
        const wchar_t* selectedOptionIdsJson,
        const wchar_t* placementOverridesJson,
        wchar_t* jsonBuffer,
        int jsonBufferLength)
    {
        try
        {
            if (isBlank(projectDirectory) || isBlank(downloadPath) || isBlank(modName))
            {
                lastError = L"Project directory, download path, and mod name are required.";
                return FluxoraCoreResultInvalidArgument;
            }

            fluxora::ExistingModInstallMode mode = fluxora::ExistingModInstallMode::FailIfExists;
            if (!tryParseExistingModInstallMode(existingModMode, mode))
            {
                lastError = L"Existing mod install mode is invalid.";
                return FluxoraCoreResultInvalidArgument;
            }

            const std::vector<std::wstring> selectedOptionIds = parseStringArrayJson(selectedOptionIdsJson);
            const std::vector<fluxora::PlacementOverride> placementOverrides =
                parsePlacementOverridesJson(placementOverridesJson);
            logBridge(fluxora::LogLevel::Info, "fluxora_install_fomod_download_with_layout started.");
            logOperation(
                fluxora::LogLevel::Info,
                "Downloads",
                std::string("Install FOMOD download requested. projectDirectory=\"") +
                    pathForLog(std::filesystem::path(projectDirectory)) + "\", downloadPath=\"" +
                    pathForLog(std::filesystem::path(downloadPath)) + "\", modName=\"" +
                    textForLog(modName) + "\", existingModMode=\"" +
                    existingModInstallModeForLog(mode) + "\", selectedOptionCount=" +
                    std::to_string(selectedOptionIds.size()) + ", placementOverrideCount=" +
                    std::to_string(placementOverrides.size()));
            const std::wstring json = serializeInstalledMod(
                core().downloads().installFomodDownload(
                    std::filesystem::path(projectDirectory),
                    std::filesystem::path(downloadPath),
                    modName,
                    mode,
                    selectedOptionIds,
                    placementOverrides));
            syncSkyrimPluginsForInstalledMods(std::filesystem::path(projectDirectory), "Install FOMOD download", true);
            logOperation(fluxora::LogLevel::Info, "Downloads", "Install FOMOD download completed.");
            return writeToBuffer(json, jsonBuffer, jsonBufferLength);
        }
        catch (const std::exception& exception)
        {
            return mapException(exception);
        }
    }

    int fluxora_install_fomod_archive_with_layout(
        const wchar_t* projectDirectory,
        const wchar_t* archivePath,
        const wchar_t* modName,
        int existingModMode,
        const wchar_t* selectedOptionIdsJson,
        const wchar_t* placementOverridesJson,
        wchar_t* jsonBuffer,
        int jsonBufferLength)
    {
        try
        {
            if (isBlank(projectDirectory) || isBlank(archivePath) || isBlank(modName))
            {
                lastError = L"Project directory, archive path, and mod name are required.";
                return FluxoraCoreResultInvalidArgument;
            }

            fluxora::ExistingModInstallMode mode = fluxora::ExistingModInstallMode::FailIfExists;
            if (!tryParseExistingModInstallMode(existingModMode, mode))
            {
                lastError = L"Existing mod install mode is invalid.";
                return FluxoraCoreResultInvalidArgument;
            }

            const std::vector<std::wstring> selectedOptionIds = parseStringArrayJson(selectedOptionIdsJson);
            const std::vector<fluxora::PlacementOverride> placementOverrides =
                parsePlacementOverridesJson(placementOverridesJson);
            logBridge(fluxora::LogLevel::Info, "fluxora_install_fomod_archive_with_layout started.");
            logOperation(
                fluxora::LogLevel::Info,
                "Mods",
                std::string("Install FOMOD archive requested. projectDirectory=\"") +
                    pathForLog(std::filesystem::path(projectDirectory)) + "\", archivePath=\"" +
                    pathForLog(std::filesystem::path(archivePath)) + "\", modName=\"" +
                    textForLog(modName) + "\", existingModMode=\"" +
                    existingModInstallModeForLog(mode) + "\", selectedOptionCount=" +
                    std::to_string(selectedOptionIds.size()) + ", placementOverrideCount=" +
                    std::to_string(placementOverrides.size()));
            const std::wstring json = serializeInstalledMod(
                core().downloads().installFomodArchive(
                    std::filesystem::path(projectDirectory),
                    std::filesystem::path(archivePath),
                    modName,
                    mode,
                    selectedOptionIds,
                    placementOverrides));
            syncSkyrimPluginsForInstalledMods(std::filesystem::path(projectDirectory), "Install FOMOD archive", true);
            logOperation(fluxora::LogLevel::Info, "Mods", "Install FOMOD archive completed.");
            return writeToBuffer(json, jsonBuffer, jsonBufferLength);
        }
        catch (const std::exception& exception)
        {
            return mapException(exception);
        }
    }

    int fluxora_install_fomod_download_planned(
        const wchar_t* projectDirectory,
        const wchar_t* downloadPath,
        const wchar_t* modName,
        int existingModMode,
        const wchar_t* selectedOptionIdsJson,
        const wchar_t* placementOverridesJson,
        const wchar_t* resolutionId,
        int identityDecision,
        const wchar_t* targetModUuid,
        int newNamePolicy,
        wchar_t* jsonBuffer,
        int jsonBufferLength)
    {
        try
        {
            if (isBlank(projectDirectory) || isBlank(downloadPath) || isBlank(modName))
            {
                lastError = L"Project directory, download path, and mod name are required.";
                return FluxoraCoreResultInvalidArgument;
            }
            fluxora::ExistingModInstallMode mode = fluxora::ExistingModInstallMode::FailIfExists;
            fluxora::ModIdentityInstallSelection selection;
            if (!tryParseExistingModInstallMode(existingModMode, mode) ||
                !tryParseIdentityInstallSelection(
                    resolutionId,
                    identityDecision,
                    targetModUuid,
                    newNamePolicy,
                    selection))
            {
                lastError = L"Install mode or identity selection is invalid.";
                return FluxoraCoreResultInvalidArgument;
            }
            const std::vector<std::wstring> selectedOptionIds =
                parseStringArrayJson(selectedOptionIdsJson);
            const std::vector<fluxora::PlacementOverride> placementOverrides =
                parsePlacementOverridesJson(placementOverridesJson);
            const std::wstring json = serializeInstalledMod(
                core().downloads().installFomodDownload(
                    std::filesystem::path(projectDirectory),
                    std::filesystem::path(downloadPath),
                    modName,
                    mode,
                    selectedOptionIds,
                    placementOverrides,
                    &selection));
            syncSkyrimPluginsForInstalledMods(
                std::filesystem::path(projectDirectory),
                "Install planned FOMOD download",
                true);
            return writeToBuffer(json, jsonBuffer, jsonBufferLength);
        }
        catch (const std::exception& exception)
        {
            return mapException(exception);
        }
    }

    int fluxora_install_fomod_archive_planned(
        const wchar_t* projectDirectory,
        const wchar_t* archivePath,
        const wchar_t* modName,
        int existingModMode,
        const wchar_t* selectedOptionIdsJson,
        const wchar_t* placementOverridesJson,
        const wchar_t* resolutionId,
        int identityDecision,
        const wchar_t* targetModUuid,
        int newNamePolicy,
        wchar_t* jsonBuffer,
        int jsonBufferLength)
    {
        try
        {
            if (isBlank(projectDirectory) || isBlank(archivePath) || isBlank(modName))
            {
                lastError = L"Project directory, archive path, and mod name are required.";
                return FluxoraCoreResultInvalidArgument;
            }
            fluxora::ExistingModInstallMode mode = fluxora::ExistingModInstallMode::FailIfExists;
            fluxora::ModIdentityInstallSelection selection;
            if (!tryParseExistingModInstallMode(existingModMode, mode) ||
                !tryParseIdentityInstallSelection(
                    resolutionId,
                    identityDecision,
                    targetModUuid,
                    newNamePolicy,
                    selection))
            {
                lastError = L"Install mode or identity selection is invalid.";
                return FluxoraCoreResultInvalidArgument;
            }
            const std::vector<std::wstring> selectedOptionIds =
                parseStringArrayJson(selectedOptionIdsJson);
            const std::vector<fluxora::PlacementOverride> placementOverrides =
                parsePlacementOverridesJson(placementOverridesJson);
            const std::wstring json = serializeInstalledMod(
                core().downloads().installFomodArchive(
                    std::filesystem::path(projectDirectory),
                    std::filesystem::path(archivePath),
                    modName,
                    mode,
                    selectedOptionIds,
                    placementOverrides,
                    &selection));
            syncSkyrimPluginsForInstalledMods(
                std::filesystem::path(projectDirectory),
                "Install planned FOMOD archive",
                true);
            return writeToBuffer(json, jsonBuffer, jsonBufferLength);
        }
        catch (const std::exception& exception)
        {
            return mapException(exception);
        }
    }

    int fluxora_install_fomod_download_with_layout_for_profile(
        const wchar_t* projectDirectory,
        const wchar_t* downloadPath,
        const wchar_t* modName,
        int existingModMode,
        const wchar_t* selectedOptionIdsJson,
        const wchar_t* placementOverridesJson,
        const wchar_t* profileName,
        const wchar_t* fomodContextId,
        const wchar_t* manualDecisionsJson,
        wchar_t* jsonBuffer,
        int jsonBufferLength)
    {
        try
        {
            if (isBlank(projectDirectory) || isBlank(downloadPath) || isBlank(modName))
            {
                lastError = L"Project directory, download path, and mod name are required.";
                return FluxoraCoreResultInvalidArgument;
            }
            fluxora::ExistingModInstallMode mode = fluxora::ExistingModInstallMode::FailIfExists;
            if (!tryParseExistingModInstallMode(existingModMode, mode))
            {
                lastError = L"Existing mod install mode is invalid.";
                return FluxoraCoreResultInvalidArgument;
            }
            const std::wstring json = serializeInstalledMod(
                core().downloads().installFomodDownload(
                    std::filesystem::path(projectDirectory),
                    std::filesystem::path(downloadPath),
                    modName,
                    mode,
                    parseStringArrayJson(selectedOptionIdsJson),
                    parsePlacementOverridesJson(placementOverridesJson),
                    nullptr,
                    isBlank(profileName) ? std::wstring_view{} : std::wstring_view(profileName),
                    isBlank(fomodContextId) ? std::wstring_view{} : std::wstring_view(fomodContextId),
                    parseFomodManualDecisionsJson(manualDecisionsJson)));
            syncSkyrimPluginsForInstalledMods(
                std::filesystem::path(projectDirectory),
                "Install profile-aware FOMOD download",
                true);
            return writeToBuffer(json, jsonBuffer, jsonBufferLength);
        }
        catch (const std::exception& exception)
        {
            return mapException(exception);
        }
    }

    int fluxora_install_fomod_archive_with_layout_for_profile(
        const wchar_t* projectDirectory,
        const wchar_t* archivePath,
        const wchar_t* modName,
        int existingModMode,
        const wchar_t* selectedOptionIdsJson,
        const wchar_t* placementOverridesJson,
        const wchar_t* profileName,
        const wchar_t* fomodContextId,
        const wchar_t* manualDecisionsJson,
        wchar_t* jsonBuffer,
        int jsonBufferLength)
    {
        try
        {
            if (isBlank(projectDirectory) || isBlank(archivePath) || isBlank(modName))
            {
                lastError = L"Project directory, archive path, and mod name are required.";
                return FluxoraCoreResultInvalidArgument;
            }
            fluxora::ExistingModInstallMode mode = fluxora::ExistingModInstallMode::FailIfExists;
            if (!tryParseExistingModInstallMode(existingModMode, mode))
            {
                lastError = L"Existing mod install mode is invalid.";
                return FluxoraCoreResultInvalidArgument;
            }
            const std::wstring json = serializeInstalledMod(
                core().downloads().installFomodArchive(
                    std::filesystem::path(projectDirectory),
                    std::filesystem::path(archivePath),
                    modName,
                    mode,
                    parseStringArrayJson(selectedOptionIdsJson),
                    parsePlacementOverridesJson(placementOverridesJson),
                    nullptr,
                    isBlank(profileName) ? std::wstring_view{} : std::wstring_view(profileName),
                    isBlank(fomodContextId) ? std::wstring_view{} : std::wstring_view(fomodContextId),
                    parseFomodManualDecisionsJson(manualDecisionsJson)));
            syncSkyrimPluginsForInstalledMods(
                std::filesystem::path(projectDirectory),
                "Install profile-aware FOMOD archive",
                true);
            return writeToBuffer(json, jsonBuffer, jsonBufferLength);
        }
        catch (const std::exception& exception)
        {
            return mapException(exception);
        }
    }

    int fluxora_install_fomod_download_planned_for_profile(
        const wchar_t* projectDirectory,
        const wchar_t* downloadPath,
        const wchar_t* modName,
        int existingModMode,
        const wchar_t* selectedOptionIdsJson,
        const wchar_t* placementOverridesJson,
        const wchar_t* resolutionId,
        int identityDecision,
        const wchar_t* targetModUuid,
        int newNamePolicy,
        const wchar_t* profileName,
        const wchar_t* fomodContextId,
        const wchar_t* manualDecisionsJson,
        wchar_t* jsonBuffer,
        int jsonBufferLength)
    {
        try
        {
            if (isBlank(projectDirectory) || isBlank(downloadPath) || isBlank(modName))
            {
                lastError = L"Project directory, download path, and mod name are required.";
                return FluxoraCoreResultInvalidArgument;
            }
            fluxora::ExistingModInstallMode mode = fluxora::ExistingModInstallMode::FailIfExists;
            fluxora::ModIdentityInstallSelection selection;
            if (!tryParseExistingModInstallMode(existingModMode, mode) ||
                !tryParseIdentityInstallSelection(
                    resolutionId,
                    identityDecision,
                    targetModUuid,
                    newNamePolicy,
                    selection))
            {
                lastError = L"Install mode or identity selection is invalid.";
                return FluxoraCoreResultInvalidArgument;
            }
            const std::wstring json = serializeInstalledMod(
                core().downloads().installFomodDownload(
                    std::filesystem::path(projectDirectory),
                    std::filesystem::path(downloadPath),
                    modName,
                    mode,
                    parseStringArrayJson(selectedOptionIdsJson),
                    parsePlacementOverridesJson(placementOverridesJson),
                    &selection,
                    isBlank(profileName) ? std::wstring_view{} : std::wstring_view(profileName),
                    isBlank(fomodContextId) ? std::wstring_view{} : std::wstring_view(fomodContextId),
                    parseFomodManualDecisionsJson(manualDecisionsJson)));
            syncSkyrimPluginsForInstalledMods(
                std::filesystem::path(projectDirectory),
                "Install planned profile-aware FOMOD download",
                true);
            return writeToBuffer(json, jsonBuffer, jsonBufferLength);
        }
        catch (const std::exception& exception)
        {
            return mapException(exception);
        }
    }

    int fluxora_install_fomod_archive_planned_for_profile(
        const wchar_t* projectDirectory,
        const wchar_t* archivePath,
        const wchar_t* modName,
        int existingModMode,
        const wchar_t* selectedOptionIdsJson,
        const wchar_t* placementOverridesJson,
        const wchar_t* resolutionId,
        int identityDecision,
        const wchar_t* targetModUuid,
        int newNamePolicy,
        const wchar_t* profileName,
        const wchar_t* fomodContextId,
        const wchar_t* manualDecisionsJson,
        wchar_t* jsonBuffer,
        int jsonBufferLength)
    {
        try
        {
            if (isBlank(projectDirectory) || isBlank(archivePath) || isBlank(modName))
            {
                lastError = L"Project directory, archive path, and mod name are required.";
                return FluxoraCoreResultInvalidArgument;
            }
            fluxora::ExistingModInstallMode mode = fluxora::ExistingModInstallMode::FailIfExists;
            fluxora::ModIdentityInstallSelection selection;
            if (!tryParseExistingModInstallMode(existingModMode, mode) ||
                !tryParseIdentityInstallSelection(
                    resolutionId,
                    identityDecision,
                    targetModUuid,
                    newNamePolicy,
                    selection))
            {
                lastError = L"Install mode or identity selection is invalid.";
                return FluxoraCoreResultInvalidArgument;
            }
            const std::wstring json = serializeInstalledMod(
                core().downloads().installFomodArchive(
                    std::filesystem::path(projectDirectory),
                    std::filesystem::path(archivePath),
                    modName,
                    mode,
                    parseStringArrayJson(selectedOptionIdsJson),
                    parsePlacementOverridesJson(placementOverridesJson),
                    &selection,
                    isBlank(profileName) ? std::wstring_view{} : std::wstring_view(profileName),
                    isBlank(fomodContextId) ? std::wstring_view{} : std::wstring_view(fomodContextId),
                    parseFomodManualDecisionsJson(manualDecisionsJson)));
            syncSkyrimPluginsForInstalledMods(
                std::filesystem::path(projectDirectory),
                "Install planned profile-aware FOMOD archive",
                true);
            return writeToBuffer(json, jsonBuffer, jsonBufferLength);
        }
        catch (const std::exception& exception)
        {
            return mapException(exception);
        }
    }

    int fluxora_install_fomod_download_planned_for_profile_with_progress(
        const wchar_t* projectDirectory,
        const wchar_t* downloadPath,
        const wchar_t* modName,
        int existingModMode,
        const wchar_t* selectedOptionIdsJson,
        const wchar_t* placementOverridesJson,
        const wchar_t* resolutionId,
        int identityDecision,
        const wchar_t* targetModUuid,
        int newNamePolicy,
        const wchar_t* profileName,
        const wchar_t* fomodContextId,
        const wchar_t* manualDecisionsJson,
        int modOrderTargetIndex,
        FluxoraCoreProgressCallback progressCallback,
        void* progressUserData,
        wchar_t* jsonBuffer,
        int jsonBufferLength)
    {
        try
        {
            if (isBlank(projectDirectory) || isBlank(downloadPath) || isBlank(modName))
            {
                lastError = L"Project directory, download path, and mod name are required.";
                return FluxoraCoreResultInvalidArgument;
            }
            fluxora::ExistingModInstallMode mode = fluxora::ExistingModInstallMode::FailIfExists;
            fluxora::ModIdentityInstallSelection selection;
            if (!tryParseExistingModInstallMode(existingModMode, mode) ||
                !tryParseIdentityInstallSelection(
                    resolutionId,
                    identityDecision,
                    targetModUuid,
                    newNamePolicy,
                    selection))
            {
                lastError = L"Install mode or identity selection is invalid.";
                return FluxoraCoreResultInvalidArgument;
            }
            const std::wstring json = serializeInstalledMod(
                core().downloads().installFomodDownload(
                    std::filesystem::path(projectDirectory),
                    std::filesystem::path(downloadPath),
                    modName,
                    mode,
                    parseStringArrayJson(selectedOptionIdsJson),
                    parsePlacementOverridesJson(placementOverridesJson),
                    &selection,
                    isBlank(profileName) ? std::wstring_view{} : std::wstring_view(profileName),
                    isBlank(fomodContextId) ? std::wstring_view{} : std::wstring_view(fomodContextId),
                    parseFomodManualDecisionsJson(manualDecisionsJson),
                    modOrderTargetIndex,
                    installConflictProgressCallback(progressCallback, progressUserData)));
            syncSkyrimPluginsForInstalledMods(
                std::filesystem::path(projectDirectory),
                "Install planned profile-aware FOMOD download",
                true);
            return writeToBuffer(json, jsonBuffer, jsonBufferLength);
        }
        catch (const std::exception& exception)
        {
            return mapException(exception);
        }
    }

    int fluxora_install_fomod_archive_planned_for_profile_with_progress(
        const wchar_t* projectDirectory,
        const wchar_t* archivePath,
        const wchar_t* modName,
        int existingModMode,
        const wchar_t* selectedOptionIdsJson,
        const wchar_t* placementOverridesJson,
        const wchar_t* resolutionId,
        int identityDecision,
        const wchar_t* targetModUuid,
        int newNamePolicy,
        const wchar_t* profileName,
        const wchar_t* fomodContextId,
        const wchar_t* manualDecisionsJson,
        int modOrderTargetIndex,
        FluxoraCoreProgressCallback progressCallback,
        void* progressUserData,
        wchar_t* jsonBuffer,
        int jsonBufferLength)
    {
        try
        {
            if (isBlank(projectDirectory) || isBlank(archivePath) || isBlank(modName))
            {
                lastError = L"Project directory, archive path, and mod name are required.";
                return FluxoraCoreResultInvalidArgument;
            }
            fluxora::ExistingModInstallMode mode = fluxora::ExistingModInstallMode::FailIfExists;
            fluxora::ModIdentityInstallSelection selection;
            if (!tryParseExistingModInstallMode(existingModMode, mode) ||
                !tryParseIdentityInstallSelection(
                    resolutionId,
                    identityDecision,
                    targetModUuid,
                    newNamePolicy,
                    selection))
            {
                lastError = L"Install mode or identity selection is invalid.";
                return FluxoraCoreResultInvalidArgument;
            }
            const std::wstring json = serializeInstalledMod(
                core().downloads().installFomodArchive(
                    std::filesystem::path(projectDirectory),
                    std::filesystem::path(archivePath),
                    modName,
                    mode,
                    parseStringArrayJson(selectedOptionIdsJson),
                    parsePlacementOverridesJson(placementOverridesJson),
                    &selection,
                    isBlank(profileName) ? std::wstring_view{} : std::wstring_view(profileName),
                    isBlank(fomodContextId) ? std::wstring_view{} : std::wstring_view(fomodContextId),
                    parseFomodManualDecisionsJson(manualDecisionsJson),
                    modOrderTargetIndex,
                    installConflictProgressCallback(progressCallback, progressUserData)));
            syncSkyrimPluginsForInstalledMods(
                std::filesystem::path(projectDirectory),
                "Install planned profile-aware FOMOD archive",
                true);
            return writeToBuffer(json, jsonBuffer, jsonBufferLength);
        }
        catch (const std::exception& exception)
        {
            return mapException(exception);
        }
    }

    int fluxora_rebase_pending_install(
        const wchar_t* projectDirectory,
        const wchar_t* operationId,
        int targetIndex,
        wchar_t* jsonBuffer,
        int jsonBufferLength)
    {
        return fluxora_rebase_pending_install_with_anchors(
            projectDirectory,
            operationId,
            nullptr,
            nullptr,
            targetIndex,
            jsonBuffer,
            jsonBufferLength);
    }

    int fluxora_rebase_pending_install_with_anchors(
        const wchar_t* projectDirectory,
        const wchar_t* operationId,
        const wchar_t* beforeOrderId,
        const wchar_t* afterOrderId,
        int fallbackTargetIndex,
        wchar_t* jsonBuffer,
        int jsonBufferLength)
    {
        try
        {
            if (isBlank(projectDirectory) || isBlank(operationId))
            {
                lastError = L"Project directory and operation id are required.";
                return FluxoraCoreResultInvalidArgument;
            }
            fluxora::InstallProjectGate projectGate(projectDirectory);
            return writeToBuffer(
                serializeInstallConflictSnapshot(
                    fluxora::InstallConflictPreviewService::rebase(
                        std::filesystem::path(projectDirectory),
                        operationId,
                        isBlank(beforeOrderId) ? std::wstring_view{} : std::wstring_view(beforeOrderId),
                        isBlank(afterOrderId) ? std::wstring_view{} : std::wstring_view(afterOrderId),
                        fallbackTargetIndex)),
                jsonBuffer,
                jsonBufferLength);
        }
        catch (const std::exception& exception)
        {
            return mapException(exception);
        }
    }

    int fluxora_get_last_error(wchar_t* messageBuffer, int messageBufferLength)
    {
        return writeToBuffer(lastError, messageBuffer, messageBufferLength);
    }
}
