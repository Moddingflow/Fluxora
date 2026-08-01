#pragma once

#include "FluxoraInstaller\ApplicationLaunchService.hpp"
#include "FluxoraInstaller\UpdateWorkflowRequest.hpp"

#include <chrono>
#include <filesystem>

namespace fluxora::installer
{
    class HealthAcknowledgementService final
    {
    public:
        explicit HealthAcknowledgementService(
            std::filesystem::path appDataRoot = {},
            std::chrono::milliseconds pollInterval = std::chrono::milliseconds(50));

        void prepare(const UpdateWorkflowRequest& request) const;
        void wait(
            const UpdateWorkflowRequest& request,
            const ILaunchedApplicationIdentity& application,
            std::chrono::milliseconds timeout = std::chrono::seconds(30)) const;
        void cleanup(const UpdateWorkflowRequest& request) const noexcept;

        [[nodiscard]] std::filesystem::path acknowledgementPath(
            const UpdateWorkflowRequest& request) const;

    private:
        [[nodiscard]] std::filesystem::path healthDirectory() const;

        std::filesystem::path appDataRoot_;
        std::chrono::milliseconds pollInterval_;
    };
}
