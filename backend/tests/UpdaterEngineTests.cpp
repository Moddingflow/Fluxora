#include "FluxoraInstaller/UpdateEngine.hpp"
#include "FluxoraInstaller/InstallerDirectoryTransaction.hpp"
#include "FluxoraInstaller/FluxoraInstallerApi.hpp"
#include "TestFilesystem.hpp"

#include <gtest/gtest.h>

#include <algorithm>
#include <array>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <limits>
#include <sstream>
#include <span>
#include <string>
#include <utility>
#include <vector>

#include <bcrypt.h>
#include <windows.h>

namespace
{
    constexpr std::string_view PublicKeyPem = R"(-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEaQDAtSbYVspB7YO+k7g4XHnt5nsh
H052HA5oW4YX3tdv1x+dSraP6UmK4A2NLAt0LBwgIHU+suNRobwe46MgKQ==
-----END PUBLIC KEY-----
)";

    constexpr std::string_view SignedManifest =
        R"({"schemaVersion":1,"channel":"stable","version":"1.2.3","target":"win-x64","applicationExecutable":"Fluxora.exe","fileManifestSha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","files":[],"assets":[]})";

    constexpr std::string_view SignatureBase64 =
        "Wpf5S+PjCPV2MfLi/PdN/PHoHfA2uTW5gU8NJC00VC1yPgJFyqVaylvGeGpcnB4K1hRvltzJzuDnw2y3KW8Lpg==";

    constexpr std::string_view AssetManifest =
        R"({"schemaVersion":1,"channel":"stable","version":"1.2.3","target":"win-x64","applicationExecutable":"Fluxora.exe","fileManifestSha256":"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855","files":[],"assets":[{"kind":"full","fromVersion":null,"url":"https://github.com/Fluxora/Fluxora/releases/download/v1.2.3/Fluxora-1.2.3-win-x64-full.flxupd","size":20,"sha256":"27c85cdfadf02501e7ecf62a50f150163f2be17e2d8cec65b400060819986fb2","baseFileManifestSha256":null,"targetFileManifestSha256":"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"}]})";

    constexpr std::string_view AssetManifestSignature =
        "+n9gZxUbBtzQjWEB9s/RGPKpTuxkerxR269ioHmSCpc5T3X6k++QuC3KxvSB7ebj0F5+5MjB21wpNqe4EQljXg==";

    std::span<const std::byte> asBytes(std::string_view value)
    {
        return std::as_bytes(std::span(value.data(), value.size()));
    }

    void writeBinaryFile(const std::filesystem::path& path, std::string_view bytes)
    {
        std::filesystem::create_directories(path.parent_path());
        std::ofstream output(path, std::ios::binary | std::ios::trunc);
        output.write(bytes.data(), static_cast<std::streamsize>(bytes.size()));
        if (!output)
        {
            throw std::runtime_error("Failed to write updater test fixture.");
        }
    }

    fluxora::installer::UpdateRequest fullRequest(const std::filesystem::path& root)
    {
        fluxora::installer::UpdateRequest request;
        request.manifestPath = root / L"manifest.json";
        request.signaturePath = root / L"manifest.sig";
        request.packagePath = root / L"package.flxupd";
        request.installDirectory = root / L"install";
        request.currentVersion = "1.2.2";
        request.targetVersion = "1.2.3";
        request.target = "win-x64";
        request.assetKind = fluxora::installer::UpdateAssetKind::Full;
        request.expectedPackageSha256 =
            "27c85cdfadf02501e7ecf62a50f150163f2be17e2d8cec65b400060819986fb2";
        request.expectedPackageSize = 20;
        request.applicationExecutable = L"Fluxora.exe";
        return request;
    }

    void writeSignedAssetFixture(const std::filesystem::path& root)
    {
        writeBinaryFile(root / L"manifest.json", AssetManifest);
        writeBinaryFile(root / L"manifest.sig", AssetManifestSignature);
        writeBinaryFile(root / L"package.flxupd", "signed package bytes");
    }

    void requireBCrypt(NTSTATUS status)
    {
        if (status < 0)
        {
            throw std::runtime_error("BCrypt failed in updater test fixture.");
        }
    }

    std::array<unsigned char, 32> testSha256(std::string_view bytes)
    {
        BCRYPT_ALG_HANDLE algorithm = nullptr;
        BCRYPT_HASH_HANDLE hash = nullptr;
        requireBCrypt(BCryptOpenAlgorithmProvider(&algorithm, BCRYPT_SHA256_ALGORITHM, nullptr, 0));
        DWORD objectBytes = 0;
        DWORD resultBytes = 0;
        requireBCrypt(BCryptGetProperty(
            algorithm,
            BCRYPT_OBJECT_LENGTH,
            reinterpret_cast<PUCHAR>(&objectBytes),
            sizeof(objectBytes),
            &resultBytes,
            0));
        std::vector<unsigned char> object(objectBytes);
        requireBCrypt(BCryptCreateHash(
            algorithm,
            &hash,
            object.data(),
            static_cast<ULONG>(object.size()),
            nullptr,
            0,
            0));
        if (!bytes.empty())
        {
            requireBCrypt(BCryptHashData(
                hash,
                reinterpret_cast<PUCHAR>(const_cast<char*>(bytes.data())),
                static_cast<ULONG>(bytes.size()),
                0));
        }
        std::array<unsigned char, 32> digest{};
        requireBCrypt(BCryptFinishHash(hash, digest.data(), static_cast<ULONG>(digest.size()), 0));
        BCryptDestroyHash(hash);
        BCryptCloseAlgorithmProvider(algorithm, 0);
        return digest;
    }

    std::string testHex(std::span<const unsigned char> bytes)
    {
        std::ostringstream output;
        output << std::hex << std::setfill('0');
        for (const unsigned char byte : bytes)
        {
            output << std::setw(2) << static_cast<unsigned int>(byte);
        }
        return output.str();
    }

    std::string testUtf8(std::u8string_view value)
    {
        return std::string(reinterpret_cast<const char*>(value.data()), value.size());
    }

    std::wstring testWide(std::string_view value)
    {
        const int count = MultiByteToWideChar(
            CP_UTF8,
            MB_ERR_INVALID_CHARS,
            value.data(),
            static_cast<int>(value.size()),
            nullptr,
            0);
        if (count <= 0)
        {
            throw std::runtime_error("Invalid UTF-8 updater test path.");
        }
        std::wstring result(static_cast<std::size_t>(count), L'\0');
        MultiByteToWideChar(
            CP_UTF8,
            MB_ERR_INVALID_CHARS,
            value.data(),
            static_cast<int>(value.size()),
            result.data(),
            count);
        return result;
    }

    struct UpdateFileFixture final
    {
        std::string path;
        std::string contents;
    };

    bool testUtf8ByteLess(std::string_view left, std::string_view right)
    {
        return std::lexicographical_compare(
            left.begin(), left.end(), right.begin(), right.end(),
            [](char leftByte, char rightByte) {
                return static_cast<unsigned char>(leftByte) < static_cast<unsigned char>(rightByte);
            });
    }

    std::string fileManifestDigest(std::vector<UpdateFileFixture> files)
    {
        std::sort(files.begin(), files.end(), [](const auto& left, const auto& right) {
            return testUtf8ByteLess(left.path, right.path);
        });
        std::string canonical;
        for (const UpdateFileFixture& file : files)
        {
            canonical += file.path;
            canonical.push_back('\0');
            canonical += std::to_string(file.contents.size());
            canonical.push_back('\0');
            canonical += testHex(testSha256(file.contents));
            canonical.push_back('\n');
        }
        return testHex(testSha256(canonical));
    }

    template <typename T>
    void appendPod(std::string& output, T value)
    {
        const char* bytes = reinterpret_cast<const char*>(&value);
        output.append(bytes, sizeof(value));
    }

    void appendString(std::string& output, std::string_view value)
    {
        appendPod(output, static_cast<std::uint32_t>(value.size()));
        output.append(value);
    }

    void appendDigest(std::string& output, std::string_view hex)
    {
        ASSERT_EQ(64u, hex.size());
        for (std::size_t index = 0; index < hex.size(); index += 2)
        {
            const std::string byte(hex.substr(index, 2));
            output.push_back(static_cast<char>(std::stoul(byte, nullptr, 16)));
        }
    }

    std::string makeDeltaPackage(
        const std::vector<UpdateFileFixture>& changedFiles,
        const std::vector<std::string>& deletedPaths,
        std::string_view baseDigest,
        std::string_view targetDigest)
    {
        constexpr std::array<char, 8> magic{'F', 'L', 'X', 'U', 'P', 'D', '1', '\0'};
        std::uint64_t totalBytes = 0;
        for (const UpdateFileFixture& file : changedFiles)
        {
            totalBytes += file.contents.size();
        }

        std::string package(magic.data(), magic.size());
        appendPod(package, std::uint32_t{1});
        appendPod(package, std::uint8_t{1});
        appendString(package, "1.2.2");
        appendString(package, "1.2.3");
        appendString(package, "win-x64");
        appendDigest(package, baseDigest);
        appendDigest(package, targetDigest);
        appendPod(package, static_cast<std::uint64_t>(deletedPaths.size()));
        for (const std::string& path : deletedPaths)
        {
            appendString(package, path);
        }
        appendPod(package, static_cast<std::uint64_t>(changedFiles.size()));
        appendPod(package, totalBytes);
        for (const UpdateFileFixture& file : changedFiles)
        {
            appendString(package, file.path);
            appendPod(package, static_cast<std::uint64_t>(file.contents.size()));
            const auto digest = testSha256(file.contents);
            package.append(reinterpret_cast<const char*>(digest.data()), digest.size());
            package.append(file.contents);
        }
        return package;
    }

    std::string makeFullPackage(
        std::vector<UpdateFileFixture> files,
        std::string_view targetDigest)
    {
        std::sort(files.begin(), files.end(), [](const auto& left, const auto& right) {
            return testUtf8ByteLess(left.path, right.path);
        });
        constexpr std::array<char, 8> magic{'F', 'L', 'X', 'U', 'P', 'D', '1', '\0'};
        std::uint64_t totalBytes = 0;
        for (const UpdateFileFixture& file : files)
        {
            totalBytes += file.contents.size();
        }
        std::string package(magic.data(), magic.size());
        appendPod(package, std::uint32_t{1});
        appendPod(package, std::uint8_t{0});
        appendString(package, {});
        appendString(package, "1.2.3");
        appendString(package, "win-x64");
        appendDigest(package, std::string(64, '0'));
        appendDigest(package, targetDigest);
        appendPod(package, std::uint64_t{0});
        appendPod(package, static_cast<std::uint64_t>(files.size()));
        appendPod(package, totalBytes);
        for (const UpdateFileFixture& file : files)
        {
            appendString(package, file.path);
            appendPod(package, static_cast<std::uint64_t>(file.contents.size()));
            const auto digest = testSha256(file.contents);
            package.append(reinterpret_cast<const char*>(digest.data()), digest.size());
            package.append(file.contents);
        }
        return package;
    }

    std::string makeUpdateManifest(
        std::vector<UpdateFileFixture> targetFiles,
        std::string_view packageHash,
        std::uint64_t packageSize,
        std::string_view baseDigest,
        std::string_view targetDigest)
    {
        std::sort(targetFiles.begin(), targetFiles.end(), [](const auto& left, const auto& right) {
            return testUtf8ByteLess(left.path, right.path);
        });
        std::ostringstream json;
        json << "{\"schemaVersion\":1,\"channel\":\"stable\",\"version\":\"1.2.3\","
             << "\"target\":\"win-x64\",\"applicationExecutable\":\"Fluxora.exe\","
             << "\"fileManifestSha256\":\"" << targetDigest << "\",\"files\":[";
        for (std::size_t index = 0; index < targetFiles.size(); ++index)
        {
            if (index != 0)
            {
                json << ',';
            }
            const UpdateFileFixture& file = targetFiles[index];
            json << "{\"path\":\"" << file.path << "\",\"size\":" << file.contents.size()
                 << ",\"sha256\":\"" << testHex(testSha256(file.contents)) << "\"}";
        }
        json << "],\"assets\":["
             << "{\"kind\":\"full\",\"fromVersion\":null,"
             << "\"url\":\"https://github.com/Fluxora/Fluxora/releases/download/v1.2.3/full.flxupd\","
             << "\"size\":" << packageSize << ",\"sha256\":\"" << packageHash << "\","
             << "\"baseFileManifestSha256\":null,\"targetFileManifestSha256\":\"" << targetDigest << "\"},"
             << "{\"kind\":\"delta\",\"fromVersion\":\"1.2.2\","
             << "\"url\":\"https://github.com/Fluxora/Fluxora/releases/download/v1.2.3/delta.flxupd\","
             << "\"size\":" << packageSize << ",\"sha256\":\"" << packageHash << "\","
             << "\"baseFileManifestSha256\":\"" << baseDigest << "\","
             << "\"targetFileManifestSha256\":\"" << targetDigest << "\"}]}";
        return json.str();
    }

    fluxora::installer::UpdateRequest writeSimpleDeltaFixture(
        const std::filesystem::path& root,
        const std::filesystem::path& install)
    {
        const std::vector<UpdateFileFixture> baseFiles{
            {"Fluxora.exe", "old executable"},
            {"data/obsolete.bin", "obsolete"}};
        const std::vector<UpdateFileFixture> targetFiles{
            {"Fluxora.exe", "new executable"},
            {"data/current.bin", "current"}};
        for (const UpdateFileFixture& file : baseFiles)
        {
            writeBinaryFile(install / testWide(file.path), file.contents);
        }
        const std::string baseDigest = fileManifestDigest(baseFiles);
        const std::string targetDigest = fileManifestDigest(targetFiles);
        const std::string package = makeDeltaPackage(
            targetFiles,
            {"data/obsolete.bin"},
            baseDigest,
            targetDigest);
        const std::string packageHash = testHex(testSha256(package));
        writeBinaryFile(root / L"package.flxupd", package);
        writeBinaryFile(
            root / L"manifest.json",
            makeUpdateManifest(targetFiles, packageHash, package.size(), baseDigest, targetDigest));
        writeBinaryFile(root / L"manifest.sig", "test-signature");

        fluxora::installer::UpdateRequest request = fullRequest(root);
        request.installDirectory = install;
        request.assetKind = fluxora::installer::UpdateAssetKind::Delta;
        request.fromVersion = "1.2.2";
        request.expectedPackageSha256 = packageHash;
        request.expectedPackageSize = package.size();
        return request;
    }

    bool hasTransactionSibling(
        const std::filesystem::path& install,
        std::wstring_view role)
    {
        const std::wstring prefix =
            L"." + install.filename().wstring() + L".fluxora-" + std::wstring(role);
        for (const std::filesystem::directory_entry& entry :
             std::filesystem::directory_iterator(install.parent_path()))
        {
            if (entry.path().filename().wstring().starts_with(prefix))
            {
                return true;
            }
        }
        return false;
    }
}

