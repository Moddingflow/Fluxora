#include "FluxoraInstaller/UpdateProcessLock.hpp"

#include <algorithm>
#include <array>
#include <cstdint>
#include <iomanip>
#include <sstream>
#include <stdexcept>
#include <system_error>
#include <utility>

#include <bcrypt.h>

namespace
{
    std::wstring canonicalUppercasePath(const std::filesystem::path& installDirectory)
    {
        if (installDirectory.empty() || !installDirectory.is_absolute())
        {
            throw std::invalid_argument(
                "Install directory must be absolute before update locking.");
        }
        const std::wstring raw = installDirectory.wstring();
        if (raw.find(L'\0') != std::wstring::npos)
        {
            throw std::invalid_argument("Install directory contains an embedded NUL.");
        }
        const DWORD required = GetFullPathNameW(raw.c_str(), 0, nullptr, nullptr);
        if (required == 0)
        {
            throw std::invalid_argument("Install directory could not be normalized.");
        }
        std::wstring canonical(static_cast<std::size_t>(required), L'\0');
        const DWORD actual = GetFullPathNameW(
            raw.c_str(),
            required,
            canonical.data(),
            nullptr);
        if (actual == 0 || actual >= required)
        {
            throw std::invalid_argument("Install directory could not be normalized.");
        }
        canonical.resize(actual);
        while (canonical.size() > 3 &&
               (canonical.back() == L'\\' || canonical.back() == L'/'))
        {
            canonical.pop_back();
        }
        std::replace(canonical.begin(), canonical.end(), L'/', L'\\');
        const int result = LCMapStringEx(
            LOCALE_NAME_INVARIANT,
            LCMAP_UPPERCASE,
            canonical.data(),
            static_cast<int>(canonical.size()),
            canonical.data(),
            static_cast<int>(canonical.size()),
            nullptr,
            nullptr,
            0);
        if (result == 0)
        {
            throw std::runtime_error("Install directory lock identity could not be normalized.");
        }
        return canonical;
    }

    std::array<unsigned char, 32> sha256Utf8(std::wstring_view value)
    {
        const int utf8Length = WideCharToMultiByte(
            CP_UTF8,
            WC_ERR_INVALID_CHARS,
            value.data(),
            static_cast<int>(value.size()),
            nullptr,
            0,
            nullptr,
            nullptr);
        if (utf8Length <= 0)
        {
            throw std::runtime_error("Install directory lock identity is not valid Unicode.");
        }
        std::string bytes(static_cast<std::size_t>(utf8Length), '\0');
        if (WideCharToMultiByte(
                CP_UTF8,
                WC_ERR_INVALID_CHARS,
                value.data(),
                static_cast<int>(value.size()),
                bytes.data(),
                utf8Length,
                nullptr,
                nullptr) != utf8Length)
        {
            throw std::runtime_error("Install directory lock identity is not valid Unicode.");
        }

        BCRYPT_ALG_HANDLE algorithm = nullptr;
        BCRYPT_HASH_HANDLE hash = nullptr;
        std::array<unsigned char, 32> digest{};
        const auto requireSuccess = [](NTSTATUS status, const char* operation) {
            if (status < 0)
            {
                throw std::runtime_error(
                    std::string("Windows cryptography failed while ") + operation + '.');
            }
        };
        try
        {
            requireSuccess(
                BCryptOpenAlgorithmProvider(
                    &algorithm,
                    BCRYPT_SHA256_ALGORITHM,
                    nullptr,
                    0),
                "opening SHA-256");
            requireSuccess(
                BCryptCreateHash(
                    algorithm,
                    &hash,
                    nullptr,
                    0,
                    nullptr,
                    0,
                    0),
                "creating SHA-256");
            requireSuccess(
                BCryptHashData(
                    hash,
                    reinterpret_cast<PUCHAR>(bytes.data()),
                    static_cast<ULONG>(bytes.size()),
                    0),
                "hashing the install directory");
            requireSuccess(
                BCryptFinishHash(
                    hash,
                    digest.data(),
                    static_cast<ULONG>(digest.size()),
                    0),
                "finishing the install directory hash");
        }
        catch (...)
        {
            if (hash != nullptr)
            {
                BCryptDestroyHash(hash);
            }
            if (algorithm != nullptr)
            {
                BCryptCloseAlgorithmProvider(algorithm, 0);
            }
            throw;
        }
        BCryptDestroyHash(hash);
        BCryptCloseAlgorithmProvider(algorithm, 0);
        return digest;
    }
}

