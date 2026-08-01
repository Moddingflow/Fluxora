#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#ifndef NOMINMAX
#define NOMINMAX
#endif

#include "FluxoraInstaller/FluxoraInstallerApi.hpp"
#include "TestFilesystem.hpp"

#include <gtest/gtest.h>

#include <algorithm>
#include <array>
#include <cstdint>
#include <cstring>
#include <filesystem>
#include <limits>
#include <optional>
#include <sstream>
#include <stdexcept>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

#include <bcrypt.h>
#include <windows.h>

namespace
{
    constexpr std::array<unsigned char, 8> PackageMagic{ 'F', 'L', 'X', 'P', 'K', 'G', '1', '\0' };
    constexpr std::array<unsigned char, 8> TransactionMagic{ 'F', 'L', 'X', 'T', 'X', 'N', '1', '\0' };
    constexpr std::uint32_t PackageVersionWithHashes = 2;
    constexpr std::uint32_t TransactionVersion = 1;
    constexpr std::size_t Sha256HashSize = 32;

    void requireBCrypt(NTSTATUS status, std::string_view operation)
    {
        if (status < 0)
        {
            std::ostringstream stream;
            stream << "BCrypt failed during " << operation
                   << ". status=0x" << std::hex << static_cast<unsigned long>(status);
            throw std::runtime_error(stream.str());
        }
    }

    std::array<unsigned char, Sha256HashSize> sha256(std::string_view content)
    {
        BCRYPT_ALG_HANDLE algorithm = nullptr;
        BCRYPT_HASH_HANDLE hash = nullptr;

        requireBCrypt(
            BCryptOpenAlgorithmProvider(&algorithm, BCRYPT_SHA256_ALGORITHM, nullptr, 0),
            "algorithm open");

        DWORD objectLength = 0;
        DWORD propertyLength = 0;
        requireBCrypt(
            BCryptGetProperty(
                algorithm,
                BCRYPT_OBJECT_LENGTH,
                reinterpret_cast<PUCHAR>(&objectLength),
                sizeof(objectLength),
                &propertyLength,
                0),
            "object length lookup");

        std::vector<unsigned char> hashObject(objectLength);
        requireBCrypt(
            BCryptCreateHash(
                algorithm,
                &hash,
                hashObject.data(),
                static_cast<ULONG>(hashObject.size()),
                nullptr,
                0,
                0),
            "hash creation");

        if (!content.empty())
        {
            requireBCrypt(
                BCryptHashData(
                    hash,
                    reinterpret_cast<PUCHAR>(const_cast<char*>(content.data())),
                    static_cast<ULONG>(content.size()),
                    0),
                "hash update");
        }

        std::array<unsigned char, Sha256HashSize> digest{};
        requireBCrypt(
            BCryptFinishHash(hash, digest.data(), static_cast<ULONG>(digest.size()), 0),
            "hash finish");

        BCryptDestroyHash(hash);
        BCryptCloseAlgorithmProvider(algorithm, 0);
        return digest;
    }

    template <typename T>
    void appendPod(std::vector<unsigned char>& output, T value)
    {
        const auto* first = reinterpret_cast<const unsigned char*>(&value);
        output.insert(output.end(), first, first + sizeof(T));
    }

    void appendBytes(std::vector<unsigned char>& output, const void* data, std::size_t byteCount)
    {
        const auto* first = static_cast<const unsigned char*>(data);
        output.insert(output.end(), first, first + byteCount);
    }

    struct PayloadFile
    {
        std::string path;
        std::string content;
    };

    std::vector<unsigned char> makePackage(const std::vector<PayloadFile>& files)
    {
        std::uint64_t totalBytes = 0;
        for (const PayloadFile& file : files)
        {
            totalBytes += static_cast<std::uint64_t>(file.content.size());
        }

        std::vector<unsigned char> package;
        appendBytes(package, PackageMagic.data(), PackageMagic.size());
        appendPod(package, PackageVersionWithHashes);
        appendPod(package, static_cast<std::uint64_t>(files.size()));
        appendPod(package, totalBytes);

        for (const PayloadFile& file : files)
        {
            const std::array<unsigned char, Sha256HashSize> digest = sha256(file.content);
            appendPod(package, static_cast<std::uint8_t>(1));
            appendPod(package, static_cast<std::uint32_t>(file.path.size()));
            appendBytes(package, file.path.data(), file.path.size());
            appendPod(package, static_cast<std::uint64_t>(file.content.size()));
            appendBytes(package, digest.data(), digest.size());
            appendBytes(package, file.content.data(), file.content.size());
        }

        return package;
    }

    std::uint64_t expandedPayloadBytes(
        const std::vector<unsigned char>& package)
    {
        constexpr std::size_t offset =
            PackageMagic.size() + sizeof(std::uint32_t) + sizeof(std::uint64_t);
        if (package.size() < offset + sizeof(std::uint64_t))
        {
            throw std::invalid_argument("Test package header is truncated.");
        }
        std::uint64_t value = 0;
        std::memcpy(&value, package.data() + offset, sizeof(value));
        return value;
    }

    struct VectorReadState
    {
        const std::vector<unsigned char>* package{nullptr};
        std::size_t offset{0};
        std::size_t maxChunk{std::numeric_limits<std::size_t>::max()};
    };