TEST(UpdateManifestVerifierTests, RejectsTamperedRawManifestBytes)
{
    fluxora::installer::UpdateManifestVerifier verifier{std::string(PublicKeyPem)};
    ASSERT_TRUE(verifier.verify(asBytes(SignedManifest), SignatureBase64));

    std::string tampered(SignedManifest);
    tampered[tampered.find("1.2.3")] = '9';

    EXPECT_FALSE(verifier.verify(asBytes(tampered), SignatureBase64));
}

TEST(UpdateEngineTests, RejectsTamperedDownloadedAssetBeforeInstallation)
{
    fluxora::tests::TempDirectory temp;
    writeBinaryFile(temp.path() / L"manifest.json", AssetManifest);
    writeBinaryFile(temp.path() / L"manifest.sig", AssetManifestSignature);
    writeBinaryFile(temp.path() / L"package.flxupd", "signed package byteS");

    const fluxora::installer::UpdateRequest request = fullRequest(temp.path());
    fluxora::installer::UpdateEngine engine{std::string(PublicKeyPem)};

    EXPECT_THROW(engine.verify(request), std::runtime_error);
    EXPECT_FALSE(std::filesystem::exists(request.installDirectory));
}

TEST(UpdateEngineTests, RejectsManifestForWrongTarget)
{
    fluxora::tests::TempDirectory temp;
    writeSignedAssetFixture(temp.path());
    fluxora::installer::UpdateRequest request = fullRequest(temp.path());
    request.target = "linux-x64";

    fluxora::installer::UpdateEngine engine{std::string(PublicKeyPem)};

    EXPECT_THROW(engine.verify(request), std::runtime_error);
}

