#pragma once

#include "FluxoraCore/Services/FomodInstallerService.hpp"

#include <filesystem>
#include <functional>
#include <optional>
#include <stdexcept>
#include <string>
#include <string_view>
#include <vector>

namespace fluxora
{
    class Logger;

    enum class ModIdentityResolutionKind
    {
        None,
        Exact,
        Probable
    };

    struct ModIdentitySource
    {
        std::wstring provider;
        std::wstring game;
        std::wstring remoteModId;
        std::wstring remoteFileId;
    };

    struct ModIdentityTarget
    {
        std::wstring modUuid;
        std::wstring displayName;
        std::wstring folderName;
    };

    struct ModIdentityContentAnchors
    {
        std::vector<std::wstring> pluginFiles;
        std::vector<std::wstring> archiveFiles;
        std::vector<std::wstring> scriptExtenderDlls;
    };

    struct ModIdentityInput
    {
        std::wstring displayName;
        std::wstring folderName;
        std::wstring fomodModuleId;
        ModIdentitySource source;
        ModIdentityContentAnchors content;
    };

    struct ModIdentityCandidate
    {
        ModIdentityTarget target;
        ModIdentitySource source;
        std::wstring fomodModuleId;
        std::vector<std::wstring> aliases;
        ModIdentityContentAnchors content;
        bool excluded{false};
    };

    struct ModIdentityResolution
    {
        ModIdentityResolutionKind kind{ModIdentityResolutionKind::None};
        std::wstring suggestedModName;
        std::optional<ModIdentityTarget> matchedTarget;
        int score{0};
        std::vector<std::wstring> evidenceCodes;
    };

    struct FluxoraInstallPlan
    {
        std::wstring suggestedModName;
        ModIdentityResolutionKind resolutionKind{ModIdentityResolutionKind::None};
        std::optional<ModIdentityTarget> matchedTarget;
        std::wstring resolutionId;
        FomodInstallerDescriptor fomodInstaller;
        std::vector<std::wstring> evidenceCodes;
        int score{0};
    };

    enum class InstallIdentityDecision
    {
        UseMatch,
        InstallNew
    };

    enum class NewNamePolicy
    {
        FirstFreeCopySuffix
    };

    struct ModIdentityPlanRequest
    {
        std::filesystem::path projectDirectory;
        std::filesystem::path archivePath;
        std::wstring archiveFingerprint;
        ModIdentityInput input;
        FomodInstallerDescriptor fomodInstaller;
        std::function<ModIdentityContentAnchors()> loadIncomingContent;
    };

    struct ModIdentityInstallSelection
    {
        std::wstring resolutionId;
        InstallIdentityDecision decision{InstallIdentityDecision::InstallNew};
        std::wstring targetModUuid;
        NewNamePolicy newNamePolicy{NewNamePolicy::FirstFreeCopySuffix};
    };

    struct ValidatedModIdentityInstall
    {
        InstallIdentityDecision decision{InstallIdentityDecision::InstallNew};
        std::optional<ModIdentityTarget> matchedTarget;
        std::optional<ModIdentityTarget> rejectedTarget;
        ModIdentitySource incomingSource;
        std::wstring incomingName;
        std::wstring fomodModuleId;
        std::wstring resolutionId;
    };

    class InstallIdentityPlanStaleError final : public std::runtime_error
    {
    public:
        InstallIdentityPlanStaleError();
    };

    class ModIdentityResolver final
    {
    public:
        ModIdentityResolver() = delete;

        [[nodiscard]] static std::wstring canonicalSuggestedName(std::wstring_view value);

        [[nodiscard]] static std::wstring normalizedName(std::wstring_view value);

        [[nodiscard]] static std::vector<std::wstring> meaningfulTokens(std::wstring_view value);

        [[nodiscard]] static ModIdentityResolution resolve(
            const ModIdentityInput& input,
            const std::vector<ModIdentityCandidate>& candidates);

        [[nodiscard]] static FluxoraInstallPlan createInstallPlan(
            ModIdentityPlanRequest request,
            Logger* logger = nullptr);

        [[nodiscard]] static ValidatedModIdentityInstall validateInstallPlan(
            const std::filesystem::path& projectDirectory,
            std::wstring_view archiveFingerprint,
            const ModIdentityInstallSelection& selection);

        [[nodiscard]] static ModIdentityContentAnchors collectContentAnchors(
            const std::filesystem::path& rootDirectory);
    };
}
