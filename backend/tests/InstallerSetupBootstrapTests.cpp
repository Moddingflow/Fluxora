#include "FluxoraInstaller/SetupBootstrapService.hpp"
#include "TestFilesystem.hpp"

#include <gtest/gtest.h>

#include <fstream>
#include <map>
#include <optional>
#include <stdexcept>
#include <string>

namespace
{
    class EmptyRegistry final :
        public fluxora::installer::ICurrentUserRegistryStore
    {
    public:
        [[nodiscard]] bool keyExists(std::wstring_view keyPath) const override
        {
            return values.contains(std::wstring(keyPath));
        }
        [[nodiscard]] std::optional<std::wstring> readString(
            std::wstring_view keyPath,
            std::wstring_view valueName) const override
        {
            const auto key = values.find(std::wstring(keyPath));
            if (key == values.end())
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
            values[std::wstring(keyPath)][std::wstring(valueName)] = value;
        }
        void deleteValue(
            std::wstring_view keyPath,
            std::wstring_view valueName) override
        {
            values[std::wstring(keyPath)].erase(std::wstring(valueName));
        }
        void deleteTree(std::wstring_view keyPath) override
        {
            values.erase(std::wstring(keyPath));
        }
        void notifyAssociationsChanged() override {}

        std::map<
            std::wstring,
            std::map<std::wstring, std::wstring, std::less<>>,
            std::less<>> values;
    };
}

TEST(SetupBootstrapServiceTests, UsesPerUserProgramsDefaultAndStableDiskFacts)
{
    fluxora::tests::TempDirectory temporary;
    EmptyRegistry registry;
    const fluxora::installer::SetupBootstrapService service(
        registry,
        temporary.path(),
        "1.2.3");

    const fluxora::installer::SetupBootstrapState state =
        service.bootstrap(1024);

    EXPECT_EQ(
        temporary.path() / L"Programs" / L"Fluxora",
        state.defaultInstallDirectory);
    EXPECT_EQ(fluxora::installer::SetupInstallMode::Install, state.mode);
    EXPECT_FALSE(state.isOwnedInstall);
    EXPECT_TRUE(state.installedVersion.empty());
    EXPECT_EQ(
        std::wstring::npos,
        fluxora::installer::SetupBootstrapService::serialize(state).find(
            L"\"installedVersion\""));
    EXPECT_EQ(1024 + 64ULL * 1024ULL * 1024ULL, state.requiredBytes);
    EXPECT_GT(state.freeBytes, 0u);
}

TEST(SetupBootstrapServiceTests, RefusesToOverwriteNonOwnedExistingDirectory)
{
    fluxora::tests::TempDirectory temporary;
    const std::filesystem::path install = temporary.path() / L"existing";
    std::filesystem::create_directories(install);
    std::ofstream(install / L"foreign.bin") << "foreign";
    EmptyRegistry registry;
    const fluxora::installer::SetupBootstrapService service(
        registry,
        temporary.path(),
        "1.2.3");

    const fluxora::installer::SetupInstallValidation validation =
        service.validate(install, 1024);

    EXPECT_EQ(
        fluxora::installer::SetupValidationStatus::ForeignInstall,
        validation.status);
    EXPECT_EQ("setup-foreign-install", validation.code);
}

TEST(SetupBootstrapServiceTests, InvalidRelativePathReturnsStableValidationCode)
{
    fluxora::tests::TempDirectory temporary;
    EmptyRegistry registry;
    const fluxora::installer::SetupBootstrapService service(
        registry,
        temporary.path(),
        "1.2.3");

    const fluxora::installer::SetupInstallValidation validation =
        service.validate(L"relative", 1024);

    EXPECT_EQ(
        fluxora::installer::SetupValidationStatus::InvalidPath,
        validation.status);
    EXPECT_EQ("setup-invalid-path", validation.code);
}