TEST(UpdateEngineTests, DeltaAtomicallyAddsReplacesDeletesBinaryUnicodeAndPreservesDownloads)
{
    fluxora::tests::TempDirectory temp;
    const std::filesystem::path install = temp.path() / L"install";
    const std::string unicodeExisting = testUtf8(u8"данные/оставить.bin");
    const std::string unicodeAdded = testUtf8(u8"данные/новый файл.bin");
    const std::vector<UpdateFileFixture> baseFiles{
        {"Fluxora.exe", std::string("old\0exe", 7)},
        {"data/old.bin", std::string("\0\x7f\xff", 3)},
        {unicodeExisting, "unchanged"}};
    const std::vector<UpdateFileFixture> targetFiles{
        {"Fluxora.exe", std::string("new\0exe", 7)},
        {unicodeAdded, std::string("\xff\0\x01new", 6)},
        {unicodeExisting, "unchanged"}};
    for (const UpdateFileFixture& file : baseFiles)
    {
        writeBinaryFile(install / testWide(file.path), file.contents);
    }
    writeBinaryFile(install / L"Downloads" / L"skyrimse" / L"kept.7z", "archive bytes");
    writeBinaryFile(install / L"logs" / L"previous-session.log", "local log");

    const std::string baseDigest = fileManifestDigest(baseFiles);
    const std::string targetDigest = fileManifestDigest(targetFiles);
    const std::vector<UpdateFileFixture> changedFiles{
        targetFiles[0],
        targetFiles[1]};
    const std::string package = makeDeltaPackage(
        changedFiles,
        {"data/old.bin"},
        baseDigest,
        targetDigest);
    const std::string packageHash = testHex(testSha256(package));
    writeBinaryFile(temp.path() / L"package.flxupd", package);
    writeBinaryFile(
        temp.path() / L"manifest.json",
        makeUpdateManifest(targetFiles, packageHash, package.size(), baseDigest, targetDigest));
    writeBinaryFile(temp.path() / L"manifest.sig", "test-signature");

    fluxora::installer::UpdateRequest request = fullRequest(temp.path());
    request.installDirectory = install;
    request.assetKind = fluxora::installer::UpdateAssetKind::Delta;
    request.fromVersion = "1.2.2";
    request.expectedPackageSha256 = packageHash;
    request.expectedPackageSize = package.size();
    fluxora::installer::UpdateEngine engine{
        [](std::span<const std::byte>, std::string_view) { return true; }};

    const fluxora::installer::UpdateApplyResult result = engine.apply(request);

    EXPECT_EQ(install / L"Fluxora.exe", result.applicationPath);
    EXPECT_EQ(targetFiles[0].contents, fluxora::tests::readTextFile(install / L"Fluxora.exe"));
    EXPECT_EQ(targetFiles[1].contents, fluxora::tests::readTextFile(install / testWide(unicodeAdded)));
    EXPECT_EQ("unchanged", fluxora::tests::readTextFile(install / testWide(unicodeExisting)));
    EXPECT_FALSE(std::filesystem::exists(install / L"data" / L"old.bin"));
    EXPECT_EQ(
        "archive bytes",
        fluxora::tests::readTextFile(install / L"Downloads" / L"skyrimse" / L"kept.7z"));
    EXPECT_EQ(
        "local log",
        fluxora::tests::readTextFile(install / L"logs" / L"previous-session.log"));
    EXPECT_TRUE(hasTransactionSibling(install, L"transaction"));
    EXPECT_TRUE(hasTransactionSibling(install, L"backup-"));

    fluxora::installer::detail::finalizePendingApplicationUpdate(install);

    EXPECT_FALSE(hasTransactionSibling(install, L"transaction"));
    EXPECT_FALSE(hasTransactionSibling(install, L"backup-"));
}