namespace fluxora::installer
{
    UpdateProcessLock::UpdateProcessLock(HANDLE handle, bool wasAbandoned) noexcept
        : handle_(handle),
          wasAbandoned_(wasAbandoned)
    {
    }

    UpdateProcessLock::UpdateProcessLock(UpdateProcessLock&& other) noexcept
        : handle_(std::exchange(other.handle_, nullptr)),
          wasAbandoned_(std::exchange(other.wasAbandoned_, false))
    {
    }

    UpdateProcessLock& UpdateProcessLock::operator=(UpdateProcessLock&& other) noexcept
    {
        if (this != &other)
        {
            release();
            handle_ = std::exchange(other.handle_, nullptr);
            wasAbandoned_ = std::exchange(other.wasAbandoned_, false);
        }
        return *this;
    }

    UpdateProcessLock::~UpdateProcessLock()
    {
        release();
    }

    UpdateProcessLock UpdateProcessLock::acquire(
        const std::filesystem::path& installDirectory,
        std::chrono::milliseconds timeout)
    {
        if (timeout <= std::chrono::milliseconds::zero() ||
            timeout > std::chrono::seconds(5))
        {
            throw std::invalid_argument(
                "Update lock timeout must be between 1 millisecond and 5 seconds.");
        }
        const std::wstring name = nameForInstallDirectory(installDirectory);
        HANDLE handle = CreateMutexW(nullptr, FALSE, name.c_str());
        if (handle == nullptr)
        {
            throw std::system_error(
                static_cast<int>(GetLastError()),
                std::system_category(),
                "The per-install update lock could not be created");
        }
        const DWORD wait = WaitForSingleObject(
            handle,
            static_cast<DWORD>(timeout.count()));
        if (wait == WAIT_TIMEOUT)
        {
            CloseHandle(handle);
            throw UpdateBusyError(
                "Another updater or recovery process already owns this Fluxora installation.");
        }
        if (wait != WAIT_OBJECT_0 && wait != WAIT_ABANDONED)
        {
            const DWORD error = wait == WAIT_FAILED ? GetLastError() : ERROR_INVALID_STATE;
            CloseHandle(handle);
            throw std::system_error(
                static_cast<int>(error),
                std::system_category(),
                "The per-install update lock could not be acquired");
        }
        return UpdateProcessLock(handle, wait == WAIT_ABANDONED);
    }

    std::wstring UpdateProcessLock::nameForInstallDirectory(
        const std::filesystem::path& installDirectory)
    {
        const std::array<unsigned char, 32> digest =
            sha256Utf8(canonicalUppercasePath(installDirectory));
        constexpr wchar_t Digits[] = L"0123456789ABCDEF";
        std::wstring name = L"Local\\FluxoraUpdate-";
        name.reserve(name.size() + digest.size() * 2);
        for (const unsigned char byte : digest)
        {
            name.push_back(Digits[byte >> 4]);
            name.push_back(Digits[byte & 0x0F]);
        }
        return name;
    }

    bool UpdateProcessLock::wasAbandoned() const noexcept
    {
        return wasAbandoned_;
    }

    bool UpdateProcessLock::ownsLock() const noexcept
    {
        return handle_ != nullptr;
    }

    void UpdateProcessLock::release()
    {
        if (handle_ == nullptr)
        {
            return;
        }
        const HANDLE handle = std::exchange(handle_, nullptr);
        if (!ReleaseMutex(handle))
        {
            CloseHandle(handle);
            return;
        }
        CloseHandle(handle);
    }
}