    std::int64_t readVectorPackage(void* buffer, std::uint64_t byteCount, void* userData)
    {
        auto* state = static_cast<VectorReadState*>(userData);
        if (state == nullptr || state->package == nullptr || buffer == nullptr)
        {
            return -1;
        }

        const std::uint64_t limitedRequest = std::min(
            byteCount,
            static_cast<std::uint64_t>(std::numeric_limits<std::size_t>::max()));
        const std::size_t request = std::min(static_cast<std::size_t>(limitedRequest), state->maxChunk);
        const std::size_t remaining = state->package->size() - state->offset;
        const std::size_t count = std::min(request, remaining);
        if (count == 0)
        {
            return 0;
        }

        std::memcpy(buffer, state->package->data() + state->offset, count);
        state->offset += count;
        return static_cast<std::int64_t>(count);
    }

    void collectProgress(const wchar_t* progressJson, void* userData)
    {
        auto* updates = static_cast<std::vector<std::wstring>*>(userData);
        if (updates != nullptr && progressJson != nullptr)
        {
            updates->push_back(progressJson);
        }
    }

    void throwFromProgress(const wchar_t*, void*)
    {
        throw 42;
    }

    std::int64_t throwFromRead(void*, std::uint64_t, void*)
    {
        throw 42;
    }

    struct InstallCallResult
    {
        int code{FluxoraInstallerResultInstallError};
        std::wstring json;
        std::wstring error;
    };

    InstallCallResult installPackageForTest(
        const std::vector<unsigned char>& package,
        const std::filesystem::path& installDirectory,
        int createDesktopShortcut = 0)
    {
        VectorReadState readState{&package, 0, 17};
        std::array<wchar_t, 4096> json{};
        InstallCallResult result;
        result.code = fluxora_installer_install_package_stream(
            readVectorPackage,
            &readState,
            installDirectory.c_str(),
            createDesktopShortcut,
            nullptr,
            nullptr,
            json.data(),
            static_cast<int>(json.size()));
        result.json = json.data();

        if (result.code != FluxoraInstallerResultOk)
        {
            std::array<wchar_t, 4096> error{};
            if (fluxora_installer_get_last_error(error.data(), static_cast<int>(error.size())) ==
                FluxoraInstallerResultOk)
            {
                result.error = error.data();
            }
        }

        return result;
    }

    struct SetupCancelState
    {
        int queryCount{0};
        int cancelOnQuery{0};
        int boundaryCount{0};
        VectorReadState* readState{nullptr};
        std::size_t cancelWhenOffsetReaches{0};
    };

    int setupCancelCallback(int enterCommitBoundary, void* userData)
    {
        auto* state = static_cast<SetupCancelState*>(userData);
        if (state == nullptr)
        {
            return 0;
        }
        if (enterCommitBoundary != 0)
        {
            ++state->boundaryCount;
            return 0;
        }
        ++state->queryCount;
        const bool queryTriggered =
            state->cancelOnQuery != 0 &&
            state->queryCount >= state->cancelOnQuery;
        const bool offsetTriggered =
            state->readState != nullptr &&
            state->cancelWhenOffsetReaches != 0 &&
            state->readState->offset >= state->cancelWhenOffsetReaches;
        return queryTriggered || offsetTriggered
            ? 1
            : 0;
    }

    InstallCallResult installSetupForTest(
        VectorReadState& readState,
        const std::filesystem::path& installDirectory,
        SetupCancelState* cancelState = nullptr,
        std::optional<std::uint64_t> trustedExpandedBytes = std::nullopt)
    {
        std::array<wchar_t, 4096> json{};
        InstallCallResult result;
        result.code = fluxora_installer_install_setup_payload_stream(
            readVectorPackage,
            &readState,
            installDirectory.c_str(),
            trustedExpandedBytes.value_or(
                expandedPayloadBytes(*readState.package)),
            0,
            L"op_setup_test_abcdef12",
            cancelState == nullptr ? nullptr : setupCancelCallback,
            cancelState,
            nullptr,
            nullptr,
            json.data(),
            static_cast<int>(json.size()));
        result.json = json.data();
        if (result.code != FluxoraInstallerResultOk)
        {
            std::array<wchar_t, 4096> error{};
            if (fluxora_installer_get_last_error(
                    error.data(),
                    static_cast<int>(error.size())) ==
                FluxoraInstallerResultOk)
            {
                result.error = error.data();
            }
        }
        return result;
    }

    std::string transactionIdHex(const std::array<unsigned char, 16>& transactionId)
    {
        constexpr char Digits[] = "0123456789abcdef";
        std::string value;
        value.reserve(transactionId.size() * 2);
        for (const unsigned char byte : transactionId)
        {
            value.push_back(Digits[byte >> 4]);
            value.push_back(Digits[byte & 0x0F]);
        }
        return value;
    }

    std::filesystem::path transactionSibling(
        const std::filesystem::path& installDirectory,
        std::string_view role,
        const std::array<unsigned char, 16>& transactionId)
    {
        const std::string name = "." + installDirectory.filename().string() +
            ".fluxora-" + std::string(role) + "-" + transactionIdHex(transactionId);
        return installDirectory.parent_path() / name;
    }

    std::filesystem::path transactionMarkerPath(const std::filesystem::path& installDirectory)
    {
        return installDirectory.parent_path() /
            ("." + installDirectory.filename().string() + ".fluxora-transaction");
    }

    std::filesystem::path transactionSentinelPath(
        const std::filesystem::path& directory,
        const std::array<unsigned char, 16>& transactionId)
    {
        return directory / (".fluxora-commit-" + transactionIdHex(transactionId) + ".pending");
    }