TEST(UpdateEngineTests, DeltaRejectsWrongInstalledBaseBeforeCommit)
{
    fluxora::tests::TempDirectory temp;
    const std::filesystem::path install = temp.path() / L"install";
    const fluxora::installer::UpdateRequest request = writeSimpleDeltaFixture(temp.path(), install);
    writeBinaryFile(install / L"Fluxora.exe", "locally changed");
    fluxora::installer::UpdateEngine engine{
        [](std::span<const std::byte>, std::string_view) { return true; }};

    EXPECT_THROW((void)engine.apply(request), std::runtime_error);

    EXPECT_EQ("locally changed", fluxora::tests::readTextFile(install / L"Fluxora.exe"));
    EXPECT_TRUE(std::filesystem::exists(install / L"data" / L"obsolete.bin"));
    EXPECT_FALSE(std::filesystem::exists(install / L"data" / L"current.bin"));
}

TEST(UpdateEngineTests, CommitFailureAutomaticallyRestoresThePreviousDirectory)
{
    fluxora::tests::TempDirectory temp;
    const std::filesystem::path install = temp.path() / L"install";
    const fluxora::installer::UpdateRequest request = writeSimpleDeltaFixture(temp.path(), install);
    writeBinaryFile(install / L"Downloads" / L"kept.bin", "user download");
    fluxora::installer::UpdateEngine engine{
        [](std::span<const std::byte>, std::string_view) { return true; },
        [](fluxora::installer::UpdateCommitStage stage) {
            if (stage == fluxora::installer::UpdateCommitStage::StagingCommitted)
            {
                throw std::runtime_error("injected post-commit failure");
            }
        }};

    EXPECT_THROW((void)engine.apply(request), std::runtime_error);

    EXPECT_EQ("old executable", fluxora::tests::readTextFile(install / L"Fluxora.exe"));
    EXPECT_EQ("obsolete", fluxora::tests::readTextFile(install / L"data" / L"obsolete.bin"));
    EXPECT_FALSE(std::filesystem::exists(install / L"data" / L"current.bin"));
    EXPECT_EQ("user download", fluxora::tests::readTextFile(install / L"Downloads" / L"kept.bin"));
}

