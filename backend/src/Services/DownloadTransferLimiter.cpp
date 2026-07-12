#include "FluxoraCore/Services/DownloadTransferLimiter.hpp"

#include <utility>

namespace fluxora
{
    DownloadTransferLimiter::Permit::Permit(DownloadTransferLimiter* owner) noexcept
        : owner_(owner)
    {
    }

    DownloadTransferLimiter::Permit::Permit(Permit&& other) noexcept
        : owner_(std::exchange(other.owner_, nullptr))
    {
    }

    DownloadTransferLimiter::Permit::~Permit()
    {
        if (owner_ != nullptr)
        {
            owner_->release();
        }
    }

    DownloadTransferLimiter::Permit DownloadTransferLimiter::acquire()
    {
        slots_.acquire();
        return Permit(this);
    }

    std::optional<DownloadTransferLimiter::Permit> DownloadTransferLimiter::tryAcquire()
    {
        if (!slots_.try_acquire())
        {
            return std::nullopt;
        }

        return Permit(this);
    }

    std::optional<DownloadTransferLimiter::Permit> DownloadTransferLimiter::tryAcquireFor(
        std::chrono::milliseconds timeout)
    {
        if (!slots_.try_acquire_for(timeout))
        {
            return std::nullopt;
        }

        return Permit(this);
    }

    void DownloadTransferLimiter::release() noexcept
    {
        slots_.release();
    }
}
