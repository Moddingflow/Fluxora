#pragma once

#include "FluxoraCore/Services/RemoteDownloadContracts.hpp"
#include "FluxoraCore/Storage/AtomicFileStore.hpp"

#include <cstddef>
#include <filesystem>
#include <optional>

namespace fluxora
{
    class Logger;

    struct RemoteDownloadSidecarWriteOptions
    {
        AtomicWriteFailurePoint simulateFailurePoint{AtomicWriteFailurePoint::None};
        std::optional<std::size_t> simulateDiskFullAfterBytes;
    };

    struct RemoteDownloadSidecarLoadResult
    {
        std::optional<RemoteArtifactResumeState> state;
        AtomicFileRecoveryAction recoveryAction{AtomicFileRecoveryAction::None};
    };

    class RemoteDownloadSidecarStore final
    {
    public:
        static constexpr std::size_t maximumDocumentBytes = 64U * 1024U;

        explicit RemoteDownloadSidecarStore(Logger* logger = nullptr) noexcept;

        [[nodiscard]] static std::filesystem::path sidecarPathFor(
            const std::filesystem::path& artifactPath);

        void save(
            const std::filesystem::path& artifactPath,
            const RemoteArtifactResumeState& state,
            const RemoteDownloadSidecarWriteOptions& options = {});

        [[nodiscard]] RemoteDownloadSidecarLoadResult load(
            const std::filesystem::path& artifactPath);

        void remove(const std::filesystem::path& artifactPath);

    private:
        AtomicFileStore atomicStore_;
        Logger* logger_;
    };
}
