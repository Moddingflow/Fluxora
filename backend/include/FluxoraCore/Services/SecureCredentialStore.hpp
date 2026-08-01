#pragma once

#include <memory>
#include <optional>
#include <string>
#include <string_view>

namespace fluxora
{
    class ISecureCredentialStore
    {
    public:
        virtual ~ISecureCredentialStore() = default;

        [[nodiscard]] virtual std::optional<std::string> read(
            std::wstring_view target) const = 0;
        virtual void writeAtomic(
            std::wstring_view target,
            std::string_view secret) = 0;
        virtual void remove(std::wstring_view target) = 0;
    };

    [[nodiscard]] std::unique_ptr<ISecureCredentialStore>
        createWindowsSecureCredentialStore();
}
