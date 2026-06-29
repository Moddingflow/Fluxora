#pragma once

#include "FluxoraCore/Services/ExecutableService.hpp"
#include "FluxoraCore/Services/IService.hpp"

#include <cstdint>
#include <filesystem>
#include <functional>
#include <memory>
#include <string>
#include <string_view>
#include <vector>

namespace fluxora
{
    class BuildPathSettingsService;
    class ExecutableService;
    class Logger;
    class ModService;
    class ProfileOrderService;
    class ProjectService;
    class VirtualFileSystemService;

    struct GrassCacheGenerationOptions
    {
        int maxLaunchCount{256};
        int restartDelayMs{8000};
    };

    struct GrassCacheGenerationProgress
    {
        std::wstring phase;
        std::wstring currentStep;
        std::wstring currentItem;
        int overallPercent{0};
        int launchCount{0};
    };

    struct GrassCacheGenerationResult
    {
        bool accepted{true};
        std::wstring outputModName;
        std::filesystem::path outputModPath;
        int launchCount{0};
        int generatedFileCount{0};
        int failedFileCount{0};
    };

    struct GrassCacheLaunchSpec
    {
        std::filesystem::path configPath;
        std::wstring executableId;
        std::wstring profileName;
        std::wstring additionalArguments;
    };

    class IGrassCacheProcessRunner
    {
    public:
        virtual ~IGrassCacheProcessRunner() = default;
        virtual void launchAndWait(const GrassCacheLaunchSpec& spec) = 0;
    };

    class GrassCacheService final : public IService
    {
    public:
        using ProgressCallback = std::function<void(const GrassCacheGenerationProgress&)>;

        GrassCacheService(
            Logger& logger,
            ProjectService& projects,
            ExecutableService& executables,
            VirtualFileSystemService& virtualFileSystem,
            ModService& mods,
            ProfileOrderService& profileOrder,
            const BuildPathSettingsService& pathSettings);

        GrassCacheService(
            Logger& logger,
            ProjectService& projects,
            ExecutableService& executables,
            ModService& mods,
            ProfileOrderService& profileOrder,
            const BuildPathSettingsService& pathSettings,
            IGrassCacheProcessRunner& runner) noexcept;

        void initialize() override;
        void shutdown() override;

        [[nodiscard]] GrassCacheGenerationResult generateNgioGrassCache(
            const std::filesystem::path& configPath,
            std::wstring_view profileName,
            const GrassCacheGenerationOptions& options = {},
            const ProgressCallback& progress = {}) const;

        [[nodiscard]] bool isInitialized() const noexcept;

    private:
        Logger& logger_;
        ProjectService& projects_;
        ExecutableService& executables_;
        ModService& mods_;
        ProfileOrderService& profileOrder_;
        const BuildPathSettingsService& pathSettings_;
        std::unique_ptr<IGrassCacheProcessRunner> ownedRunner_;
        IGrassCacheProcessRunner& runner_;
        bool initialized_{false};
    };
}
