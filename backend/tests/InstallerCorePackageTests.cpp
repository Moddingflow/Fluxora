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
#include <sstream>
#include <stdexcept>
#include <string>
#include <string_view>
#include <vector>

#include <bcrypt.h>
#include <windows.h>

namespace
{
    constexpr std::array<unsigned char, 8> PackageMagic{ 'F', 'L', 'X', 'P', 'K', 'G', '1', '\0' };
    constexpr std::uint32_t PackageVersionWithHashes = 2;
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
    EXPECT_NE(std::wstring(json.data()).find(L"Fluxora.exe"), std::wstring::npos);
    ASSERT_FALSE(progressUpdates.empty());
    EXPECT_NE(progressUpdates.back().find(L"\"phase\":\"completed\""), std::wstring::npos);
}

TEST(InstallerCorePackageTests, InstallPackageStreamIncludesElectronResources)
{
    fluxora::tests::TempDirectory temp;
    const std::filesystem::path installDirectory = temp.path() / L"install";
    const std::vector<unsigned char> package = makePackage({
        {"Fluxora.exe", "electron executable"},
        {"resources/app.asar", "asar payload"},
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
    EXPECT_EQ("electron executable", fluxora::tests::readTextFile(installDirectory / L"Fluxora.exe"));
    EXPECT_EQ("asar payload", fluxora::tests::readTextFile(installDirectory / L"resources" / L"app.asar"));
    EXPECT_NE(std::wstring(json.data()).find(L"Fluxora.exe"), std::wstring::npos);
    ASSERT_FALSE(progressUpdates.empty());
    EXPECT_NE(progressUpdates.back().find(L"\"phase\":\"completed\""), std::wstring::npos);
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
