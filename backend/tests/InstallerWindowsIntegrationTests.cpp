#include "FluxoraInstaller/InstallerDirectoryTransaction.hpp"
#include "FluxoraInstaller/SetupBootstrapService.hpp"
#include "FluxoraInstaller/WindowsIntegration.hpp"
#include "TestFilesystem.hpp"

#include <gtest/gtest.h>

#include <algorithm>
#include <filesystem>
#include <map>
#include <optional>
#include <string>
#include <utility>
#include <vector>

namespace
{
    class FakeRegistry final :
        public fluxora::installer::ICurrentUserRegistryStore
    {
    public:
        [[nodiscard]] bool keyExists(std::wstring_view keyPath) const override
        {
            const std::wstring prefix = std::wstring(keyPath) + L"\\";
            for (const auto& [path, values] : keys)
            {
                (void)values;
                if (_wcsicmp(path.c_str(), std::wstring(keyPath).c_str()) == 0 ||
                    path.size() > prefix.size() &&
                    _wcsnicmp(path.c_str(), prefix.c_str(), prefix.size()) == 0)
                {
                    return true;
                }
            }
            return false;
        }

        [[nodiscard]] std::optional<std::wstring> readString(
            std::wstring_view keyPath,
            std::wstring_view valueName) const override
        {
            const auto key = keys.find(std::wstring(keyPath));
            if (key == keys.end())
            {
                return std::nullopt;
            }
            const auto value = key->second.find(std::wstring(valueName));
            return value == key->second.end()
                ? std::nullopt
                : std::optional<std::wstring>(value->second);
        }

        void writeString(
            std::wstring_view keyPath,
            std::wstring_view valueName,
            std::wstring_view value) override
        {
            keys[std::wstring(keyPath)][std::wstring(valueName)] = value;
            writes.emplace_back(keyPath, valueName, value);
        }

        void deleteValue(
            std::wstring_view keyPath,
            std::wstring_view valueName) override
        {
            keys[std::wstring(keyPath)].erase(std::wstring(valueName));
            deletedValues.emplace_back(keyPath, valueName);
        }

        void deleteTree(std::wstring_view keyPath) override
        {
            const std::wstring prefix = std::wstring(keyPath) + L"\\";
            for (auto iterator = keys.begin(); iterator != keys.end();)
            {
                if (_wcsicmp(iterator->first.c_str(), std::wstring(keyPath).c_str()) == 0 ||
                    iterator->first.size() > prefix.size() &&
                    _wcsnicmp(
                        iterator->first.c_str(),
                        prefix.c_str(),
                        prefix.size()) == 0)
                {
                    iterator = keys.erase(iterator);
                }
                else
                {
                    ++iterator;
                }
            }
            deletedTrees.emplace_back(keyPath);
        }

        void notifyAssociationsChanged() override { ++notifications; }

        std::map<
            std::wstring,
            std::map<std::wstring, std::wstring, std::less<>>,
            std::less<>> keys;
        std::vector<std::tuple<std::wstring, std::wstring, std::wstring>> writes;
        std::vector<std::pair<std::wstring, std::wstring>> deletedValues;
        std::vector<std::wstring> deletedTrees;
        int notifications{0};
    };

    class FakeShortcut final :
        public fluxora::installer::IDesktopShortcutStore
    {
    public:
        [[nodiscard]] std::optional<std::filesystem::path> target() const override
        {
            return current;
        }
        void write(const std::filesystem::path& applicationPath) override
        {
            if (failWrites)
            {
                throw std::runtime_error(
                    "injected shortcut write failure");
            }
            current = applicationPath;
            ++writes;
        }
        void remove() override
        {
            current.reset();
            ++removals;
        }

        std::optional<std::filesystem::path> current;
        bool failWrites{false};
        int writes{0};
        int removals{0};
    };
}

TEST(ProtocolRegistrationServiceTests, InstallsOwnedCapabilityWithoutChangingDefaultHandler)
{
    FakeRegistry registry;
    registry.writeString(
        L"Software\\Classes\\moddingflow\\shell\\open\\command",
        L"",
        L"\"C:\\Other\\Manager.exe\" \"%1\"");
    registry.writes.clear();
    fluxora::installer::ProtocolRegistrationService service(registry);

    service.installOrRepair(L"C:\\Fluxora\\Fluxora.exe");

    EXPECT_TRUE(service.isOwnedRegistration(L"C:\\Fluxora\\Fluxora.exe"));
    EXPECT_EQ(
        L"\"C:\\Other\\Manager.exe\" \"%1\"",
        registry.readString(
            L"Software\\Classes\\moddingflow\\shell\\open\\command",
            L""));
    EXPECT_EQ(1, registry.notifications);
}

