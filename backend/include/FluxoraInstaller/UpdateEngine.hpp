#pragma once

#include <cstddef>
#include <cstdint>
#include <filesystem>
#include <functional>
#include <optional>
#include <span>
#include <string>
#include <string_view>
#include <vector>

namespace fluxora::installer
{
    enum class UpdateAssetKind
    {
        Full,
        Delta
    };

    struct UpdateRequest final
    {
        std::filesystem::path manifestPath;
        std::filesystem::path signaturePath;
        std::filesystem::path packagePath;
        std::filesystem::path installDirectory;
        std::string currentVersion;
        std::string targetVersion;
        std::string target;
        UpdateAssetKind assetKind{UpdateAssetKind::Full};
        std::optional<std::string> fromVersion;
        std::string expectedPackageSha256;
        std::uint64_t expectedPackageSize{0};
        std::wstring applicationExecutable;
    };

    enum class UpdateCommitStage
    {
        StagingBuilt,
        ProtectedDataStaged,
        BackupCreated,
        StagingCommitted
    };

    struct UpdateApplyResult final
    {
        std::filesystem::path installDirectory;
        std::filesystem::path applicationPath;
        std::string targetVersion;
    };

    using UpdateSignatureVerifier = std::function<bool(
        std::span<const std::byte> manifestBytes,
        std::string_view signatureBase64)>;
    using UpdateCommitObserver = std::function<void(UpdateCommitStage stage)>;
    using UpdateProgressCallback = std::function<void(
        std::string_view phase,
        std::string_view currentItem,
        std::uint64_t completedBytes,
        std::uint64_t totalBytes)>;

    class UpdateManifestVerifier final
    {
    public:
        explicit UpdateManifestVerifier(std::string publicKeyPem);
        explicit UpdateManifestVerifier(std::vector<std::byte> publicKeyDer);

        [[nodiscard]] bool verify(
            std::span<const std::byte> manifestBytes,
            std::string_view signatureBase64) const;

    private:
        std::vector<std::byte> publicKeyDer_;
    };

    class UpdateEngine final
    {
    public:
        explicit UpdateEngine(std::string publicKeyPem);
        explicit UpdateEngine(std::vector<std::byte> publicKeyDer);
        explicit UpdateEngine(
            UpdateSignatureVerifier signatureVerifier,
            UpdateCommitObserver commitObserver = {});

        void verify(const UpdateRequest& request) const;
        [[nodiscard]] UpdateApplyResult apply(
            const UpdateRequest& request,
            const UpdateProgressCallback& progress = {}) const;

    private:
        UpdateSignatureVerifier signatureVerifier_;
        UpdateCommitObserver commitObserver_;
    };
}