    std::string makeTransactionMarkerWithNames(
        const std::array<unsigned char, 16>& transactionId,
        bool hadExistingInstall,
        const std::string& stagingName,
        const std::string& backupName)
    {
        std::vector<unsigned char> marker;
        appendBytes(marker, TransactionMagic.data(), TransactionMagic.size());
        appendPod(marker, TransactionVersion);
        appendPod(marker, static_cast<std::uint8_t>(hadExistingInstall ? 1 : 0));
        appendBytes(marker, transactionId.data(), transactionId.size());
        appendPod(marker, static_cast<std::uint32_t>(stagingName.size()));
        appendBytes(marker, stagingName.data(), stagingName.size());
        appendPod(marker, static_cast<std::uint32_t>(backupName.size()));
        appendBytes(marker, backupName.data(), backupName.size());
        return std::string(marker.begin(), marker.end());
    }

    std::string makeTransactionMarker(
        const std::filesystem::path& installDirectory,
        const std::array<unsigned char, 16>& transactionId,
        bool hadExistingInstall)
    {
        return makeTransactionMarkerWithNames(
            transactionId,
            hadExistingInstall,
            transactionSibling(installDirectory, "staging", transactionId).filename().string(),
            transactionSibling(installDirectory, "backup", transactionId).filename().string());
    }
}

TEST(InstallerCorePackageTests, InstallPackageStreamInstallsV2Payload)
{
    fluxora::tests::TempDirectory temp;
    const std::filesystem::path installDirectory = temp.path() / L"install";
    const std::vector<unsigned char> package = makePackage({
        {"Fluxora.exe", "fake executable"},
        {"data/config.txt", "profile=data"}
    });
    VectorReadState readState{&package, 0, 17};
    std::vector<std::wstring> progressUpdates;
    std::array<wchar_t, 4096> json{};

    const int result = fluxora_installer_install_package_stream(
        readVectorPackage,
        &readState,
        installDirectory.c_str(),
        0,
        collectProgress,
        &progressUpdates,
        json.data(),
        static_cast<int>(json.size()));

    EXPECT_EQ(FluxoraInstallerResultOk, result);
    EXPECT_EQ("fake executable", fluxora::tests::readTextFile(installDirectory / L"Fluxora.exe"));
    EXPECT_EQ("profile=data", fluxora::tests::readTextFile(installDirectory / L"data" / L"config.txt"));
    ASSERT_TRUE(std::filesystem::is_directory(installDirectory / L"Downloads"));
    EXPECT_TRUE(std::filesystem::is_empty(installDirectory / L"Downloads"));
    EXPECT_NE(std::wstring(json.data()).find(L"Fluxora.exe"), std::wstring::npos);
    ASSERT_FALSE(progressUpdates.empty());
    EXPECT_NE(progressUpdates.back().find(L"\"phase\":\"completed\""), std::wstring::npos);
}

TEST(InstallerCorePackageTests, NativeOperationContextRejectsUnsafeOrOversizedIds)
{
    EXPECT_EQ(
        FluxoraInstallerResultInvalidArgument,
        fluxora_installer_set_operation_context(L"unsafe\noperation"));
    EXPECT_EQ(
        FluxoraInstallerResultInvalidArgument,
        fluxora_installer_set_operation_context(
            std::wstring(129, L'a').c_str()));
    EXPECT_EQ(
        FluxoraInstallerResultOk,
        fluxora_installer_set_operation_context(L"op_safe_abcdef12"));
    EXPECT_EQ(
        FluxoraInstallerResultOk,
        fluxora_installer_set_operation_context(nullptr));
}

TEST(InstallerCorePackageTests, InstallPackageStreamIncludesTauriResources)
{
    fluxora::tests::TempDirectory temp;
    const std::filesystem::path installDirectory = temp.path() / L"install";
    const std::vector<unsigned char> package = makePackage({
        {"Fluxora.exe", "tauri executable"},
        {"resources/native/FluxoraCore.dll", "core payload"},
        {"resources/native/FluxoraBridgeHost.exe", "bridge host"}
    });
    VectorReadState readState{&package, 0, 23};
    std::vector<std::wstring> progressUpdates;
    std::array<wchar_t, 4096> json{};

    const int result = fluxora_installer_install_package_stream(
        readVectorPackage,
        &readState,
        installDirectory.c_str(),
        0,
        collectProgress,
        &progressUpdates,
        json.data(),
        static_cast<int>(json.size()));

    EXPECT_EQ(FluxoraInstallerResultOk, result);
    EXPECT_EQ("tauri executable", fluxora::tests::readTextFile(installDirectory / L"Fluxora.exe"));
    EXPECT_EQ("core payload", fluxora::tests::readTextFile(installDirectory / L"resources" / L"native" / L"FluxoraCore.dll"));
    EXPECT_NE(std::wstring(json.data()).find(L"Fluxora.exe"), std::wstring::npos);
    ASSERT_FALSE(progressUpdates.empty());
    EXPECT_NE(progressUpdates.back().find(L"\"phase\":\"completed\""), std::wstring::npos);
}