TEST(UpdateEngineTests, FullUpdateReplacesAnyApplicationFileAndPreservesDownloads)
{
    fluxora::tests::TempDirectory temp;
    const std::filesystem::path install = temp.path() / L"install";
    writeBinaryFile(install / L"Fluxora.exe", "legacy executable");
    writeBinaryFile(install / L"legacy.dll", "remove me");
    writeBinaryFile(install / L"Downloads" / L"kept.7z", "user archive");
    const std::vector<UpdateFileFixture> targetFiles{
        {"Fluxora.exe", std::string("new\0exe", 7)},
        {"plugins/native.dll", std::string("\xff\0native", 8)}};
    const std::string targetDigest = fileManifestDigest(targetFiles);
    const std::string package = makeFullPackage(targetFiles, targetDigest);
    const std::string packageHash = testHex(testSha256(package));
    writeBinaryFile(temp.path() / L"package.flxupd", package);
    writeBinaryFile(
        temp.path() / L"manifest.json",
        makeUpdateManifest(targetFiles, packageHash, package.size(), std::string(64, 'b'), targetDigest));
    writeBinaryFile(temp.path() / L"manifest.sig", "test-signature");
    fluxora::installer::UpdateRequest request = fullRequest(temp.path());
    request.installDirectory = install;
    request.expectedPackageSha256 = packageHash;
    request.expectedPackageSize = package.size();
    fluxora::installer::UpdateEngine engine{
        [](std::span<const std::byte>, std::string_view) { return true; }};

    const fluxora::installer::UpdateApplyResult result = engine.apply(request);

    EXPECT_EQ(install / L"Fluxora.exe", result.applicationPath);
    EXPECT_EQ(targetFiles[0].contents, fluxora::tests::readTextFile(install / L"Fluxora.exe"));
    EXPECT_EQ(targetFiles[1].contents, fluxora::tests::readTextFile(install / L"plugins" / L"native.dll"));
    EXPECT_FALSE(std::filesystem::exists(install / L"legacy.dll"));
    EXPECT_EQ("user archive", fluxora::tests::readTextFile(install / L"Downloads" / L"kept.7z"));
    fluxora::installer::detail::finalizePendingApplicationUpdate(install);
}

