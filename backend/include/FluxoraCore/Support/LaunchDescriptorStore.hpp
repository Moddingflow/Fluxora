#pragma once

#include <cstdint>
#include <filesystem>

namespace fluxora
{
    void pruneDeadManagerLaunchDescriptors(
        const std::filesystem::path& sessionsDirectory,
        std::uint32_t currentManagerProcessId);
}