TEST(ProtocolRegistrationServiceTests, RefusesForeignOwnershipBeforeMutation)
{
    FakeRegistry registry;
    registry.writeString(
        fluxora::installer::ProtocolRegistrationService::ProgIdPath,
        fluxora::installer::ProtocolRegistrationService::OwnerValueName,
        L"another.application");
    registry.writes.clear();
    fluxora::installer::ProtocolRegistrationService service(registry);

    EXPECT_THROW(
        service.installOrRepair(L"C:\\Fluxora\\Fluxora.exe"),
        std::runtime_error);
    EXPECT_TRUE(registry.writes.empty());
}

TEST(ProtocolRegistrationServiceTests, RefusesForeignRegisteredApplicationsName)
{
    FakeRegistry registry;
    registry.writeString(
        fluxora::installer::ProtocolRegistrationService::
            RegisteredApplicationsPath,
        L"Fluxora",
        L"Software\\AnotherManager\\Capabilities");
    registry.writes.clear();
    fluxora::installer::ProtocolRegistrationService service(registry);

    EXPECT_THROW(
        service.installOrRepair(L"C:\\Fluxora\\Fluxora.exe"),
        std::runtime_error);
    EXPECT_TRUE(registry.writes.empty());
    EXPECT_EQ(0, registry.notifications);
}

TEST(ProtocolRegistrationServiceTests, RefusesForeignCapabilityOwnership)
{
    FakeRegistry registry;
    registry.writeString(
        fluxora::installer::ProtocolRegistrationService::
            ApplicationRegistrationPath,
        fluxora::installer::ProtocolRegistrationService::OwnerValueName,
        L"another.application");
    registry.writes.clear();
    fluxora::installer::ProtocolRegistrationService service(registry);

    EXPECT_THROW(
        service.installOrRepair(L"C:\\Fluxora\\Fluxora.exe"),
        std::runtime_error);
    EXPECT_TRUE(registry.writes.empty());
    EXPECT_EQ(0, registry.notifications);
}

TEST(ProtocolRegistrationServiceTests, UnregisterRemovesOnlyMatchingOwnedRegistration)
{
    FakeRegistry registry;
    fluxora::installer::ProtocolRegistrationService service(registry);
    service.installOrRepair(L"C:\\Fluxora\\Fluxora.exe");

    EXPECT_FALSE(service.uninstall(L"D:\\Fluxora\\Fluxora.exe"));
    EXPECT_TRUE(service.isOwnedRegistration(L"C:\\Fluxora\\Fluxora.exe"));
    EXPECT_TRUE(service.uninstall(L"C:\\Fluxora\\Fluxora.exe"));
    EXPECT_FALSE(registry.keyExists(
        fluxora::installer::ProtocolRegistrationService::ProgIdPath));
    EXPECT_EQ(2, registry.notifications);
}

TEST(ProtocolRegistrationServiceTests, UnregisterAnotherInstallLeavesOwnedStateUntouched)
{
    FakeRegistry registry;
    fluxora::installer::ProtocolRegistrationService service(registry);
    service.installOrRepair(L"C:\\Fluxora\\Fluxora.exe");
    registry.deletedTrees.clear();
    registry.deletedValues.clear();

    EXPECT_FALSE(service.uninstall(L"D:\\Fluxora\\Fluxora.exe"));
    EXPECT_TRUE(registry.deletedTrees.empty());
    EXPECT_TRUE(registry.deletedValues.empty());
    EXPECT_TRUE(service.isOwnedRegistration(L"C:\\Fluxora\\Fluxora.exe"));
}

TEST(ProtocolRegistrationServiceTests, CapabilityOwnershipMismatchFailsClosed)
{
    FakeRegistry registry;
    fluxora::installer::ProtocolRegistrationService service(registry);
    service.installOrRepair(L"C:\\Fluxora\\Fluxora.exe");
    registry.writeString(
        fluxora::installer::ProtocolRegistrationService::
            ApplicationRegistrationPath,
        fluxora::installer::ProtocolRegistrationService::OwnerValueName,
        L"another.application");
    registry.deletedTrees.clear();
    registry.deletedValues.clear();

    EXPECT_FALSE(service.uninstall(L"C:\\Fluxora\\Fluxora.exe"));
    EXPECT_TRUE(registry.deletedTrees.empty());
    EXPECT_TRUE(registry.deletedValues.empty());
    EXPECT_TRUE(registry.keyExists(
        fluxora::installer::ProtocolRegistrationService::ProgIdPath));
}