TEST(SetupBootstrapServiceTests, ReturnsStableCodeWhenDestinationIsNotWritable)
{
    fluxora::tests::TempDirectory temporary;
    EmptyRegistry registry;
    const fluxora::installer::SetupBootstrapService service(
        registry,
        temporary.path(),
        "1.2.3",
        [](const std::filesystem::path&) {
            throw std::runtime_error("injected access denial");
        });

    const auto validation =
        service.validate(temporary.path() / L"install", 1024);

    EXPECT_EQ(
        fluxora::installer::SetupValidationStatus::InvalidPath,
        validation.status);
    EXPECT_EQ("setup-not-writable", validation.code);
    EXPECT_EQ(
        "setup.validation.notWritable",
        validation.messageKey);
}

TEST(SetupBootstrapServiceTests, WritabilityProbeLeavesNoFilesystemArtifact)
{
    fluxora::tests::TempDirectory temporary;
    EmptyRegistry registry;
    const fluxora::installer::SetupBootstrapService service(
        registry,
        temporary.path(),
        "1.2.3");

    const auto validation =
        service.validate(temporary.path() / L"install", 1024);

    EXPECT_EQ(
        fluxora::installer::SetupValidationStatus::Valid,
        validation.status);
    for (const std::filesystem::directory_entry& entry :
         std::filesystem::directory_iterator(temporary.path()))
    {
        EXPECT_FALSE(
            entry.path().filename().wstring().starts_with(
                L".fluxora-write-probe-"));
    }
}

TEST(SetupBootstrapServiceTests, DiscoversDurablyOwnedCustomInstallForRepair)
{
    fluxora::tests::TempDirectory temporary;
    const std::filesystem::path install =
        temporary.path() / L"Custom" / L"Fluxora";
    std::filesystem::create_directories(install);
    std::ofstream(install / L"Fluxora.exe") << "test executable";
    EmptyRegistry registry;
    registry.writeString(
        fluxora::installer::InstallationOwnershipService::OwnershipPath,
        fluxora::installer::InstallationOwnershipService::OwnerValueName,
        fluxora::installer::InstallationOwnershipService::OwnerId);
    registry.writeString(
        fluxora::installer::InstallationOwnershipService::OwnershipPath,
        fluxora::installer::InstallationOwnershipService::InstallPathValueName,
        (install / L"Fluxora.exe").wstring());
    const fluxora::installer::SetupBootstrapService service(
        registry,
        temporary.path(),
        "1.2.3");

    const auto state = service.bootstrap(1024);

    EXPECT_EQ(install, state.defaultInstallDirectory);
    EXPECT_TRUE(state.isOwnedInstall);
    EXPECT_EQ(fluxora::installer::SetupInstallMode::Repair, state.mode);
}

TEST(SetupBootstrapServiceTests, DetectsManualDowngradeForOwnedInstallation)
{
    fluxora::tests::TempDirectory temporary;
    const std::filesystem::path install =
        temporary.path() / L"Programs" / L"Fluxora";
    fluxora::tests::writeTextFile(
        install / L"Fluxora.exe",
        "installed executable");
    EmptyRegistry registry;
    registry.writeString(
        fluxora::installer::InstallationOwnershipService::OwnershipPath,
        fluxora::installer::InstallationOwnershipService::OwnerValueName,
        fluxora::installer::InstallationOwnershipService::OwnerId);
    registry.writeString(
        fluxora::installer::InstallationOwnershipService::OwnershipPath,
        fluxora::installer::InstallationOwnershipService::InstallPathValueName,
        (install / L"Fluxora.exe").wstring());
    const fluxora::installer::SetupBootstrapService service(
        registry,
        temporary.path(),
        "0.0.2",
        {},
        [](const std::filesystem::path&) {
            return std::string("0.0.10");
        });

    const auto state = service.bootstrap(1024);

    EXPECT_EQ(install, state.defaultInstallDirectory);
    EXPECT_EQ("0.0.10", state.installedVersion);
    EXPECT_EQ(fluxora::installer::SetupInstallMode::Downgrade, state.mode);
    EXPECT_NE(
        std::wstring::npos,
        fluxora::installer::SetupBootstrapService::serialize(state).find(
            L"\"mode\":\"downgrade\""));
}