TEST(InstallerCorePackageTests, SafeSetupRefusesForeignDirectoryBeforeReadingPayload)
{
    fluxora::tests::TempDirectory temporary;
    const std::filesystem::path installDirectory =
        temporary.path() / L"foreign";
    std::filesystem::create_directories(installDirectory);
    fluxora::tests::writeTextFile(
        installDirectory / L"foreign.txt",
        "keep");
    const std::vector<unsigned char> package = makePackage({
        {"Fluxora.exe", "new executable"}});
    VectorReadState readState{&package, 0, 17};

    const InstallCallResult result =
        installSetupForTest(readState, installDirectory);

    EXPECT_EQ(FluxoraInstallerResultInvalidArgument, result.code);
    EXPECT_EQ(0u, readState.offset);
    EXPECT_EQ(
        "keep",
        fluxora::tests::readTextFile(installDirectory / L"foreign.txt"));
    EXPECT_FALSE(std::filesystem::exists(
        installDirectory / L"Fluxora.exe"));
}

TEST(InstallerCorePackageTests, SetupCAbiReturnsVersionedBootstrapAndValidationSchemas)
{
    fluxora::tests::TempDirectory temporary;
    std::array<wchar_t, 4096> bootstrap{};
    std::array<wchar_t, 4096> validation{};

    EXPECT_EQ(
        FluxoraInstallerResultOk,
        fluxora_installer_get_setup_bootstrap_state(
            1024,
            bootstrap.data(),
            static_cast<int>(bootstrap.size())));
    EXPECT_EQ(
        FluxoraInstallerResultOk,
        fluxora_installer_validate_install_options(
            (temporary.path() / L"install").c_str(),
            1024,
            validation.data(),
            static_cast<int>(validation.size())));

    const std::wstring bootstrapJson(bootstrap.data());
    const std::wstring validationJson(validation.data());
    EXPECT_NE(
        std::wstring::npos,
        bootstrapJson.find(L"\"schemaVersion\":1"));
    EXPECT_NE(
        std::wstring::npos,
        bootstrapJson.find(L"\"requiredBytes\":"));
    EXPECT_NE(
        std::wstring::npos,
        validationJson.find(L"\"schemaVersion\":1"));
    EXPECT_NE(
        std::wstring::npos,
        validationJson.find(L"\"status\":\"valid\""));
    EXPECT_NE(
        std::wstring::npos,
        validationJson.find(L"\"code\":\"ok\""));
}

TEST(InstallerCorePackageTests, SafeSetupRejectsSmallResultBufferBeforeReadingPayload)
{
    fluxora::tests::TempDirectory temporary;
    const std::vector<unsigned char> package = makePackage({
        {"Fluxora.exe", "new executable"}});
    VectorReadState readState{&package, 0, 17};
    std::array<wchar_t, 1> json{};

    const int result = fluxora_installer_install_setup_payload_stream(
        readVectorPackage,
        &readState,
        (temporary.path() / L"install").c_str(),
        expandedPayloadBytes(package),
        0,
        L"op_small_buffer_abcdef12",
        nullptr,
        nullptr,
        nullptr,
        nullptr,
        json.data(),
        static_cast<int>(json.size()));

    EXPECT_EQ(FluxoraInstallerResultBufferTooSmall, result);
    EXPECT_EQ(0u, readState.offset);
    EXPECT_FALSE(std::filesystem::exists(
        temporary.path() / L"install"));
}

TEST(InstallerCorePackageTests, SafeSetupHonorsCancellationAfterFinalPayloadByteBeforeCommit)
{
    fluxora::tests::TempDirectory temporary;
    const std::filesystem::path installDirectory =
        temporary.path() / L"install";
    const std::vector<unsigned char> package = makePackage({
        {"Fluxora.exe", "new executable"},
        {"resources/legal/en/privacy.md", "privacy"}});
    VectorReadState readState{&package, 0, 17};
    SetupCancelState cancel;
    cancel.readState = &readState;
    cancel.cancelWhenOffsetReaches = package.size();

    const InstallCallResult result =
        installSetupForTest(readState, installDirectory, &cancel);

    EXPECT_EQ(FluxoraInstallerResultCancelled, result.code)
        << testing::PrintToString(result.error);
    EXPECT_EQ(package.size(), readState.offset);
    EXPECT_EQ(0, cancel.boundaryCount);
    EXPECT_FALSE(std::filesystem::exists(installDirectory));
}

TEST(InstallerCorePackageTests, SafeSetupStopsStreamPromptlyOnMidPayloadCancellation)
{
    fluxora::tests::TempDirectory temporary;
    const std::filesystem::path installDirectory =
        temporary.path() / L"install";
    const std::vector<unsigned char> package = makePackage({
        {"Fluxora.exe", std::string(1024 * 1024, 'x')}});
    VectorReadState readState{&package, 0, 4096};
    SetupCancelState cancel;
    cancel.readState = &readState;
    cancel.cancelWhenOffsetReaches = 64 * 1024;

    const InstallCallResult result =
        installSetupForTest(readState, installDirectory, &cancel);

    EXPECT_EQ(FluxoraInstallerResultCancelled, result.code)
        << testing::PrintToString(result.error);
    EXPECT_GE(readState.offset, 64u * 1024u);
    EXPECT_LE(readState.offset, 68u * 1024u);
    EXPECT_LT(readState.offset, package.size());
    EXPECT_EQ(0, cancel.boundaryCount);
    EXPECT_FALSE(std::filesystem::exists(installDirectory));
}

