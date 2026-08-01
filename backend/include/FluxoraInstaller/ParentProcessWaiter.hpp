#pragma once

#include "FluxoraInstaller/UpdateWorkflowRequest.hpp"

#include <cstdint>
#include <filesystem>
#include <memory>

namespace fluxora::installer
{
    class IParentProcess
    {
    public:
        virtual ~IParentProcess() = default;
        [[nodiscard]] virtual std::uint64_t startFileTime() const = 0;
        [[nodiscard]] virtual std::filesystem::path executablePath() const = 0;
        [[nodiscard]] virtual bool hasExited() const = 0;
        virtual void waitForExit() = 0;
    };

    class IParentProcessResolver
    {
    public:
        virtual ~IParentProcessResolver() = default;
        [[nodiscard]] virtual std::unique_ptr<IParentProcess> resolve(
            std::uint32_t processId) const = 0;
    };

    class SystemParentProcessResolver final : public IParentProcessResolver
    {
    public:
        [[nodiscard]] std::unique_ptr<IParentProcess> resolve(
            std::uint32_t processId) const override;
    };

    class ParentProcessWaiter final
    {
    public:
        explicit ParentProcessWaiter(const IParentProcessResolver& resolver);
        void wait(const UpdateWorkflowRequest& request) const;

    private:
        const IParentProcessResolver& resolver_;
    };
}
