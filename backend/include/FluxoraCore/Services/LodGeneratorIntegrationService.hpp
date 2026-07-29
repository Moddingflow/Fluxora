#pragma once

#include "FluxoraCore/Services/ExecutableService.hpp"
#include "FluxoraCore/Services/IService.hpp"
#include "FluxoraCore/Services/VfsMountPlan.hpp"

#include <cstdint>
#include <filesystem>
#include <mutex>
#include <stdexcept>
#include <string>
#include <string_view>
#include <unordered_map>
#include <vector>

namespace fluxora
{
    inline constexpr std::wstring_view texGenManagedToolKind = L"texGen";
    inline constexpr std::wstring_view dynDoLodManagedToolKind = L"dynDoLod";
    inline constexpr std::wstring_view texGenGeneratedProvider = L"generated-texgen";
    inline constexpr std::wstring_view dynDoLodGeneratedProvider = L"generated-dyndolod";

    class BuildPathSettingsService;
    class Logger;

    class LodGeneratorIntegrationError final : public std::runtime_error
    {
    public:
        LodGeneratorIntegrationError(std::wstring code, std::string message);

        [[nodiscard]] const std::wstring& code() const noexcept;

    private:
        std::wstring code_;
    };

    struct LodGeneratorLaunchPreparation
    {
        std::wstring sessionId;
        std::wstring managedToolKind;
        ManagedOutputMod outputMod;
        std::filesystem::path stagingDirectory;
        std::filesystem::path virtualOutputDirectory;
        std::vector<ExecutableLaunchMod> activeProfileMods;
        std::wstring commandLine;
        std::wstring configurationStatus;
        std::vector<std::wstring> warnings;
    };

    class LodGeneratorIntegrationService final : public IService
    {
    public:
        LodGeneratorIntegrationService(
            Logger& logger,
            const BuildPathSettingsService& pathSettings) noexcept;

        void initialize() override;
        void shutdown() override;

        [[nodiscard]] static std::wstring detectManagedToolKind(
            const GameExecutable& executable,
            const std::filesystem::path& resolvedExecutablePath);

        [[nodiscard]] LodGeneratorLaunchPreparation prepareLaunch(
            const std::filesystem::path& configPath,
            const ResolvedExecutableLaunch& resolved,
            std::wstring_view profileName) const;

        void applyVfsPolicy(
            std::vector<VfsMountDescriptor>& mounts,
            const LodGeneratorLaunchPreparation& preparation) const;

        void bindProcess(std::wstring_view sessionId, std::uint32_t processId) const;
        void abandonLaunch(std::wstring_view sessionId) const noexcept;

        [[nodiscard]] ManagedLaunchCompletion completeManagedLaunch(
            std::wstring_view sessionId,
            std::wstring_view outcome) const;

        [[nodiscard]] bool ownsSession(std::wstring_view sessionId) const noexcept;
        [[nodiscard]] bool isInitialized() const noexcept;

    private:
        Logger& logger_;
        const BuildPathSettingsService& pathSettings_;
        mutable std::mutex sessionRegistryMutex_;
        mutable std::unordered_map<std::wstring, std::filesystem::path> sessionRegistry_;
        bool initialized_{false};
    };
}
