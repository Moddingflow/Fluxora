#pragma once

#include <chrono>
#include <cstddef>
#include <optional>
#include <semaphore>

namespace fluxora
{
    class DownloadTransferLimiter final
    {
    public:
        static constexpr std::ptrdiff_t MaximumActiveTransfers = 5;

        class Permit final
        {
        public:
            Permit(const Permit&) = delete;
            Permit& operator=(const Permit&) = delete;
            Permit(Permit&& other) noexcept;
            Permit& operator=(Permit&& other) = delete;
            ~Permit();

        private:
            friend class DownloadTransferLimiter;

            explicit Permit(DownloadTransferLimiter* owner) noexcept;

            DownloadTransferLimiter* owner_{nullptr};
        };

        DownloadTransferLimiter() = default;
        DownloadTransferLimiter(const DownloadTransferLimiter&) = delete;
        DownloadTransferLimiter& operator=(const DownloadTransferLimiter&) = delete;

        [[nodiscard]] Permit acquire();
        [[nodiscard]] std::optional<Permit> tryAcquire();
        [[nodiscard]] std::optional<Permit> tryAcquireFor(std::chrono::milliseconds timeout);

    private:
        void release() noexcept;

        std::counting_semaphore<MaximumActiveTransfers> slots_{MaximumActiveTransfers};
    };
}