TEST(ProtocolRegistrationServiceTests, MatchingUnregisterNeverDeletesSchemeKey)
{
    FakeRegistry registry;
    const std::wstring schemePath = L"Software\\Classes\\moddingflow";
    registry.writeString(schemePath, L"ForeignDefault", L"keep");
    fluxora::installer::ProtocolRegistrationService service(registry);
    service.installOrRepair(L"C:\\Fluxora\\Fluxora.exe");

    ASSERT_TRUE(service.uninstall(L"C:\\Fluxora\\Fluxora.exe"));

    EXPECT_EQ(
        std::optional<std::wstring>(L"keep"),
        registry.readString(schemePath, L"ForeignDefault"));
    EXPECT_FALSE(
        registry.readString(
            fluxora::installer::ProtocolRegistrationService::
                SchemeOpenWithPath,
            fluxora::installer::ProtocolRegistrationService::ProgId)
            .has_value());
    EXPECT_EQ(
        registry.deletedTrees.end(),
        std::find(
            registry.deletedTrees.begin(),
            registry.deletedTrees.end(),
            schemePath));
}

TEST(InstallationOwnershipServiceTests, ClaimsAndReleasesOnlyExactInstall)
{
    FakeRegistry registry;
    fluxora::installer::InstallationOwnershipService ownership(registry);

    ownership.claim(L"C:\\Fluxora\\Fluxora.exe");

    EXPECT_TRUE(ownership.isOwned(L"C:\\Fluxora\\Fluxora.exe"));
    EXPECT_THROW(
        ownership.validateClaim(L"D:\\Fluxora\\Fluxora.exe"),
        std::runtime_error);
    EXPECT_FALSE(ownership.release(L"D:\\Fluxora\\Fluxora.exe"));
    EXPECT_TRUE(ownership.isOwned(L"C:\\Fluxora\\Fluxora.exe"));
    EXPECT_TRUE(ownership.release(L"C:\\Fluxora\\Fluxora.exe"));
    EXPECT_FALSE(ownership.ownedApplicationPath().has_value());
}

TEST(InstallationOwnershipServiceTests, PendingClaimIsDurableAndPromotesToCommitted)
{
    FakeRegistry registry;
    fluxora::installer::InstallationOwnershipService ownership(registry);
    const std::filesystem::path application =
        L"C:\\Custom\\Fluxora\\Fluxora.exe";

    ownership.claimPending(application);

    EXPECT_TRUE(ownership.isOwned(application));
    EXPECT_EQ(application, ownership.ownedApplicationPath());
    EXPECT_EQ(
        std::optional<std::wstring>(
            std::wstring(
                fluxora::installer::InstallationOwnershipService::
                    PendingState)),
        registry.readString(
            fluxora::installer::InstallationOwnershipService::OwnershipPath,
            fluxora::installer::InstallationOwnershipService::StateValueName));

    ownership.claim(application);

    EXPECT_EQ(
        std::optional<std::wstring>(
            std::wstring(
                fluxora::installer::InstallationOwnershipService::
                    CommittedState)),
        registry.readString(
            fluxora::installer::InstallationOwnershipService::OwnershipPath,
            fluxora::installer::InstallationOwnershipService::StateValueName));
}

TEST(WindowsUserIntegrationServiceTests, RepairMovesOnlyOwnedProtocolAndShortcut)
{
    FakeRegistry registry;
    FakeShortcut shortcut;
    fluxora::installer::ProtocolRegistrationService protocol(registry);
    fluxora::installer::InstallationOwnershipService ownership(registry);
    protocol.installOrRepair(L"C:\\Fluxora\\Fluxora.exe");
    shortcut.current = L"C:\\Fluxora\\Fluxora.exe";
    fluxora::installer::WindowsUserIntegrationService integration(
        protocol,
        shortcut,
        ownership);

    const fluxora::installer::WindowsIntegrationResult result =
        integration.configure(L"D:\\Apps\\Fluxora\\Fluxora.exe", true);

    EXPECT_TRUE(result.protocolConfigured);
    EXPECT_TRUE(result.shortcutConfigured);
    EXPECT_EQ(
        std::filesystem::path(L"D:\\Apps\\Fluxora\\Fluxora.exe"),
        shortcut.current);
    EXPECT_TRUE(protocol.isOwnedRegistration(
        L"D:\\Apps\\Fluxora\\Fluxora.exe"));
    EXPECT_TRUE(ownership.isOwned(
        L"D:\\Apps\\Fluxora\\Fluxora.exe"));
}

TEST(WindowsUserIntegrationServiceTests, RefusesForeignShortcutWithoutMutation)
{
    FakeRegistry registry;
    FakeShortcut shortcut;
    shortcut.current = L"C:\\Other\\Fluxora.exe";
    fluxora::installer::ProtocolRegistrationService protocol(registry);
    fluxora::installer::InstallationOwnershipService ownership(registry);
    fluxora::installer::WindowsUserIntegrationService integration(
        protocol,
        shortcut,
        ownership);

    EXPECT_THROW(
        (void)integration.configure(L"C:\\Fluxora\\Fluxora.exe", true),
        std::runtime_error);
    EXPECT_EQ(0, shortcut.writes);
    EXPECT_FALSE(protocol.ownedApplicationPath().has_value());
    EXPECT_FALSE(ownership.ownedApplicationPath().has_value());
}

