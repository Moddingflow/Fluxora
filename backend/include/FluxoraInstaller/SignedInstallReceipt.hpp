#pragma once

#include "FluxoraInstaller/UpdateWorkflowRequest.hpp"

#include <filesystem>

namespace fluxora::installer
{
    class SignedInstallReceipt final
    {
    public:
        explicit SignedInstallReceipt(std::filesystem::path appDataRoot = {});
        void write(const UpdateWorkflowRequest& request) const;
        [[nodiscard]] std::filesystem::path receiptDirectory() const;

    private:
        std::filesystem::path appDataRoot_;
    };
}