TEST(SetupBootstrapServiceTests, DetectsManualUpgradeForOwnedInstallation)
{
    fluxora::tests::TempDirectory temporary;
    const std::filesystem::path install =
        temporary.path() / L"Programs" / L"Fluxora";
    fluxora::tests::writeTextFile(
        install / L"Fluxora.exe",
        "installed executable");
    EmptyRegistry registry;
    registry.writeString(
        fluxora::installer::InstallationOwnershipService::OwnershipPath,
        fluxora::installer::InstallationOwnershipService::OwnerValueName,
        fluxora::installer::InstallationOwnershipService::OwnerId);
    registry.writeString(
        fluxora::installer::InstallationOwnershipService::OwnershipPath,
        fluxora::installer::InstallationOwnershipService::InstallPathValueName,
        (install / L"Fluxora.exe").wstring());
    const fluxora::installer::SetupBootstrapService service(
        registry,
        temporary.path(),
        "0.0.3",
        {},
        [](const std::filesystem::path&) {
            return std::string("0.0.2");
        });

    const auto state = service.bootstrap(1024);

    EXPECT_EQ(install, state.defaultInstallDirectory);
    EXPECT_EQ("0.0.2", state.installedVersion);
    EXPECT_EQ(fluxora::installer::SetupInstallMode::Update, state.mode);
}

TEST(SetupBootstrapServiceTests, DetectsSameVersionReinstallAsRepair)
{
    fluxora::tests::TempDirectory temporary;
    const std::filesystem::path install =
        temporary.path() / L"Programs" / L"Fluxora";
    fluxora::tests::writeTextFile(
        install / L"Fluxora.exe",
        "installed executable");
    EmptyRegistry registry;
    registry.writeString(
        fluxora::installer::InstallationOwnershipService::OwnershipPath,
        fluxora::installer::InstallationOwnershipService::OwnerValueName,
        fluxora::installer::InstallationOwnershipService::OwnerId);
    registry.writeString(
        fluxora::installer::InstallationOwnershipService::OwnershipPath,
        fluxora::installer::InstallationOwnershipService::InstallPathValueName,
        (install / L"Fluxora.exe").wstring());
    const fluxora::installer::SetupBootstrapService service(
        registry,
        temporary.path(),
        "0.0.2",
        {},
        [](const std::filesystem::path&) {
            return std::string("0.0.2");
        });

    const auto state = service.bootstrap(1024);

    EXPECT_EQ(install, state.defaultInstallDirectory);
    EXPECT_EQ("0.0.2", state.installedVersion);
    EXPECT_EQ(fluxora::installer::SetupInstallMode::Repair, state.mode);
}

TEST(SetupBootstrapServiceTests, DurableOwnershipAllowsBrokenProtocolRepair)
{
    fluxora::tests::TempDirectory temporary;
    const std::filesystem::path install =
        temporary.path() / L"Programs" / L"Fluxora";
    std::filesystem::create_directories(install);
    std::ofstream(install / L"Fluxora.exe") << "test executable";
    EmptyRegistry registry;
    registry.writeString(
        fluxora::installer::InstallationOwnershipService::OwnershipPath,
        fluxora::installer::InstallationOwnershipService::OwnerValueName,
        fluxora::installer::InstallationOwnershipService::OwnerId);
    registry.writeString(
        fluxora::installer::InstallationOwnershipService::OwnershipPath,
        fluxora::installer::InstallationOwnershipService::InstallPathValueName,
        (install / L"Fluxora.exe").wstring());
    registry.writeString(
        fluxora::installer::ProtocolRegistrationService::ProgIdPath,
        fluxora::installer::ProtocolRegistrationService::OwnerValueName,
        fluxora::installer::ProtocolRegistrationService::OwnerId);
    const fluxora::installer::SetupBootstrapService service(
        registry,
        temporary.path(),
        "1.2.3");

    const auto validation = service.validate(install, 1024);

    EXPECT_EQ(
        fluxora::installer::SetupValidationStatus::Valid,
        validation.status);
    EXPECT_TRUE(validation.isOwnedInstall);
    EXPECT_EQ(fluxora::installer::SetupInstallMode::Repair, validation.mode);
}

