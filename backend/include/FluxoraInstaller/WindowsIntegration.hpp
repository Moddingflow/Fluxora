#pragma once

#include <filesystem>
#include <optional>
#include <string>
#include <string_view>

namespace fluxora::installer
{
    class ICurrentUserRegistryStore
    {
    public:
        virtual ~ICurrentUserRegistryStore() = default;
        [[nodiscard]] virtual bool keyExists(std::wstring_view keyPath) const = 0;
        [[nodiscard]] virtual std::optional<std::wstring> readString(
            std::wstring_view keyPath,
            std::wstring_view valueName) const = 0;
        virtual void writeString(
            std::wstring_view keyPath,
            std::wstring_view valueName,
            std::wstring_view value) = 0;
        virtual void deleteValue(
            std::wstring_view keyPath,
            std::wstring_view valueName) = 0;
        virtual void deleteTree(std::wstring_view keyPath) = 0;
        virtual void notifyAssociationsChanged() = 0;
    };

    class WindowsCurrentUserRegistryStore final : public ICurrentUserRegistryStore
    {
    public:
        [[nodiscard]] bool keyExists(std::wstring_view keyPath) const override;
        [[nodiscard]] std::optional<std::wstring> readString(
            std::wstring_view keyPath,
            std::wstring_view valueName) const override;
        void writeString(
            std::wstring_view keyPath,
            std::wstring_view valueName,
            std::wstring_view value) override;
        void deleteValue(
            std::wstring_view keyPath,
            std::wstring_view valueName) override;
        void deleteTree(std::wstring_view keyPath) override;
        void notifyAssociationsChanged() override;
    };

    class ProtocolRegistrationService final
    {
    public:
        static constexpr std::wstring_view Scheme = L"moddingflow";
        static constexpr std::wstring_view ProgId = L"Fluxora.ModdingFlow";
        static constexpr std::wstring_view OwnerId = L"app.fluxora.desktop";
        static constexpr std::wstring_view ProgIdPath =
            L"Software\\Classes\\Fluxora.ModdingFlow";
        static constexpr std::wstring_view ProgIdCommandPath =
            L"Software\\Classes\\Fluxora.ModdingFlow\\shell\\open\\command";
        static constexpr std::wstring_view SchemeOpenWithPath =
            L"Software\\Classes\\moddingflow\\OpenWithProgids";
        static constexpr std::wstring_view ApplicationRegistrationPath =
            L"Software\\Fluxora\\ManagerHandoff";
        static constexpr std::wstring_view CapabilitiesPath =
            L"Software\\Fluxora\\ManagerHandoff\\Capabilities";
        static constexpr std::wstring_view UrlAssociationsPath =
            L"Software\\Fluxora\\ManagerHandoff\\Capabilities\\URLAssociations";
        static constexpr std::wstring_view RegisteredApplicationsPath =
            L"Software\\RegisteredApplications";
        static constexpr std::wstring_view OwnerValueName = L"FluxoraOwner";
        static constexpr std::wstring_view InstallPathValueName = L"FluxoraInstallPath";

        explicit ProtocolRegistrationService(ICurrentUserRegistryStore& registry);

        void validateInstallOrRepair(
            const std::filesystem::path& applicationPath) const;
        void installOrRepair(const std::filesystem::path& applicationPath) const;
        [[nodiscard]] bool uninstall(
            const std::filesystem::path& applicationPath) const;
        [[nodiscard]] bool isOwnedRegistration(
            const std::filesystem::path& applicationPath) const;
        [[nodiscard]] std::optional<std::filesystem::path> ownedApplicationPath() const;

        [[nodiscard]] static std::filesystem::path normalizeApplicationPath(
            const std::filesystem::path& applicationPath);
        [[nodiscard]] static std::wstring openCommand(
            const std::filesystem::path& applicationPath);

    private:
        [[nodiscard]] bool isOwnedApplicationRegistration(
            const std::filesystem::path& applicationPath) const;
        void refuseForeignCollisions() const;

        ICurrentUserRegistryStore& registry_;
    };

    class InstallationOwnershipService final
    {
    public:
        static constexpr std::wstring_view OwnershipPath =
            L"Software\\Fluxora\\Installation";
        static constexpr std::wstring_view OwnerValueName = L"FluxoraOwner";
        static constexpr std::wstring_view InstallPathValueName =
            L"FluxoraInstallPath";
        static constexpr std::wstring_view StateValueName = L"State";
        static constexpr std::wstring_view PendingState = L"pending";
        static constexpr std::wstring_view CommittedState = L"committed";
        static constexpr std::wstring_view OwnerId = L"app.fluxora.desktop";

        explicit InstallationOwnershipService(
            ICurrentUserRegistryStore& registry);

        void validateClaim(
            const std::filesystem::path& applicationPath) const;
        void claimPending(
            const std::filesystem::path& applicationPath) const;
        void claim(const std::filesystem::path& applicationPath) const;
        [[nodiscard]] bool release(
            const std::filesystem::path& applicationPath) const;
        [[nodiscard]] bool isOwned(
            const std::filesystem::path& applicationPath) const;
        [[nodiscard]] std::optional<std::filesystem::path>
            ownedApplicationPath() const;

    private:
        ICurrentUserRegistryStore& registry_;
    };

    class IDesktopShortcutStore
    {
    public:
        virtual ~IDesktopShortcutStore() = default;
        [[nodiscard]] virtual std::optional<std::filesystem::path> target() const = 0;
        virtual void write(const std::filesystem::path& applicationPath) = 0;
        virtual void remove() = 0;
    };

    class WindowsDesktopShortcutStore final : public IDesktopShortcutStore
    {
    public:
        [[nodiscard]] std::optional<std::filesystem::path> target() const override;
        void write(const std::filesystem::path& applicationPath) override;
        void remove() override;

        [[nodiscard]] static std::filesystem::path shortcutPath();
    };

    struct WindowsIntegrationResult final
    {
        bool protocolConfigured{false};
        bool shortcutConfigured{false};
        bool protocolRemoved{false};
        bool shortcutRemoved{false};
    };

    class WindowsUserIntegrationService final
    {
    public:
        WindowsUserIntegrationService(
            ProtocolRegistrationService& protocol,
            IDesktopShortcutStore& shortcut,
            InstallationOwnershipService& ownership);

        void validateConfigure(
            const std::filesystem::path& applicationPath,
            bool createDesktopShortcut) const;
        [[nodiscard]] WindowsIntegrationResult configure(
            const std::filesystem::path& applicationPath,
            bool createDesktopShortcut) const;
        [[nodiscard]] WindowsIntegrationResult unregisterOwned(
            const std::filesystem::path& applicationPath,
            bool removeDesktopShortcut) const;

    private:
        ProtocolRegistrationService& protocol_;
        IDesktopShortcutStore& shortcut_;
        InstallationOwnershipService& ownership_;
    };
}