TEST(InstallerCorePackageTests, SafeSetupRejectsMismatchedExpandedSizeBeforeExtraction)
{
    fluxora::tests::TempDirectory temporary;
    const std::filesystem::path installDirectory =
        temporary.path() / L"install";
    const std::vector<unsigned char> package = makePackage({
        {"Fluxora.exe", std::string(1024 * 1024, 'x')}});
    VectorReadState readState{&package, 0, 4096};

    const InstallCallResult result =
        installSetupForTest(readState, installDirectory, nullptr, 1);

    EXPECT_EQ(FluxoraInstallerResultInvalidArgument, result.code);
    EXPECT_EQ(
        PackageMagic.size() + sizeof(std::uint32_t) +
            (2 * sizeof(std::uint64_t)),
        readState.offset);
    EXPECT_FALSE(std::filesystem::exists(installDirectory));
}

TEST(InstallerCorePackageTests, CAbiContainsNonStandardReadCallbackExceptions)
{
    fluxora::tests::TempDirectory temporary;
    std::array<wchar_t, 512> json{};

    const int result = fluxora_installer_install_setup_payload_stream(
        throwFromRead,
        nullptr,
        (temporary.path() / L"install").c_str(),
        1,
        0,
        L"op_nonstd_read_abcdef12",
        nullptr,
        nullptr,
        nullptr,
        nullptr,
        json.data(),
        static_cast<int>(json.size()));

    EXPECT_EQ(FluxoraInstallerResultInstallError, result);
}

TEST(InstallerCorePackageTests, CAbiContainsNonStandardProgressCallbackExceptions)
{
    fluxora::tests::TempDirectory temporary;
    const std::vector<unsigned char> package = makePackage({
        {"Fluxora.exe", "new executable"}});
    VectorReadState readState{&package, 0, 17};
    std::array<wchar_t, 4096> json{};

    const int result = fluxora_installer_install_package_stream(
        readVectorPackage,
        &readState,
        (temporary.path() / L"install").c_str(),
        0,
        throwFromProgress,
        nullptr,
        json.data(),
        static_cast<int>(json.size()));

    EXPECT_EQ(FluxoraInstallerResultOk, result);
}

TEST(InstallerCorePackageTests, InstallPackageStreamRejectsTamperedPayload)
{
    fluxora::tests::TempDirectory temp;
    const std::filesystem::path installDirectory = temp.path() / L"install";
    std::vector<unsigned char> package = makePackage({
        {"Fluxora.exe", "fake executable"}
    });
    package.back() ^= 0x01;

    VectorReadState readState{&package, 0, 31};
    std::array<wchar_t, 4096> json{};

    const int result = fluxora_installer_install_package_stream(
        readVectorPackage,
        &readState,
        installDirectory.c_str(),
        0,
        nullptr,
        nullptr,
        json.data(),
        static_cast<int>(json.size()));

    EXPECT_EQ(FluxoraInstallerResultInstallError, result);

    std::array<wchar_t, 1024> error{};
    ASSERT_EQ(
        FluxoraInstallerResultOk,
        fluxora_installer_get_last_error(error.data(), static_cast<int>(error.size())));
    EXPECT_NE(std::wstring(error.data()).find(L"Payload integrity check failed"), std::wstring::npos);
}

TEST(InstallerCorePackageTests, TamperedPackagePreservesExistingInstallationWithoutStagingLeftovers)
{
    fluxora::tests::TempDirectory temp;
    const std::filesystem::path installDirectory = temp.path() / L"install";
    std::string existingExecutable = "existing executable";
    existingExecutable.push_back('\0');
    existingExecutable += "preserved bytes";
    const std::string existingConfiguration = "keep=user configuration";
    fluxora::tests::writeTextFile(installDirectory / L"Fluxora.exe", existingExecutable);
    fluxora::tests::writeTextFile(
        installDirectory / L"data" / L"user-config.txt",
        existingConfiguration);

    std::vector<unsigned char> package = makePackage({
        {"new-only.txt", "must not reach the live installation"},
        {"Fluxora.exe", "tampered replacement executable"}
    });
    package.back() ^= 0x01;

    VectorReadState readState{&package, 0, 19};
    std::array<wchar_t, 4096> json{};

    const int result = fluxora_installer_install_package_stream(
        readVectorPackage,
        &readState,
        installDirectory.c_str(),
        0,
        nullptr,
        nullptr,
        json.data(),
        static_cast<int>(json.size()));

    EXPECT_EQ(FluxoraInstallerResultInstallError, result);
    EXPECT_EQ(
        existingExecutable,
        fluxora::tests::readTextFile(installDirectory / L"Fluxora.exe"));
    EXPECT_EQ(
        existingConfiguration,
        fluxora::tests::readTextFile(installDirectory / L"data" / L"user-config.txt"));
    EXPECT_FALSE(std::filesystem::exists(installDirectory / L"new-only.txt"));

    std::vector<std::filesystem::path> rootEntries;
    for (const std::filesystem::directory_entry& entry : std::filesystem::directory_iterator(temp.path()))
    {
        rootEntries.push_back(entry.path().lexically_normal());
    }

    ASSERT_EQ(1u, rootEntries.size());
    EXPECT_EQ(installDirectory.lexically_normal(), rootEntries.front());
}