TEST(SetupBootstrapServiceTests, RefusesSecondDirectoryWhenOwnedInstallExists)
{
    fluxora::tests::TempDirectory temporary;
    const std::filesystem::path install =
        temporary.path() / L"Programs" / L"Fluxora";
    const std::filesystem::path other =
        temporary.path() / L"Other" / L"Fluxora";
    fluxora::tests::writeTextFile(
        install / L"Fluxora.exe",
        "test executable");
    EmptyRegistry registry;
    registry.writeString(
        fluxora::installer::InstallationOwnershipService::OwnershipPath,
        fluxora::installer::InstallationOwnershipService::OwnerValueName,
        fluxora::installer::InstallationOwnershipService::OwnerId);
    registry.writeString(
        fluxora::installer::InstallationOwnershipService::OwnershipPath,
        fluxora::installer::InstallationOwnershipService::InstallPathValueName,
        (install / L"Fluxora.exe").wstring());
    const fluxora::installer::SetupBootstrapService service(
        registry,
        temporary.path(),
        "1.2.3");

    const auto validation = service.validate(other, 1024);

    EXPECT_EQ(
        fluxora::installer::SetupValidationStatus::ForeignInstall,
        validation.status);
    EXPECT_EQ(
        "setup-owned-install-elsewhere",
        validation.code);
}

TEST(SetupBootstrapServiceTests, OwnedRepairIncludesProtectedDataInDiskRequirement)
{
    fluxora::tests::TempDirectory temporary;
    const std::filesystem::path install =
        temporary.path() / L"Programs" / L"Fluxora";
    fluxora::tests::writeTextFile(install / L"Fluxora.exe", "test executable");
    fluxora::tests::writeTextFile(
        install / L"Downloads" / L"kept.bin",
        std::string(4096, 'd'));
    fluxora::tests::writeTextFile(
        install / L"logs" / L"kept.log",
        std::string(2048, 'l'));
    EmptyRegistry registry;
    registry.writeString(
        fluxora::installer::InstallationOwnershipService::OwnershipPath,
        fluxora::installer::InstallationOwnershipService::OwnerValueName,
        fluxora::installer::InstallationOwnershipService::OwnerId);
    registry.writeString(
        fluxora::installer::InstallationOwnershipService::OwnershipPath,
        fluxora::installer::InstallationOwnershipService::InstallPathValueName,
        (install / L"Fluxora.exe").wstring());
    const fluxora::installer::SetupBootstrapService service(
        registry,
        temporary.path(),
        "1.2.3");

    const auto validation = service.validate(install, 1024);

    EXPECT_EQ(
        1024 + 4096 + 2048 + 64ULL * 1024ULL * 1024ULL,
        validation.requiredBytes);
}

TEST(SetupBootstrapServiceTests, LegacyCapabilityPathFindsCustomInstallWhenProgIdIsBroken)
{
    fluxora::tests::TempDirectory temporary;
    const std::filesystem::path install =
        temporary.path() / L"LegacyCustom";
    std::filesystem::create_directories(install);
    std::ofstream(install / L"Fluxora.exe") << "test executable";
    EmptyRegistry registry;
    registry.writeString(
        fluxora::installer::ProtocolRegistrationService::
            ApplicationRegistrationPath,
        fluxora::installer::ProtocolRegistrationService::OwnerValueName,
        fluxora::installer::ProtocolRegistrationService::OwnerId);
    registry.writeString(
        fluxora::installer::ProtocolRegistrationService::
            ApplicationRegistrationPath,
        fluxora::installer::ProtocolRegistrationService::InstallPathValueName,
        (install / L"Fluxora.exe").wstring());
    const fluxora::installer::SetupBootstrapService service(
        registry,
        temporary.path(),
        "1.2.3");

    const auto state = service.bootstrap(1024);

    EXPECT_EQ(install, state.defaultInstallDirectory);
    EXPECT_TRUE(state.isOwnedInstall);
    EXPECT_EQ(fluxora::installer::SetupInstallMode::Repair, state.mode);
}
