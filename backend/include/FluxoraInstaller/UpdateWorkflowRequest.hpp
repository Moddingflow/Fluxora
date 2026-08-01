#pragma once

#include "FluxoraInstaller/UpdateEngine.hpp"

#include <cstdint>
#include <filesystem>
#include <string>
#include <string_view>

namespace fluxora::installer
{
    struct UpdateWorkflowRequest final
    {
        std::filesystem::path requestPath;
        bool recoveryInvocation{false};
        std::string operationId;
        std::string handoffNonce;
        std::uint32_t parentPid{0};
        std::uint64_t parentStartFileTime{0};
        std::filesystem::path installDirectory;
        std::filesystem::path updaterWorkingDirectory;
        std::filesystem::path packagePath;
        std::filesystem::path manifestPath;
        std::filesystem::path signaturePath;
        std::string currentVersion;
        std::string targetVersion;
        std::string target;
        UpdateAssetKind assetKind{UpdateAssetKind::Full};
        std::string fromVersion;
        std::string packageSha256;
        std::uint64_t packageSize{0};
        std::filesystem::path applicationExecutable;
        std::filesystem::path workingDirectory;

        [[nodiscard]] std::filesystem::path applicationPath() const;
        [[nodiscard]] UpdateRequest nativeUpdateRequest() const;
    };

    class UpdateWorkflowRequestLoader final
    {
    public:
        [[nodiscard]] static UpdateWorkflowRequest loadAndValidate(
            const std::filesystem::path& requestPath,
            const std::filesystem::path& updaterExecutablePath,
            bool recoveryInvocation = false);

        static void validate(
            const UpdateWorkflowRequest& request,
            const std::filesystem::path& updaterExecutablePath);

        [[nodiscard]] static std::wstring sanitizedSummaryJson(
            const UpdateWorkflowRequest& request);
    };

    [[nodiscard]] bool isSafeOperationId(std::string_view value) noexcept;
    [[nodiscard]] bool isLowerHexSha256(std::string_view value) noexcept;
    [[nodiscard]] bool isThreePartSemanticVersion(std::string_view value) noexcept;
}
