#include "FluxoraCore/Services/SecureCredentialStore.hpp"

#include <limits>
#include <stdexcept>
#include <string>
#include <vector>

#ifdef _WIN32
#include <windows.h>
#include <wincred.h>
#endif

namespace fluxora
{
    namespace
    {
        void validateTarget(std::wstring_view target)
        {
            if (target.empty())
            {
                throw std::invalid_argument("Secure credential target is required.");
            }
#ifdef _WIN32
            if (target.size() > CRED_MAX_GENERIC_TARGET_NAME_LENGTH)
            {
                throw std::invalid_argument("Secure credential target is too long.");
            }
#endif
        }

#ifdef _WIN32
        [[noreturn]] void throwCredentialError(std::string_view operation, DWORD error)
        {
            throw std::runtime_error(
                "Windows Credential Manager " + std::string(operation) +
                " failed with error " + std::to_string(error) + ".");
        }

        class CredentialHandle final
        {
        public:
            explicit CredentialHandle(PCREDENTIALW credential) noexcept
                : credential_(credential)
            {
            }

            CredentialHandle(const CredentialHandle&) = delete;
            CredentialHandle& operator=(const CredentialHandle&) = delete;

            ~CredentialHandle()
            {
                if (credential_ != nullptr)
                {
                    if (credential_->CredentialBlob != nullptr &&
                        credential_->CredentialBlobSize > 0)
                    {
                        SecureZeroMemory(
                            credential_->CredentialBlob,
                            credential_->CredentialBlobSize);
                    }
                    CredFree(credential_);
                }
            }

            [[nodiscard]] PCREDENTIALW get() const noexcept
            {
                return credential_;
            }

        private:
            PCREDENTIALW credential_{};
        };

        class WindowsSecureCredentialStore final : public ISecureCredentialStore
        {
        public:
            [[nodiscard]] std::optional<std::string> read(
                std::wstring_view target) const override
            {
                validateTarget(target);
                const std::wstring targetName(target);
                PCREDENTIALW rawCredential = nullptr;
                if (!CredReadW(
                        targetName.c_str(),
                        CRED_TYPE_GENERIC,
                        0,
                        &rawCredential))
                {
                    const DWORD error = GetLastError();
                    if (error == ERROR_NOT_FOUND)
                    {
                        return std::nullopt;
                    }
                    throwCredentialError("read", error);
                }

                const CredentialHandle credential(rawCredential);
                if (credential.get()->CredentialBlobSize == 0)
                {
                    return std::string{};
                }
                if (credential.get()->CredentialBlob == nullptr)
                {
                    throw std::runtime_error(
                        "Windows Credential Manager returned an invalid credential blob.");
                }

                const char* bytes = reinterpret_cast<const char*>(
                    credential.get()->CredentialBlob);
                return std::string(
                    bytes,
                    bytes + credential.get()->CredentialBlobSize);
            }

            void writeAtomic(
                std::wstring_view target,
                std::string_view secret) override
            {
                validateTarget(target);
                if (secret.empty())
                {
                    throw std::invalid_argument("Secure credential value is required.");
                }
                if (secret.size() > CRED_MAX_CREDENTIAL_BLOB_SIZE ||
                    secret.size() > (std::numeric_limits<DWORD>::max)())
                {
                    throw std::invalid_argument("Secure credential value is too large.");
                }

                const std::wstring targetName(target);
                std::vector<unsigned char> blob(secret.begin(), secret.end());
                CREDENTIALW credential{};
                credential.Type = CRED_TYPE_GENERIC;
                credential.TargetName = const_cast<LPWSTR>(targetName.c_str());
                credential.CredentialBlobSize = static_cast<DWORD>(blob.size());
                credential.CredentialBlob = blob.data();
                credential.Persist = CRED_PERSIST_LOCAL_MACHINE;
                credential.UserName = const_cast<LPWSTR>(L"Fluxora");

                const BOOL written = CredWriteW(&credential, 0);
                const DWORD error = written ? ERROR_SUCCESS : GetLastError();
                SecureZeroMemory(blob.data(), blob.size());
                if (!written)
                {
                    throwCredentialError("write", error);
                }
            }

            void remove(std::wstring_view target) override
            {
                validateTarget(target);
                const std::wstring targetName(target);
                if (CredDeleteW(targetName.c_str(), CRED_TYPE_GENERIC, 0))
                {
                    return;
                }
                const DWORD error = GetLastError();
                if (error != ERROR_NOT_FOUND)
                {
                    throwCredentialError("delete", error);
                }
            }
        };
#else
        class WindowsSecureCredentialStore final : public ISecureCredentialStore
        {
        public:
            [[nodiscard]] std::optional<std::string> read(
                std::wstring_view target) const override
            {
                validateTarget(target);
                throw std::runtime_error(
                    "Windows Credential Manager is unavailable on this platform.");
            }

            void writeAtomic(
                std::wstring_view target,
                std::string_view secret) override
            {
                validateTarget(target);
                (void)secret;
                throw std::runtime_error(
                    "Windows Credential Manager is unavailable on this platform.");
            }

            void remove(std::wstring_view target) override
            {
                validateTarget(target);
                throw std::runtime_error(
                    "Windows Credential Manager is unavailable on this platform.");
            }
        };
#endif
    }

    std::unique_ptr<ISecureCredentialStore> createWindowsSecureCredentialStore()
    {
        return std::make_unique<WindowsSecureCredentialStore>();
    }
}
