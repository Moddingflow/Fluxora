#pragma once

#include <filesystem>
#include <string>
#include <string_view>

namespace fluxora
{
    class BuildPathSettingsService;
    class Logger;

    struct ManagedAiOverridePlan
    {
        std::filesystem::path modsRoot;
        std::filesystem::path modRoot;
        std::filesystem::path targetPath;
        std::wstring relativePath;
        std::wstring virtualPath;
        bool modExisted{false};
        bool targetExisted{false};
    };

    class ManagedAiOverrideService final
    {
    public:
        ManagedAiOverrideService(
            Logger& logger,
            const BuildPathSettingsService& pathSettings) noexcept;

        [[nodiscard]] ManagedAiOverridePlan plan(
            const std::filesystem::path& projectDirectory,
            std::wstring_view profileName,
            const std::filesystem::path& sourceRoot,
            const std::filesystem::path& sourcePath) const;

        [[nodiscard]] bool activate(
            const std::filesystem::path& projectDirectory,
            std::wstring_view profileName,
            const ManagedAiOverridePlan& plan,
            std::wstring_view operationId) const;

        void cleanupAfterRollback(
            const std::filesystem::path& projectDirectory,
            const ManagedAiOverridePlan& plan,
            bool removeManagedMod,
            std::wstring_view operationId) const noexcept;

        static constexpr std::wstring_view modName() noexcept
        {
            return L"Fluxora AI Overrides";
        }

    private:
        Logger& logger_;
        const BuildPathSettingsService& pathSettings_;
    };
}