TEST(InstallerCorePackageTests, ValidPackageAtomicallyReplacesExistingInstallation)
{
    fluxora::tests::TempDirectory temp;
    const std::filesystem::path installDirectory = temp.path() / L"install";
    fluxora::tests::writeTextFile(installDirectory / L"Fluxora.exe", "old executable");
    fluxora::tests::writeTextFile(installDirectory / L"old-only.txt", "obsolete payload");
    fluxora::tests::writeTextFile(
        installDirectory / L"Downloads" / L"skyrimse" / L"kept-archive.7z",
        "global archive bytes");

    const std::vector<unsigned char> package = makePackage({
        {"Fluxora.exe", "replacement executable"},
        {"resources/native/FluxoraCore.dll", "replacement core"}
    });
    VectorReadState readState{&package, 0, 13};
    std::array<wchar_t, 4096> json{};

    const int result = fluxora_installer_install_package_stream(
        readVectorPackage,
        &readState,
        installDirectory.c_str(),
        0,
        nullptr,
        nullptr,
        json.data(),
        static_cast<int>(json.size()));

    EXPECT_EQ(FluxoraInstallerResultOk, result);
    EXPECT_EQ(
        "replacement executable",
        fluxora::tests::readTextFile(installDirectory / L"Fluxora.exe"));
    EXPECT_EQ(
        "replacement core",
        fluxora::tests::readTextFile(
            installDirectory / L"resources" / L"native" / L"FluxoraCore.dll"));
    EXPECT_EQ(
        "global archive bytes",
        fluxora::tests::readTextFile(
            installDirectory / L"Downloads" / L"skyrimse" / L"kept-archive.7z"));
    EXPECT_FALSE(std::filesystem::exists(installDirectory / L"old-only.txt"));

    std::vector<std::filesystem::path> rootEntries;
    for (const std::filesystem::directory_entry& entry : std::filesystem::directory_iterator(temp.path()))
    {
        rootEntries.push_back(entry.path().lexically_normal());
    }

    ASSERT_EQ(1u, rootEntries.size());
    EXPECT_EQ(installDirectory.lexically_normal(), rootEntries.front());
}

class ReservedWindowsPackagePathTest : public testing::TestWithParam<const char*>
{
};

TEST_P(ReservedWindowsPackagePathTest, RejectsReservedDeviceComponent)
{
    fluxora::tests::TempDirectory temp;
    const std::filesystem::path installDirectory = temp.path() / L"install";
    const std::vector<unsigned char> package = makePackage({
        {"Fluxora.exe", "executable"},
        {GetParam(), "unsafe payload"}
    });

    const InstallCallResult result = installPackageForTest(package, installDirectory);

    EXPECT_EQ(FluxoraInstallerResultInstallError, result.code);
    EXPECT_NE(result.error.find(L"Windows-reserved"), std::wstring::npos);
    EXPECT_FALSE(std::filesystem::exists(installDirectory));
}

INSTANTIATE_TEST_SUITE_P(
    ReservedDeviceNames,
    ReservedWindowsPackagePathTest,
    testing::Values(
        "CON",
        "assets/con.txt",
        "NUL.txt",
        "drivers/COM1.sys",
        "lpt9/config.ini",
        "Aux/data.bin"));

class TrailingAliasPackagePathTest : public testing::TestWithParam<const char*>
{
};

TEST_P(TrailingAliasPackagePathTest, RejectsComponentEndingInDotOrSpace)
{
    fluxora::tests::TempDirectory temp;
    const std::filesystem::path installDirectory = temp.path() / L"install";
    const std::vector<unsigned char> package = makePackage({
        {"Fluxora.exe", "executable"},
        {GetParam(), "unsafe payload"}
    });

    const InstallCallResult result = installPackageForTest(package, installDirectory);

    EXPECT_EQ(FluxoraInstallerResultInstallError, result.code);
    EXPECT_NE(result.error.find(L"trailing dot or space"), std::wstring::npos);
    EXPECT_FALSE(std::filesystem::exists(installDirectory));
}

INSTANTIATE_TEST_SUITE_P(
    WindowsPathAliases,
    TrailingAliasPackagePathTest,
    testing::Values(
        "settings.",
        "settings ",
        "assets./settings.json",
        "assets /settings.json"));

TEST(InstallerCorePackageTests, RejectsWindowsNormalizedDuplicateOutputTargets)
{
    const std::array<std::pair<const char*, const char*>, 3> duplicatePaths{{
        {"data/config.json", "DATA/CONFIG.JSON"},
        {"assets\\icon.png", "assets/icon.png"},
        {"readme.txt", "readme.txt"}
    }};

    for (const auto& [firstPath, secondPath] : duplicatePaths)
    {
        SCOPED_TRACE(std::string(firstPath) + " vs " + secondPath);
        fluxora::tests::TempDirectory temp;
        const std::filesystem::path installDirectory = temp.path() / L"install";
        const std::vector<unsigned char> package = makePackage({
            {"Fluxora.exe", "executable"},
            {firstPath, "first payload"},
            {secondPath, "second payload"}
        });

        const InstallCallResult result = installPackageForTest(package, installDirectory);

        EXPECT_EQ(FluxoraInstallerResultInstallError, result.code);
        EXPECT_NE(result.error.find(L"duplicate output path"), std::wstring::npos);
        EXPECT_FALSE(std::filesystem::exists(installDirectory));
    }
}

