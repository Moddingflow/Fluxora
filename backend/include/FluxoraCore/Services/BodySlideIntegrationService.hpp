#pragma once

#include "FluxoraCore/Services/ExecutableService.hpp"
#include "FluxoraCore/Services/IService.hpp"
#include "FluxoraCore/Services/VfsMountPlan.hpp"

#include <filesystem>
#include <mutex>
#include <optional>
#include <stdexcept>
#include <string>
#include <string_view>
#include <unordered_map>
#include <vector>

namespace fluxora
{
    class BuildPathSettingsService;
    class Logger;

    inline constexpr std::wstring_view bodySlideManagedToolKind = L"bodySlide";
    inline constexpr std::wstring_view bodySlideGeneratedProvider = L"generated-bodyslide";

    class BodySlideIntegrationError final : public std::runtime_error
    {
    public:
        BodySlideIntegrationError(std::wstring code, std::string message);

        [[nodiscard]] const std::wstring& code() const noexcept;

    private:
        std::wstring code_;
    };

    struct BodySlideLaunchPreparation
    {
        std::wstring sessionId;
        ManagedOutputMod outputMod;
        std::filesystem::path configOverlayDirectory;
        std::filesystem::path virtualProjectPath;
        std::filesystem::path projectRelativeDirectory;
        std::vector<ExecutableLaunchMod> activeProfileMods;
        std::wstring configurationStatus;
        std::vector<std::wstring> warnings;
    };

    struct ManagedLaunchCompletion
    {
        std::wstring sessionId;
        std::wstring outcome;
        ManagedOutputMod outputMod;
        bool finalized{false};
        bool deferred{false};
        std::vector<std::wstring> warnings;
    };

    class BodySlideIntegrationService final : public IService
    {
    public:
        BodySlideIntegrationService(
            Logger& logger,
            const BuildPathSettingsService& pathSettings) noexcept;

        void initialize() override;
        void shutdown() override;

        [[nodiscard]] static std::wstring detectManagedToolKind(
            const GameExecutable& executable,
            const std::filesystem::path& resolvedExecutablePath);

        // Project rename hooks are no-ops until a managed output exists.
        // Preflight prevents a user-owned target from being overwritten before
        // ProjectService moves either the manifest or project directory.
        void preflightProjectRename(
            const std::filesystem::path& projectDirectory,
            std::wstring_view newProjectName) const;
        void completeProjectRename(
            const std::filesystem::path& projectDirectory,
            std::wstring_view newProjectName) const;

        [[nodiscard]] BodySlideLaunchPreparation prepareLaunch(
            const std::filesystem::path& configPath,
            const ResolvedExecutableLaunch& resolved,
            std::wstring_view profileName) const;

        void applyVfsPolicy(
            std::vector<VfsMountDescriptor>& mounts,
            const ResolvedExecutableLaunch& resolved,
            const BodySlideLaunchPreparation& preparation) const;

        void bindProcess(std::wstring_view sessionId, std::uint32_t processId) const;
        void abandonLaunch(std::wstring_view sessionId) const noexcept;

        [[nodiscard]] ManagedLaunchCompletion completeManagedLaunch(
            std::wstring_view sessionId,
            std::wstring_view outcome) const;

        [[nodiscard]] bool isInitialized() const noexcept;

    private:
        Logger& logger_;
        const BuildPathSettingsService& pathSettings_;
        mutable std::mutex sessionRegistryMutex_;
        mutable std::unordered_map<std::wstring, std::filesystem::path> sessionRegistry_;
        bool initialized_{false};
    };
}
