#pragma once

#include <filesystem>
#include <functional>
#include <string>

namespace fluxora
{
    class BuildPathSettingsService;
    class Logger;

    struct ArchiveCatalogEntry
    {
        std::filesystem::path path;
        std::wstring sha256;
        std::wstring archiveId;
        bool createdNewFile{false};
    };

    enum class ArchiveCatalogLookupState
    {
        Ready,
        Indexing,
        Failed
    };

    struct ArchiveCatalogLookup
    {
        ArchiveCatalogLookupState state{ArchiveCatalogLookupState::Indexing};
        ArchiveCatalogEntry entry;
        std::wstring message;
    };

    class ArchiveCatalogService final
    {
    public:
        using DestinationUnavailable = std::function<bool(const std::filesystem::path&)>;

        ArchiveCatalogService(
            Logger& logger,
            const BuildPathSettingsService& pathSettings,
            DestinationUnavailable destinationUnavailable = {}) noexcept;

        [[nodiscard]] ArchiveCatalogEntry importArchive(
            const std::filesystem::path& projectDirectory,
            const std::filesystem::path& sourcePath) const;

        [[nodiscard]] ArchiveCatalogEntry identifyArchive(
            const std::filesystem::path& projectDirectory,
            const std::filesystem::path& archivePath) const;

        [[nodiscard]] ArchiveCatalogEntry consolidateArchive(
            const std::filesystem::path& projectDirectory,
            const std::filesystem::path& archivePath) const;

        [[nodiscard]] ArchiveCatalogLookup lookupArchive(
            const std::filesystem::path& projectDirectory,
            const std::filesystem::path& archivePath) const;

        void removeArchiveSidecar(const std::filesystem::path& archivePath) const;
        void forgetArchiveIndex(const std::filesystem::path& archivePath) const;

        [[nodiscard]] static std::filesystem::path sidecarPathFor(
            const std::filesystem::path& archivePath);

        [[nodiscard]] static bool isSupportedArchiveFile(
            const std::filesystem::path& archivePath);

    private:
        Logger& logger_;
        const BuildPathSettingsService& pathSettings_;
        DestinationUnavailable destinationUnavailable_;
    };
}
