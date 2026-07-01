#pragma once

#include "FluxoraCore/Services/IService.hpp"

#include <filesystem>
#include <string>
#include <string_view>
#include <vector>

namespace fluxora
{
    class BuildPathSettingsService;
    class Logger;

    struct ProfileTextFilePreview
    {
        std::filesystem::path path;
        std::wstring relativePath;
        std::wstring fileName;
        std::wstring contentPreview;
        std::uintmax_t bytesRead{0};
        std::uintmax_t size{0};
        bool truncated{false};
    };

    class ProfileService final : public IService
    {
    public:
        ProfileService(
            Logger& logger,
            const BuildPathSettingsService& pathSettings) noexcept;

        void initialize() override;
        void shutdown() override;

        [[nodiscard]] std::vector<std::wstring> listProfiles(
            const std::filesystem::path& projectDirectory,
            std::wstring_view defaultProfileName) const;

        [[nodiscard]] ProfileTextFilePreview previewProfileTextFile(
            const std::filesystem::path& projectDirectory,
            std::wstring_view profileName,
            std::wstring_view fileName,
            std::uintmax_t maxBytes) const;

        [[nodiscard]] std::vector<std::wstring> createProfile(
            const std::filesystem::path& projectDirectory,
            std::wstring_view profileName,
            std::wstring_view defaultProfileName,
            const std::vector<std::wstring>& profileFiles) const;

        [[nodiscard]] std::vector<std::wstring> cloneProfile(
            const std::filesystem::path& projectDirectory,
            std::wstring_view sourceProfileName,
            std::wstring_view targetProfileName,
            std::wstring_view defaultProfileName) const;

        [[nodiscard]] std::vector<std::wstring> renameProfile(
            const std::filesystem::path& projectDirectory,
            std::wstring_view sourceProfileName,
            std::wstring_view targetProfileName,
            std::wstring_view defaultProfileName) const;

        [[nodiscard]] std::vector<std::wstring> deleteProfile(
            const std::filesystem::path& projectDirectory,
            std::wstring_view profileName,
            std::wstring_view defaultProfileName) const;

        [[nodiscard]] bool isInitialized() const noexcept;

    private:
        Logger& logger_;
        const BuildPathSettingsService& pathSettings_;
        bool initialized_{false};
    };
}