TEST(UpdateEngineTests, ExplicitRollbackRestoresRetainedBackupAndOldApplication)
{
    fluxora::tests::TempDirectory temp;
    const std::filesystem::path install = temp.path() / L"install";
    const fluxora::installer::UpdateRequest request = writeSimpleDeltaFixture(temp.path(), install);
    fluxora::installer::UpdateEngine engine{
        [](std::span<const std::byte>, std::string_view) { return true; }};
    (void)engine.apply(request);
    ASSERT_EQ("new executable", fluxora::tests::readTextFile(install / L"Fluxora.exe"));

    fluxora::installer::detail::rollbackPendingApplicationUpdate(install);

    EXPECT_EQ("old executable", fluxora::tests::readTextFile(install / L"Fluxora.exe"));
    EXPECT_TRUE(std::filesystem::exists(install / L"data" / L"obsolete.bin"));
    EXPECT_FALSE(std::filesystem::exists(install / L"data" / L"current.bin"));
    EXPECT_FALSE(hasTransactionSibling(install, L"transaction"));
    EXPECT_FALSE(hasTransactionSibling(install, L"backup-"));
}

TEST(UpdateEngineTests, RecoveryCompletesRollbackAfterRetiredDirectoryCleanupWasInterrupted)
{
    fluxora::tests::TempDirectory temp;
    const std::filesystem::path install = temp.path() / L"install";
    const fluxora::installer::UpdateRequest request = writeSimpleDeltaFixture(temp.path(), install);
    fluxora::installer::UpdateEngine engine{
        [](std::span<const std::byte>, std::string_view) { return true; }};
    (void)engine.apply(request);

    std::filesystem::path backup;
    const std::wstring backupPrefix =
        L"." + install.filename().wstring() + L".fluxora-backup-";
    for (const std::filesystem::directory_entry& entry :
         std::filesystem::directory_iterator(install.parent_path()))
    {
        if (entry.path().filename().wstring().starts_with(backupPrefix))
        {
            backup = entry.path();
            break;
        }
    }
    ASSERT_FALSE(backup.empty());

    std::wstring stagingName = backup.filename().wstring();
    const std::size_t roleOffset = stagingName.find(L"backup-");
    ASSERT_NE(std::wstring::npos, roleOffset);
    stagingName.replace(roleOffset, std::wstring_view(L"backup-").size(), L"staging-");
    const std::filesystem::path staging = install.parent_path() / stagingName;
    std::filesystem::rename(install, staging);
    std::filesystem::rename(backup, install);
    for (const std::filesystem::directory_entry& entry :
         std::filesystem::directory_iterator(staging))
    {
        const std::wstring name = entry.path().filename().wstring();
        if (name.starts_with(L".fluxora-commit-") && name.ends_with(L".pending"))
        {
            ASSERT_TRUE(std::filesystem::remove(entry.path()));
        }
    }

    fluxora::installer::detail::recoverApplicationDirectory(install);

    EXPECT_EQ("old executable", fluxora::tests::readTextFile(install / L"Fluxora.exe"));
    EXPECT_FALSE(hasTransactionSibling(install, L"transaction"));
    EXPECT_FALSE(hasTransactionSibling(install, L"backup-"));
    EXPECT_FALSE(hasTransactionSibling(install, L"staging-"));
}

TEST(UpdateEngineTests, CrashRecoveryPrefersRollbackWithoutHealthConfirmation)
{
    fluxora::tests::TempDirectory temp;
    const std::filesystem::path install = temp.path() / L"install";
    const fluxora::installer::UpdateRequest request = writeSimpleDeltaFixture(temp.path(), install);
    fluxora::installer::UpdateEngine engine{
        [](std::span<const std::byte>, std::string_view) { return true; }};
    (void)engine.apply(request);

    fluxora::installer::detail::recoverApplicationDirectory(install);

    EXPECT_EQ("old executable", fluxora::tests::readTextFile(install / L"Fluxora.exe"));
    EXPECT_TRUE(std::filesystem::exists(install / L"data" / L"obsolete.bin"));
    EXPECT_FALSE(hasTransactionSibling(install, L"transaction"));
    EXPECT_FALSE(hasTransactionSibling(install, L"backup-"));
}

