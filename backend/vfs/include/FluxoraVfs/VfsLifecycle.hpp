#pragma once

#include <cstdint>
#include <string_view>

namespace fluxora::vfs
{
    enum class ManagerLifetimeWatchPlan
    {
        RefuseMissingManager,
        CurrentProcessOwnsSession,
        WatchExternalManager
    };

    enum class ChildProcessVirtualizationPlan
    {
        InjectVirtualizedChild,
        LaunchExternalBootstrap
    };

    [[nodiscard]] ManagerLifetimeWatchPlan managerLifetimeWatchPlan(
        std::uint32_t managerProcessId,
        std::uint32_t currentProcessId) noexcept;

    [[nodiscard]] ChildProcessVirtualizationPlan childProcessVirtualizationPlan(
        std::wstring_view applicationName,
        std::wstring_view commandLine) noexcept;
}