TEST(InstallerCorePackageTests, RejectsPayloadEntriesInsideProtectedDownloadsDirectory)
{
    fluxora::tests::TempDirectory temp;
    const std::filesystem::path installDirectory = temp.path() / L"install";
    const std::vector<unsigned char> package = makePackage({
        {"Fluxora.exe", "executable"},
        {"Downloads/skyrimse/injected.7z", "untrusted archive"}
    });

    const InstallCallResult result = installPackageForTest(package, installDirectory);

    EXPECT_EQ(FluxoraInstallerResultInstallError, result.code);
    EXPECT_NE(result.error.find(L"protected Downloads directory"), std::wstring::npos);
    EXPECT_FALSE(std::filesystem::exists(installDirectory));
}

TEST(InstallerCorePackageTests, RejectsJunctionInstallRootWithoutTouchingItsTarget)
{
    fluxora::tests::TempDirectory temp;
    const std::filesystem::path targetDirectory = temp.path() / L"junction-target";
    const std::filesystem::path installJunction = temp.path() / L"install-junction";
    fluxora::tests::writeTextFile(targetDirectory / L"Fluxora.exe", "existing executable");

    std::error_code junctionError;
    if (!fluxora::tests::createDirectoryJunction(targetDirectory, installJunction, junctionError))
    {
        GTEST_SKIP() << "Directory junctions are unavailable in this test environment: "
                     << junctionError.message();
    }

    const std::vector<unsigned char> package = makePackage({
        {"Fluxora.exe", "replacement executable"}
    });

    const InstallCallResult result = installPackageForTest(package, installJunction);

    EXPECT_EQ(FluxoraInstallerResultInvalidArgument, result.code);
    EXPECT_NE(result.error.find(L"junction or reparse point"), std::wstring::npos);
    EXPECT_EQ(
        "existing executable",
        fluxora::tests::readTextFile(targetDirectory / L"Fluxora.exe"));
    EXPECT_TRUE(std::filesystem::exists(installJunction));
}

TEST(InstallerCorePackageTests, RejectsDownloadsJunctionWithoutTouchingTheLiveInstallationOrTarget)
{
    fluxora::tests::TempDirectory temp;
    const std::filesystem::path installDirectory = temp.path() / L"install";
    const std::filesystem::path targetDirectory = temp.path() / L"downloads-target";
    const std::filesystem::path downloadsJunction = installDirectory / L"Downloads";
    fluxora::tests::writeTextFile(installDirectory / L"Fluxora.exe", "existing executable");
    fluxora::tests::writeTextFile(targetDirectory / L"sentinel.7z", "outside archive");

    std::error_code junctionError;
    if (!fluxora::tests::createDirectoryJunction(targetDirectory, downloadsJunction, junctionError))
    {
        GTEST_SKIP() << "Directory junctions are unavailable in this test environment: "
                     << junctionError.message();
    }

    const std::vector<unsigned char> package = makePackage({
        {"Fluxora.exe", "replacement executable"}
    });

    const InstallCallResult result = installPackageForTest(package, installDirectory);

    EXPECT_EQ(FluxoraInstallerResultInstallError, result.code);
    EXPECT_NE(result.error.find(L"reparse point"), std::wstring::npos);
    EXPECT_EQ(
        "existing executable",
        fluxora::tests::readTextFile(installDirectory / L"Fluxora.exe"));
    EXPECT_EQ(
        "outside archive",
        fluxora::tests::readTextFile(targetDirectory / L"sentinel.7z"));
    EXPECT_TRUE(std::filesystem::exists(downloadsJunction));

    std::filesystem::remove(downloadsJunction);
}

TEST(InstallerCorePackageTests, ValidationRecoversOldLiveAfterCrashBetweenDirectoryRenames)
{
    fluxora::tests::TempDirectory temp;
    const std::filesystem::path installDirectory = temp.path() / L"install";
    const std::array<unsigned char, 16> transactionId{
        0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17,
        0x18, 0x19, 0x1A, 0x1B, 0x1C, 0x1D, 0x1E, 0x1F
    };
    const std::filesystem::path stagingDirectory = transactionSibling(
        installDirectory,
        "staging",
        transactionId);
    const std::filesystem::path backupDirectory = transactionSibling(
        installDirectory,
        "backup",
        transactionId);
    const std::filesystem::path markerPath = transactionMarkerPath(installDirectory);

    fluxora::tests::writeTextFile(backupDirectory / L"Fluxora.exe", "old executable");
    fluxora::tests::writeTextFile(
        backupDirectory / L"Downloads" / L"skyrimse" / L"archive.7z",
        "preserved archive");
    fluxora::tests::writeTextFile(stagingDirectory / L"Fluxora.exe", "new executable");
    fluxora::tests::writeTextFile(
        transactionSentinelPath(stagingDirectory, transactionId),
        transactionIdHex(transactionId));
    fluxora::tests::writeTextFile(
        markerPath,
        makeTransactionMarker(installDirectory, transactionId, true));

    std::array<wchar_t, 128> message{};
    const int result = fluxora_installer_validate_install_directory(
        installDirectory.c_str(),
        message.data(),
        static_cast<int>(message.size()));

    EXPECT_EQ(FluxoraInstallerResultOk, result);
    EXPECT_EQ("old executable", fluxora::tests::readTextFile(installDirectory / L"Fluxora.exe"));
    EXPECT_EQ(
        "preserved archive",
        fluxora::tests::readTextFile(
            installDirectory / L"Downloads" / L"skyrimse" / L"archive.7z"));
    EXPECT_FALSE(std::filesystem::exists(stagingDirectory));
    EXPECT_FALSE(std::filesystem::exists(backupDirectory));
    EXPECT_FALSE(std::filesystem::exists(markerPath));
}