TEST(UpdateEngineTests, FinalRevalidationRejectsMutationAfterFirstValidation)
{
    fluxora::tests::TempDirectory temp;
    const std::filesystem::path install = temp.path() / L"install";
    const fluxora::installer::UpdateRequest request = writeSimpleDeltaFixture(temp.path(), install);
    fluxora::installer::UpdateEngine engine{
        [](std::span<const std::byte>, std::string_view) { return true; },
        [&](fluxora::installer::UpdateCommitStage stage) {
            if (stage != fluxora::installer::UpdateCommitStage::StagingBuilt)
            {
                return;
            }
            for (const std::filesystem::directory_entry& entry :
                 std::filesystem::directory_iterator(install.parent_path()))
            {
                if (entry.is_directory() &&
                    entry.path().filename().wstring().starts_with(L".install.fluxora-staging-"))
                {
                    writeBinaryFile(entry.path() / L"Fluxora.exe", "mutated after validation");
                    return;
                }
            }
            throw std::runtime_error("Updater test could not find the staging directory.");
        }};

    EXPECT_THROW((void)engine.apply(request), std::runtime_error);

    EXPECT_EQ("old executable", fluxora::tests::readTextFile(install / L"Fluxora.exe"));
    EXPECT_FALSE(hasTransactionSibling(install, L"transaction"));
    EXPECT_FALSE(hasTransactionSibling(install, L"staging-"));
}

TEST(UpdateEngineTests, LiveTreeRevalidationRollsBackMutationAfterCommitRename)
{
    fluxora::tests::TempDirectory temp;
    const std::filesystem::path install = temp.path() / L"install";
    const fluxora::installer::UpdateRequest request = writeSimpleDeltaFixture(temp.path(), install);
    fluxora::installer::UpdateEngine engine{
        [](std::span<const std::byte>, std::string_view) { return true; },
        [&](fluxora::installer::UpdateCommitStage stage) {
            if (stage == fluxora::installer::UpdateCommitStage::StagingCommitted)
            {
                writeBinaryFile(install / L"Fluxora.exe", "mutated after commit rename");
            }
        }};

    EXPECT_THROW((void)engine.apply(request), std::runtime_error);

    EXPECT_EQ("old executable", fluxora::tests::readTextFile(install / L"Fluxora.exe"));
    EXPECT_TRUE(std::filesystem::exists(install / L"data" / L"obsolete.bin"));
    EXPECT_FALSE(hasTransactionSibling(install, L"transaction"));
}

TEST(UpdateEngineTests, NativeUpdaterLogRedactionRemovesPathsUrlsSecretsAndControls)
{
    const std::string safe = fluxora::installer::detail::redactUpdaterLogMessage(
        "source=\"C:\\Users\\Alice\\Downloads\\update.flxupd\" "
        "url=https://example.invalid/release?token=secret signature=abcdef "
        "fallback=C:\\private\\raw.bin\nforged");

    EXPECT_EQ(std::string::npos, safe.find("Alice"));
    EXPECT_EQ(std::string::npos, safe.find("example.invalid"));
    EXPECT_EQ(std::string::npos, safe.find("abcdef"));
    EXPECT_EQ(std::string::npos, safe.find("private"));
    EXPECT_EQ(std::string::npos, safe.find('\n'));
    EXPECT_NE(std::string::npos, safe.find("<redacted-path>"));
    EXPECT_NE(std::string::npos, safe.find("<redacted-url>"));
}

TEST(UpdateEngineTests, RecoveryCAbiRestoresBackupWhenCrashLeavesLiveDirectoryMissing)
{
    fluxora::tests::TempDirectory temp;
    const std::filesystem::path install = temp.path() / L"install";
    const fluxora::installer::UpdateRequest request = writeSimpleDeltaFixture(temp.path(), install);
    fluxora::installer::UpdateEngine engine{
        [](std::span<const std::byte>, std::string_view) { return true; }};
    (void)engine.apply(request);

    std::wstring transactionId;
    for (const std::filesystem::directory_entry& entry : std::filesystem::directory_iterator(install))
    {
        const std::wstring name = entry.path().filename().wstring();
        constexpr std::wstring_view prefix = L".fluxora-commit-";
        constexpr std::wstring_view suffix = L".pending";
        if (name.starts_with(prefix) && name.ends_with(suffix))
        {
            transactionId = name.substr(prefix.size(), name.size() - prefix.size() - suffix.size());
            break;
        }
    }
    ASSERT_EQ(32u, transactionId.size());
    const std::filesystem::path strandedStaging = install.parent_path() /
        (L"." + install.filename().wstring() + L".fluxora-staging-" + transactionId);
    std::filesystem::rename(install, strandedStaging);
    ASSERT_FALSE(std::filesystem::exists(install));

    std::array<wchar_t, 256> result{};
    EXPECT_EQ(
        FluxoraInstallerResultOk,
        fluxora_installer_recover_update(install.c_str(), result.data(), static_cast<int>(result.size())));

    EXPECT_EQ("old executable", fluxora::tests::readTextFile(install / L"Fluxora.exe"));
    EXPECT_FALSE(std::filesystem::exists(strandedStaging));
    EXPECT_FALSE(hasTransactionSibling(install, L"transaction"));
}

