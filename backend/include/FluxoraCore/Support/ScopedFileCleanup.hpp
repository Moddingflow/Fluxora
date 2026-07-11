#pragma once

#include <filesystem>
#include <utility>

namespace fluxora
{
    class ScopedFileCleanup final
    {
    public:
        explicit ScopedFileCleanup(std::filesystem::path path) noexcept
            : path_(std::move(path))
        {
        }

        ScopedFileCleanup(const ScopedFileCleanup&) = delete;
        ScopedFileCleanup& operator=(const ScopedFileCleanup&) = delete;

        ~ScopedFileCleanup() noexcept
        {
            if (!armed_)
            {
                return;
            }
            std::error_code ignored;
            std::filesystem::remove(path_, ignored);
        }

        void release() noexcept
        {
            armed_ = false;
        }

    private:
        std::filesystem::path path_;
        bool armed_{true};
    };
}