TEST(InstallerCorePackageTests, ValidationFinalizesNewLiveAfterCrashFollowingCommitRename)
{
    fluxora::tests::TempDirectory temp;
    const std::filesystem::path installDirectory = temp.path() / L"install";
    const std::array<unsigned char, 16> transactionId{
        0x20, 0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27,
        0x28, 0x29, 0x2A, 0x2B, 0x2C, 0x2D, 0x2E, 0x2F
    };
    const std::filesystem::path stagingDirectory = transactionSibling(
        installDirectory,
        "staging",
        transactionId);
    const std::filesystem::path backupDirectory = transactionSibling(
        installDirectory,
        "backup",
        transactionId);
    const std::filesystem::path markerPath = transactionMarkerPath(installDirectory);
    const std::filesystem::path liveSentinel = transactionSentinelPath(
        installDirectory,
        transactionId);

    fluxora::tests::writeTextFile(backupDirectory / L"Fluxora.exe", "old executable");
    fluxora::tests::writeTextFile(installDirectory / L"Fluxora.exe", "new executable");
    fluxora::tests::writeTextFile(liveSentinel, transactionIdHex(transactionId));
    fluxora::tests::writeTextFile(
        markerPath,
        makeTransactionMarker(installDirectory, transactionId, true));

    std::array<wchar_t, 128> message{};
    const int result = fluxora_installer_validate_install_directory(
        installDirectory.c_str(),
        message.data(),
        static_cast<int>(message.size()));

    EXPECT_EQ(FluxoraInstallerResultOk, result);
    EXPECT_EQ("new executable", fluxora::tests::readTextFile(installDirectory / L"Fluxora.exe"));
    EXPECT_FALSE(std::filesystem::exists(stagingDirectory));
    EXPECT_FALSE(std::filesystem::exists(backupDirectory));
    EXPECT_FALSE(std::filesystem::exists(liveSentinel));
    EXPECT_FALSE(std::filesystem::exists(markerPath));
}

TEST(InstallerCorePackageTests, ValidationRejectsTransactionMarkerWithEscapingSiblingPath)
{
    fluxora::tests::TempDirectory temp;
    const std::filesystem::path installDirectory = temp.path() / L"install";
    const std::filesystem::path victimDirectory = temp.path() / L"victim";
    const std::filesystem::path markerPath = transactionMarkerPath(installDirectory);
    const std::array<unsigned char, 16> transactionId{
        0x30, 0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37,
        0x38, 0x39, 0x3A, 0x3B, 0x3C, 0x3D, 0x3E, 0x3F
    };
    const std::string backupName = transactionSibling(
        installDirectory,
        "backup",
        transactionId).filename().string();
    fluxora::tests::writeTextFile(victimDirectory / L"keep.txt", "preserved");
    fluxora::tests::writeTextFile(
        markerPath,
        makeTransactionMarkerWithNames(
            transactionId,
            true,
            "../victim",
            backupName));

    std::array<wchar_t, 128> message{};
    const int result = fluxora_installer_validate_install_directory(
        installDirectory.c_str(),
        message.data(),
        static_cast<int>(message.size()));
    std::array<wchar_t, 1024> error{};
    ASSERT_EQ(
        FluxoraInstallerResultOk,
        fluxora_installer_get_last_error(error.data(), static_cast<int>(error.size())));

    EXPECT_EQ(FluxoraInstallerResultInstallError, result);
    EXPECT_NE(std::wstring(error.data()).find(L"untrusted staging path"), std::wstring::npos);
    EXPECT_EQ("preserved", fluxora::tests::readTextFile(victimDirectory / L"keep.txt"));
    EXPECT_TRUE(std::filesystem::exists(markerPath));
    EXPECT_FALSE(std::filesystem::exists(installDirectory));
}

TEST(InstallerCorePackageTests, ValidationCleansAbandonedStagingBeforeFirstRename)
{
    fluxora::tests::TempDirectory temp;
    const std::filesystem::path installDirectory = temp.path() / L"install";
    const std::array<unsigned char, 16> transactionId{
        0x40, 0x41, 0x42, 0x43, 0x44, 0x45, 0x46, 0x47,
        0x48, 0x49, 0x4A, 0x4B, 0x4C, 0x4D, 0x4E, 0x4F
    };
    const std::filesystem::path stagingDirectory = transactionSibling(
        installDirectory,
        "staging",
        transactionId);
    const std::filesystem::path markerPath = transactionMarkerPath(installDirectory);
    fluxora::tests::writeTextFile(installDirectory / L"Fluxora.exe", "old executable");
    fluxora::tests::writeTextFile(stagingDirectory / L"Fluxora.exe", "new executable");
    fluxora::tests::writeTextFile(
        transactionSentinelPath(stagingDirectory, transactionId),
        transactionIdHex(transactionId));
    fluxora::tests::writeTextFile(
        markerPath,
        makeTransactionMarker(installDirectory, transactionId, true));

    std::array<wchar_t, 128> message{};
    const int result = fluxora_installer_validate_install_directory(
        installDirectory.c_str(),
        message.data(),
        static_cast<int>(message.size()));

    EXPECT_EQ(FluxoraInstallerResultOk, result);
    EXPECT_EQ("old executable", fluxora::tests::readTextFile(installDirectory / L"Fluxora.exe"));
    EXPECT_FALSE(std::filesystem::exists(stagingDirectory));
    EXPECT_FALSE(std::filesystem::exists(markerPath));
}