TEST(WindowsUserIntegrationServiceTests, PreflightRejectsProtocolCollisionWithoutMutation)
{
    FakeRegistry registry;
    FakeShortcut shortcut;
    registry.writeString(
        fluxora::installer::ProtocolRegistrationService::ProgIdPath,
        fluxora::installer::ProtocolRegistrationService::OwnerValueName,
        L"another.application");
    registry.writes.clear();
    fluxora::installer::ProtocolRegistrationService protocol(registry);
    fluxora::installer::InstallationOwnershipService ownership(registry);
    fluxora::installer::WindowsUserIntegrationService integration(
        protocol,
        shortcut,
        ownership);

    EXPECT_THROW(
        integration.validateConfigure(
            L"C:\\Fluxora\\Fluxora.exe",
            true),
        std::runtime_error);
    EXPECT_TRUE(registry.writes.empty());
    EXPECT_EQ(0, shortcut.writes);
}

TEST(SetupIntegrationRecoveryTests, PendingOwnershipSurvivesIntegrationFailureAndRepairCompletes)
{
    fluxora::tests::TempDirectory temporary;
    const std::filesystem::path install =
        temporary.path() / L"Custom" / L"Fluxora";
    const std::filesystem::path application =
        install / L"Fluxora.exe";
    fluxora::tests::writeTextFile(application, "old executable");
    fluxora::tests::writeTextFile(
        install / L"Downloads" / L"kept.bin",
        "protected download");
    FakeRegistry registry;
    FakeShortcut shortcut;
    fluxora::installer::ProtocolRegistrationService protocol(registry);
    fluxora::installer::InstallationOwnershipService ownership(registry);
    fluxora::installer::WindowsUserIntegrationService integration(
        protocol,
        shortcut,
        ownership);

    fluxora::installer::detail::replaceApplicationDirectory(
        install,
        [](const std::filesystem::path& staging) {
            fluxora::tests::writeTextFile(
                staging / L"Fluxora.exe",
                "new executable");
        },
        [](const std::filesystem::path& staged) {
            if (!std::filesystem::is_regular_file(
                    staged / L"Fluxora.exe"))
            {
                throw std::runtime_error(
                    "staged executable is missing");
            }
        },
        [&](fluxora::installer::detail::DirectoryTransactionStage stage) {
            if (stage ==
                fluxora::installer::detail::DirectoryTransactionStage::
                    ProtectedDataStaged)
            {
                ownership.claimPending(application);
            }
        },
        false);

    EXPECT_EQ(
        std::optional<std::wstring>(
            std::wstring(
                fluxora::installer::InstallationOwnershipService::
                    PendingState)),
        registry.readString(
            fluxora::installer::InstallationOwnershipService::OwnershipPath,
            fluxora::installer::InstallationOwnershipService::StateValueName));
    EXPECT_EQ(
        "new executable",
        fluxora::tests::readTextFile(application));
    const std::filesystem::path marker =
        install.parent_path() /
        (L"." + install.filename().wstring() +
         L".fluxora-transaction");
    EXPECT_TRUE(std::filesystem::exists(marker));

    const auto bootstrap =
        fluxora::installer::SetupBootstrapService(
            registry,
            temporary.path(),
            "1.2.3")
            .bootstrap(1024);
    EXPECT_TRUE(bootstrap.isOwnedInstall);
    EXPECT_EQ(
        fluxora::installer::SetupInstallMode::Repair,
        bootstrap.mode);

    shortcut.failWrites = true;
    EXPECT_THROW(
        (void)integration.configure(application, true),
        std::runtime_error);
    EXPECT_TRUE(protocol.isOwnedRegistration(application));
    EXPECT_TRUE(ownership.isOwned(application));

    fluxora::installer::detail::recoverApplicationDirectory(install);
    EXPECT_EQ(
        "new executable",
        fluxora::tests::readTextFile(application));
    EXPECT_EQ(
        "protected download",
        fluxora::tests::readTextFile(
            install / L"Downloads" / L"kept.bin"));
    EXPECT_FALSE(std::filesystem::exists(marker));

    shortcut.failWrites = false;
    EXPECT_NO_THROW(
        (void)integration.configure(application, true));
    EXPECT_EQ(application, shortcut.current);
    EXPECT_EQ(
        std::optional<std::wstring>(
            std::wstring(
                fluxora::installer::InstallationOwnershipService::
                    CommittedState)),
        registry.readString(
            fluxora::installer::InstallationOwnershipService::OwnershipPath,
            fluxora::installer::InstallationOwnershipService::StateValueName));
}
