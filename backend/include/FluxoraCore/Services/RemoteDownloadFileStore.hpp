#pragma once

#include "FluxoraCore/Services/SignedRemoteDownloadTransport.hpp"

#include <cstdint>
#include <filesystem>
#include <memory>
#include <optional>
#include <span>
#include <string>

namespace fluxora
{
    struct RemoteDownloadPathValidation
    {
        bool safe{false};
        std::filesystem::path partialPath;
        std::filesystem::path destinationPath;
        std::string message;
    };

    enum class RemoteDownloadPromotionOutcome
    {
        Promoted,
        DestinationExists,
        Failure
    };

    class IRemoteDownloadFileWriter
    {
    public:
        virtual ~IRemoteDownloadFileWriter() = default;
        virtual void append(std::span<const std::byte> bytes) = 0;
        virtual void flush() = 0;
        [[nodiscard]] virtual std::uint64_t position() const noexcept = 0;
    };

    class IRemoteDownloadFileStore
    {
    public:
        virtual ~IRemoteDownloadFileStore() = default;

        [[nodiscard]] virtual RemoteDownloadPathValidation validatePaths(
            const std::filesystem::path& allowedRoot,
            const std::filesystem::path& partialPath,
            const std::filesystem::path& destinationPath,
            std::uint64_t requiredBytes) const = 0;
        [[nodiscard]] virtual bool exists(const std::filesystem::path& path) const = 0;
        [[nodiscard]] virtual std::optional<std::uint64_t> size(
            const std::filesystem::path& path) const = 0;
        virtual void truncate(const std::filesystem::path& path, std::uint64_t size) = 0;
        [[nodiscard]] virtual std::unique_ptr<IRemoteDownloadFileWriter> openWriter(
            const std::filesystem::path& path,
            std::uint64_t expectedOffset) = 0;
        [[nodiscard]] virtual std::optional<std::string> sha256(
            const std::filesystem::path& path,
            const IRemoteDownloadCancellation& cancellation) const = 0;
        virtual void remove(const std::filesystem::path& path) noexcept = 0;
        [[nodiscard]] virtual RemoteDownloadPromotionOutcome promoteNoReplace(
            const std::filesystem::path& partialPath,
            const std::filesystem::path& destinationPath) = 0;
    };

    // Native data-plane filesystem boundary. It validates caller-owned paths,
    // writes only the partial artifact, and exposes the destination solely via
    // a same-directory, no-replace atomic promotion after verification.
    class RemoteDownloadFileStore final : public IRemoteDownloadFileStore
    {
    public:
        [[nodiscard]] RemoteDownloadPathValidation validatePaths(
            const std::filesystem::path& allowedRoot,
            const std::filesystem::path& partialPath,
            const std::filesystem::path& destinationPath,
            std::uint64_t requiredBytes) const override;
        [[nodiscard]] bool exists(const std::filesystem::path& path) const override;
        [[nodiscard]] std::optional<std::uint64_t> size(
            const std::filesystem::path& path) const override;
        void truncate(const std::filesystem::path& path, std::uint64_t size) override;
        [[nodiscard]] std::unique_ptr<IRemoteDownloadFileWriter> openWriter(
            const std::filesystem::path& path,
            std::uint64_t expectedOffset) override;
        [[nodiscard]] std::optional<std::string> sha256(
            const std::filesystem::path& path,
            const IRemoteDownloadCancellation& cancellation) const override;
        void remove(const std::filesystem::path& path) noexcept override;
        [[nodiscard]] RemoteDownloadPromotionOutcome promoteNoReplace(
            const std::filesystem::path& partialPath,
            const std::filesystem::path& destinationPath) override;
    };
}