TEST(UpdateEngineTests, ProtectedDataMutationBeforeCommitFailsWithoutChangingLiveTree)
{
    fluxora::tests::TempDirectory temp;
    const std::filesystem::path install = temp.path() / L"install";
    const fluxora::installer::UpdateRequest request = writeSimpleDeltaFixture(temp.path(), install);
    writeBinaryFile(install / L"Downloads" / L"active.bin", "before");
    writeBinaryFile(install / L"logs" / L"active.log", "before-log");
    fluxora::installer::UpdateEngine engine{
        [](std::span<const std::byte>, std::string_view) { return true; },
        [&](fluxora::installer::UpdateCommitStage stage) {
            if (stage == fluxora::installer::UpdateCommitStage::ProtectedDataStaged)
            {
                writeBinaryFile(install / L"Downloads" / L"active.bin", "changed");
                writeBinaryFile(install / L"logs" / L"added.log", "added");
            }
        }};

    EXPECT_THROW((void)engine.apply(request), std::runtime_error);

    EXPECT_EQ("old executable", fluxora::tests::readTextFile(install / L"Fluxora.exe"));
    EXPECT_EQ("changed", fluxora::tests::readTextFile(install / L"Downloads" / L"active.bin"));
    EXPECT_EQ("added", fluxora::tests::readTextFile(install / L"logs" / L"added.log"));
    EXPECT_FALSE(hasTransactionSibling(install, L"transaction"));
}

class UpdateCommitFaultTests :
    public testing::TestWithParam<fluxora::installer::UpdateCommitStage>
{
};

TEST_P(UpdateCommitFaultTests, EveryCommitStageFailsClosedAndRemainsRecoverable)
{
    fluxora::tests::TempDirectory temp;
    const std::filesystem::path install = temp.path() / L"install";
    const fluxora::installer::UpdateRequest request =
        writeSimpleDeltaFixture(temp.path(), install);
    writeBinaryFile(
        install / L"Downloads" / L"kept.bin",
        "protected download");
    writeBinaryFile(
        install / L"logs" / L"kept.log",
        "protected log");
    const fluxora::installer::UpdateCommitStage injectedStage = GetParam();
    fluxora::installer::UpdateEngine engine{
        [](std::span<const std::byte>, std::string_view) { return true; },
        [injectedStage](fluxora::installer::UpdateCommitStage stage) {
            if (stage == injectedStage)
            {
                throw std::runtime_error("injected commit-stage failure");
            }
        }};

    EXPECT_THROW((void)engine.apply(request), std::runtime_error);
    EXPECT_NO_THROW(
        fluxora::installer::detail::recoverApplicationDirectory(install));

    EXPECT_EQ(
        "old executable",
        fluxora::tests::readTextFile(install / L"Fluxora.exe"));
    EXPECT_EQ(
        "obsolete",
        fluxora::tests::readTextFile(install / L"data" / L"obsolete.bin"));
    EXPECT_FALSE(std::filesystem::exists(
        install / L"data" / L"current.bin"));
    EXPECT_EQ(
        "protected download",
        fluxora::tests::readTextFile(
            install / L"Downloads" / L"kept.bin"));
    EXPECT_EQ(
        "protected log",
        fluxora::tests::readTextFile(
            install / L"logs" / L"kept.log"));
    EXPECT_FALSE(hasTransactionSibling(install, L"transaction"));
    EXPECT_FALSE(hasTransactionSibling(install, L"staging-"));
    EXPECT_FALSE(hasTransactionSibling(install, L"backup-"));
}

INSTANTIATE_TEST_SUITE_P(
    NativeDirectoryTransaction,
    UpdateCommitFaultTests,
    testing::Values(
        fluxora::installer::UpdateCommitStage::StagingBuilt,
        fluxora::installer::UpdateCommitStage::ProtectedDataStaged,
        fluxora::installer::UpdateCommitStage::BackupCreated,
        fluxora::installer::UpdateCommitStage::StagingCommitted));
