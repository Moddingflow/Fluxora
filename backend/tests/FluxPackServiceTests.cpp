#include "FluxoraCore/Services/AppSettingsService.hpp"
#include "FluxoraCore/Services/BuildPathSettingsService.hpp"
#include "FluxoraCore/Services/DownloadService.hpp"
#include "FluxoraCore/Services/FluxPackPackage.hpp"
#include "FluxoraCore/Services/FluxPackService.hpp"
#include "FluxoraCore/Services/Logger.hpp"
#include "FluxoraCore/Services/ProjectService.hpp"
#include "FluxoraCore/Services/TemplateService.hpp"
#include "FluxoraCore/Storage/InstanceMetadataStore.hpp"
#include "TestFilesystem.hpp"

#include <gtest/gtest.h>

#include <algorithm>
#include <array>
#include <chrono>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <string>
#include <string_view>
#include <tuple>
#include <unordered_set>
#include <vector>

namespace fluxora::tests
{
    namespace
    {
        std::string projectManifest()
        {
            return "{"
                "\"schemaVersion\":\"1\","
                "\"name\":\"FluxPack Test Build\","
                "\"templateId\":\"skyrimse\","
                "\"gameName\":\"Skyrim Special Edition\","
                "\"gamePath\":\"../Skyrim Special Edition\","
                "\"installRoot\":\"../Builds\","
                "\"projectDirectory\":\"../Builds/FluxPack Test Build\","
                "\"dataDirectory\":\"Data\","
                "\"nexusDomain\":\"skyrimspecialedition\","
                "\"defaultProfile\":\"Default\""
                "}";
        }

        std::string pseudoRandomBytes(std::size_t size, std::uint32_t seed)
        {
            std::string bytes(size, '\0');
            std::uint32_t state = seed;
            for (char& byte : bytes)
            {
                state ^= state << 13U;
                state ^= state >> 17U;
                state ^= state << 5U;
                byte = static_cast<char>(state & 0xffU);
            }
            return bytes;
        }

        void writeFluxPackUint64(std::ostream& output, std::uint64_t value)
        {
            std::array<char, 8> bytes{};
            for (std::size_t index = 0; index < bytes.size(); ++index)
            {
                bytes[index] = static_cast<char>((value >> (index * 8U)) & 0xffU);
            }
            output.write(bytes.data(), static_cast<std::streamsize>(bytes.size()));
        }

        void writeFluxPackV2Fixture(
            const std::filesystem::path& path,
            std::string_view payload,
            std::string_view manifest)
        {
            static constexpr std::array<char, 16> header{
                'F', 'L', 'U', 'X', 'P', 'A', 'C', 'K', '2', '\r', '\n', '\x1a', '\n', '\0', '\0', '\0'};
            static constexpr std::array<char, 8> footer{
                'F', 'L', 'X', 'P', 'E', 'N', 'D', '2'};
            std::ofstream output(path, std::ios::out | std::ios::binary | std::ios::trunc);
            output.write(header.data(), static_cast<std::streamsize>(header.size()));
            output.write(payload.data(), static_cast<std::streamsize>(payload.size()));
            const std::uint64_t manifestOffset = header.size() + payload.size();
            output.write(manifest.data(), static_cast<std::streamsize>(manifest.size()));
            output.write(footer.data(), static_cast<std::streamsize>(footer.size()));
            writeFluxPackUint64(output, manifestOffset);
            writeFluxPackUint64(output, manifest.size());
            if (!output)
            {
                throw std::runtime_error("Failed to write the FluxPack v2 fixture.");
            }
        }

        std::string toUtf8(const std::wstring& value)
        {
#ifdef _WIN32
            if (value.empty())
            {
                return {};
            }

            const int size = WideCharToMultiByte(
                CP_UTF8,
                0,
                value.data(),
                static_cast<int>(value.size()),
                nullptr,
                0,
                nullptr,
                nullptr);
            std::string out(static_cast<std::size_t>(size), '\0');
            WideCharToMultiByte(
                CP_UTF8,
                0,
                value.data(),
                static_cast<int>(value.size()),
                out.data(),
                size,
                nullptr,
                nullptr);
            return out;
#else
            return std::string(value.begin(), value.end());
#endif
        }

#ifdef _WIN32
        std::filesystem::path extendedLengthPath(const std::filesystem::path& path)
        {
            std::wstring text = std::filesystem::absolute(path).lexically_normal().wstring();
            if (text.rfind(LR"(\\?\)", 0) == 0)
            {
                return std::filesystem::path(std::move(text));
            }
            if (text.rfind(LR"(\\)", 0) == 0)
            {
                return std::filesystem::path(LR"(\\?\UNC\)" + text.substr(2));
            }

            return std::filesystem::path(LR"(\\?\)" + text);
        }

        std::filesystem::path pathWithExactLength(
            const std::filesystem::path& parent,
            const std::filesystem::path& fileName,
            std::size_t targetLength)
        {
            const std::filesystem::path withoutPadding = parent / fileName;
            const std::size_t withoutPaddingLength = withoutPadding.wstring().size();
            if (withoutPaddingLength + 2 > targetLength)
            {
                throw std::invalid_argument("Test path base is too long.");
            }

            const std::filesystem::path result =
                parent /
                std::wstring(targetLength - withoutPaddingLength - 1, L'x') /
                fileName;
            if (result.wstring().size() != targetLength)
            {
                throw std::runtime_error("Failed to construct the requested test path length.");
            }
            return result;
        }

        class ExtendedPathCleanup final
        {
        public:
            explicit ExtendedPathCleanup(std::filesystem::path root)
                : root_(std::move(root))
            {
            }

            ~ExtendedPathCleanup()
            {
                std::error_code error;
                std::filesystem::remove_all(extendedLengthPath(root_), error);
            }

            ExtendedPathCleanup(const ExtendedPathCleanup&) = delete;
            ExtendedPathCleanup& operator=(const ExtendedPathCleanup&) = delete;

        private:
            std::filesystem::path root_;
        };
#endif
    }

    TEST(FluxPackPackageTests, StoresDuplicateFileContentOnceAndRestoresIndependentFiles)
    {
#ifndef _WIN32
        GTEST_SKIP() << "FluxPack content hashes use the Windows SHA-256 provider in this build.";
#else
        TempDirectory temp;
        const std::filesystem::path firstSource = temp.path() / L"first" / L"shared.bin";
        const std::filesystem::path secondSource = temp.path() / L"second" / L"shared.bin";
        const std::filesystem::path packagePath = temp.path() / L"Deduplicated.fluxpack";
        const std::string content(384 * 1024, 'x');
        writeTextFile(firstSource, content);
        writeTextFile(secondSource, content);

        FluxPackPayloadReference firstReference;
        FluxPackPayloadReference secondReference;
        std::vector<FluxPackStoredChunk> chunks;
        {
            FluxPackPackageWriter writer(packagePath, FluxPackCompressionMode::Optimal);
            firstReference = writer.appendFile(firstSource);
            secondReference = writer.appendFile(secondSource);
            chunks = writer.contentChunks();
            writer.finish(R"({"format":"FluxPack","formatVersion":3})");
        }

        ASSERT_FALSE(firstReference.chunks.empty());
        EXPECT_EQ(firstReference.chunks, secondReference.chunks);
        EXPECT_EQ(chunks.size(), firstReference.chunks.size());

        const std::filesystem::path firstTarget = temp.path() / L"restored" / L"first.bin";
        const std::filesystem::path secondTarget = temp.path() / L"restored" / L"second.bin";
        std::filesystem::create_directories(firstTarget.parent_path());
        FluxPackPackageReader reader(packagePath);
        reader.setContentStore(chunks);
        reader.extractPayload(firstReference, firstTarget);
        reader.extractPayload(secondReference, secondTarget);

        EXPECT_EQ(readTextFile(firstTarget), content);
        EXPECT_EQ(readTextFile(secondTarget), content);
        EXPECT_NE(firstTarget, secondTarget);
#endif
    }

    TEST(FluxPackPackageTests, UsesStandardSha256ContentAddresses)
    {
        constexpr std::string_view input = "abc";
        EXPECT_EQ(
            computeFluxPackBytesSha256(input.data(), input.size()),
            L"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    }

    TEST(FluxPackPackageTests, ReadsLegacyV2RawPayloads)
    {
        TempDirectory temp;
        const std::filesystem::path packagePath = temp.path() / L"LegacyV2.fluxpack";
        const std::filesystem::path restoredPath = temp.path() / L"restored.bin";
        const std::string payload = "legacy v2 payload";
        const std::wstring hash = computeFluxPackBytesSha256(payload.data(), payload.size());
        writeFluxPackV2Fixture(
            packagePath,
            payload,
            R"({"format":"FluxPack","formatVersion":2})");

        EXPECT_TRUE(FluxPackPackageReader::isPackage(packagePath));
        EXPECT_TRUE(FluxPackPackageReader::isV2Package(packagePath));
        EXPECT_FALSE(FluxPackPackageReader::isV3Package(packagePath));
        FluxPackPackageReader reader(packagePath);
        EXPECT_EQ(reader.containerVersion(), 2);
        reader.extractPayload(
            FluxPackPayloadReference{16, payload.size(), hash, {}},
            restoredPath);
        EXPECT_EQ(readTextFile(restoredPath), payload);
    }

    TEST(FluxPackPackageTests, ContentDefinedChunkingReusesChunksAfterLocalInsertion)
    {
        TempDirectory temp;
        const std::filesystem::path originalPath = temp.path() / L"large-original.bin";
        const std::filesystem::path editedPath = temp.path() / L"large-edited.bin";
        const std::filesystem::path packagePath = temp.path() / L"FastCdc.fluxpack";
        const std::string original = pseudoRandomBytes(3 * 1024 * 1024, 0x5f3759dfU);
        std::string edited = original;
        edited.insert(edited.begin() + static_cast<std::ptrdiff_t>(original.size() / 2), 73, 'L');
        writeTextFile(originalPath, original);
        writeTextFile(editedPath, edited);

        FluxPackPayloadReference originalReference;
        FluxPackPayloadReference editedReference;
        {
            FluxPackPackageWriter writer(packagePath, FluxPackCompressionMode::Fast);
            originalReference = writer.appendFile(originalPath);
            editedReference = writer.appendFile(editedPath);
            writer.finish(R"({"format":"FluxPack","formatVersion":3})");
        }

        ASSERT_GE(originalReference.chunks.size(), 4U);
        ASSERT_GE(editedReference.chunks.size(), 4U);
        std::unordered_set<std::wstring> originalHashes;
        for (const FluxPackPayloadChunkReference& chunk : originalReference.chunks)
        {
            originalHashes.insert(chunk.sha256);
        }
        std::size_t sharedChunks = 0;
        for (const FluxPackPayloadChunkReference& chunk : editedReference.chunks)
        {
            sharedChunks += originalHashes.contains(chunk.sha256) ? 1U : 0U;
        }
        EXPECT_GE(
            sharedChunks,
            (std::min)(originalReference.chunks.size(), editedReference.chunks.size()) / 2);
    }

    TEST(FluxPackPackageTests, AppliesCompressionModesAndSkipsIncompressibleArchives)
    {
        TempDirectory temp;
        const std::filesystem::path compressible = temp.path() / L"large.txt";
        const std::filesystem::path precompressed = temp.path() / L"texture.dds";
        writeTextFile(compressible, std::string(1024 * 1024, 'z'));
        writeTextFile(precompressed, pseudoRandomBytes(1024 * 1024, 0xa341316cU));

        const auto writePackage = [&](FluxPackCompressionMode mode, std::wstring_view name)
        {
            const std::filesystem::path path = temp.path() / (std::wstring(name) + L".fluxpack");
            FluxPackPackageWriter writer(path, mode);
            static_cast<void>(writer.appendFile(compressible));
            const FluxPackPayloadReference ddsReference = writer.appendFile(precompressed);
            const std::vector<FluxPackStoredChunk> chunks = writer.contentChunks();
            const FluxPackContentStoreStatistics statistics = writer.contentStoreStatistics();
            writer.finish(R"({"format":"FluxPack","formatVersion":3})");
            return std::tuple(chunks, ddsReference, statistics);
        };

        const auto [fastChunks, fastDds, fastStatistics] =
            writePackage(FluxPackCompressionMode::Fast, L"fast");
        const auto [optimalChunks, optimalDds, optimalStatistics] =
            writePackage(FluxPackCompressionMode::Optimal, L"optimal");
        const auto [smallestChunks, smallestDds, smallestStatistics] =
            writePackage(FluxPackCompressionMode::Smallest, L"smallest");

        EXPECT_EQ(fastStatistics.compressionMode, FluxPackCompressionMode::Fast);
        EXPECT_EQ(optimalStatistics.compressionMode, FluxPackCompressionMode::Optimal);
        EXPECT_EQ(smallestStatistics.compressionMode, FluxPackCompressionMode::Smallest);
        EXPECT_LE(optimalStatistics.storedBytes, fastStatistics.storedBytes);
        EXPECT_LE(smallestStatistics.storedBytes, optimalStatistics.storedBytes);

        const auto expectRawDds = [](const std::vector<FluxPackStoredChunk>& chunks,
                                     const FluxPackPayloadReference& reference)
        {
            for (const FluxPackPayloadChunkReference& piece : reference.chunks)
            {
                const auto stored = std::find_if(chunks.begin(), chunks.end(), [&](const FluxPackStoredChunk& chunk)
                {
                    return chunk.sha256 == piece.sha256;
                });
                ASSERT_NE(stored, chunks.end());
                EXPECT_EQ(stored->compression, FluxPackChunkCompression::None);
                EXPECT_EQ(stored->storedSize, stored->originalSize);
            }
        };
        expectRawDds(fastChunks, fastDds);
        expectRawDds(optimalChunks, optimalDds);
        expectRawDds(smallestChunks, smallestDds);
    }

    TEST(FluxPackPackageTests, BundlesSmallJsonFilesByTypeAndUsesAWinningDictionary)
    {
        TempDirectory temp;
        const std::filesystem::path packagePath = temp.path() / L"TextBundles.fluxpack";
        const std::string sharedPrefix = pseudoRandomBytes(8 * 1024, 0xc8013ea4U);
        std::vector<std::filesystem::path> sources;
        std::vector<std::string> contents;
        for (std::uint32_t index = 0; index < 16; ++index)
        {
            const std::filesystem::path source =
                temp.path() / L"configs" / (L"config-" + std::to_wstring(index) + L".json");
            std::string content = sharedPrefix;
            content += pseudoRandomBytes(48 * 1024, 0x9e3779b9U + index * 17U);
            writeTextFile(source, content);
            sources.push_back(source);
            contents.push_back(std::move(content));
        }

        std::vector<FluxPackPayloadReference> references;
        std::vector<FluxPackStoredChunk> chunks;
        FluxPackContentStoreStatistics statistics;
        {
            FluxPackPackageWriter writer(packagePath, FluxPackCompressionMode::Optimal);
            references = writer.appendFiles(sources);
            chunks = writer.contentChunks();
            statistics = writer.contentStoreStatistics();
            writer.finish(R"({"format":"FluxPack","formatVersion":3})");
        }

        ASSERT_EQ(references.size(), sources.size());
        EXPECT_LT(statistics.uniqueChunkCount, sources.size());
        EXPECT_GE(statistics.dictionaryCount, 1U);
        EXPECT_TRUE(std::any_of(chunks.begin(), chunks.end(), [](const FluxPackStoredChunk& chunk)
        {
            return chunk.compression == FluxPackChunkCompression::Zstandard &&
                !chunk.dictionarySha256.empty();
        }));

        const std::filesystem::path restored = temp.path() / L"restored.json";
        FluxPackPackageReader reader(packagePath);
        reader.setContentStore(chunks);
        reader.extractPayload(references[7], restored);
        EXPECT_EQ(readTextFile(restored), contents[7]);
    }

    TEST(FluxPackPackageTests, KeepsSmallFileDeduplicationAcrossBoundedTextBatches)
    {
        TempDirectory temp;
        const std::filesystem::path packagePath = temp.path() / L"ManyTextFiles.fluxpack";
        std::vector<std::filesystem::path> sources;
        sources.reserve(2050);
        for (std::size_t index = 0; index < 2050; ++index)
        {
            const std::filesystem::path source =
                temp.path() / L"configs" / (L"config-" + std::to_wstring(index) + L".json");
            const std::string content = index == 2049
                ? "{\"index\":0,\"enabled\":true}"
                : "{\"index\":" + std::to_string(index) + ",\"enabled\":true}";
            writeTextFile(source, content);
            sources.push_back(source);
        }

        std::vector<FluxPackPayloadReference> references;
        FluxPackContentStoreStatistics statistics;
        {
            FluxPackPackageWriter writer(packagePath, FluxPackCompressionMode::Fast);
            references = writer.appendFiles(sources);
            statistics = writer.contentStoreStatistics();
            writer.finish(R"({"format":"FluxPack","formatVersion":3})");
        }

        ASSERT_EQ(references.size(), sources.size());
        ASSERT_FALSE(references.front().chunks.empty());
        EXPECT_EQ(references.front().chunks, references.back().chunks);
        EXPECT_GT(statistics.deduplicatedBytes, 0U);
    }

    TEST(FluxPackServiceTests, ExportProjectWritesRecipeSectionsAndInspectSummary)
    {
#ifndef _WIN32
        GTEST_SKIP() << "FluxPack export uses Windows instance metadata in this build.";
#else
        TempDirectory temp;
        ScopedEnvironmentVariable appData(L"APPDATA", (temp.path() / L"AppData").wstring());

        const std::filesystem::path installRoot = temp.path() / L"Builds";
        const std::filesystem::path project = installRoot / L"FluxPack Test Build";
        const std::filesystem::path game = temp.path() / L"Skyrim Special Edition";
        const std::filesystem::path config = temp.path() / L"configs" / L"FluxPack Test Build.json";
        const std::filesystem::path mods = project / L"mods";
        const std::filesystem::path profiles = project / L"profiles";
        const std::filesystem::path downloads = project / L"downloads";
        const std::filesystem::path overwrite = project / L"overwrite";

        writeTextFile(game / L"SkyrimSE.exe", "MZ");
        writeTextFile(game / L"Data" / L"Skyrim.esm", "master");
        writeTextFile(config, projectManifest());

        const std::filesystem::path skyUi = mods / L"SkyUI";
        const std::filesystem::path nemesis = mods / L"Nemesis Output";
        const std::filesystem::path patch = mods / L"My Custom Patch";
        writeTextFile(skyUi / L"interface" / L"skyui.swf", "ui");
        writeTextFile(nemesis / L"meshes" / L"actors" / L"behavior.hkx", "generated");
        writeTextFile(patch / L"Data" / L"MyPatch.esp", "patch");
        writeTextFile(profiles / L"Default" / L"plugins.txt", "*Skyrim.esm\n*MyPatch.esp\n");
        writeTextFile(profiles / L"Default" / L"loadorder.txt", "Skyrim.esm\nMyPatch.esp\n");
        writeTextFile(overwrite / L"SKSE" / L"Plugins" / L"Example.ini", "[General]\nEnabled=1\n");
        writeTextFile(downloads / L"Old MO2 Archive.7z.meta", "[General]\nuninstalled=true\n");
        writeTextFile(downloads / L"SkyUI.7z", "source archive");
        writeTextFile(
            downloads / L"SkyUI.7z.fluxora.json",
            "{"
            "\"source\":\"nxm://skyrimspecialedition/mods/3863/files/123\","
            "\"gameDomain\":\"skyrimspecialedition\","
            "\"modId\":\"3863\","
            "\"fileId\":\"123\","
            "\"nexusModName\":\"SkyUI\","
            "\"version\":\"5.2\""
            "}");

        Logger logger;
        logger.initialize();
        AppSettingsService settings(logger);
        settings.initialize();
        TemplateService templates(logger);
        templates.initialize();
        ProjectService projects(logger, templates);
        projects.initialize();
        BuildPathSettingsService pathSettings(logger);
        pathSettings.initialize();
        DownloadService downloadService(logger, settings, pathSettings);
        downloadService.initialize();
        const BuildPathSettings savedPaths = pathSettings.saveForConfig(
            config,
            BuildPathSettings{
                game,
                mods,
                profiles,
                downloads,
                overwrite
            });
        EXPECT_EQ(normalized(savedPaths.modsDirectory), normalized(mods));

        InstanceMetadataStore::ensureInstance(project, L"skyrimse");
        InstanceMetadataStore::registerInstalledMods(
            project,
            {
                InstalledModImportRecord{
                    skyUi,
                    L"SkyUI",
                    L"5.2",
                    true,
                    ModSourceRecord{
                    L"nexus",
                    L"skyrimspecialedition",
                    L"3863",
                    L"123",
                    L"https://www.nexusmods.com/skyrimspecialedition/mods/3863",
                    {},
                    L"5.2"
                }
                },
                InstalledModImportRecord{nemesis, L"Nemesis Output", {}, true, {}},
                InstalledModImportRecord{patch, L"My Custom Patch", L"1.0", true, {}}
            });
        InstanceMetadataStore::replaceProfileOrderItems(
            project,
            L"Default",
            {
                ProfileOrderImportItemRecord{L"mod", L"SkyUI", {}},
                ProfileOrderImportItemRecord{L"mod", L"My Custom Patch", {}}
            });

        FluxPackService service(logger, projects, downloadService, pathSettings);
        service.initialize();

        const std::filesystem::path output = temp.path() / L"FluxPack Test Build.fluxpack";
        const FluxPackSummary exported = service.exportProject(FluxPackExportRequest{
            config,
            output,
            true
        });

        EXPECT_EQ(exported.buildName, L"FluxPack Test Build");
        EXPECT_EQ(exported.sourceArchiveCount, 1U);
        EXPECT_EQ(exported.generatedAssetCount, 1U);
        EXPECT_EQ(exported.customPatchCount, 1U);
        EXPECT_GE(exported.customConfigCount, 3U);
        EXPECT_EQ(exported.installStepCount, 4U);
        EXPECT_TRUE(exported.generatedAssetsIncluded);
        EXPECT_TRUE(exported.installPlanAvailable);
        EXPECT_TRUE(std::filesystem::is_regular_file(output));

        const std::string manifest = FluxPackPackageReader(output).readManifest();
        EXPECT_NE(manifest.find("\"format\":\"FluxPack\""), std::string::npos);
        EXPECT_NE(manifest.find("\"formatVersion\":3"), std::string::npos);
        EXPECT_NE(manifest.find("\"contentStore\""), std::string::npos);
        EXPECT_NE(manifest.find("\"algorithm\":\"fastcdc\""), std::string::npos);
        EXPECT_NE(manifest.find("\"compressionMode\":\"optimal\""), std::string::npos);
        EXPECT_NE(manifest.find("\"gamePath\""), std::string::npos);
        EXPECT_NE(manifest.find("\"sourceArchives\""), std::string::npos);
        EXPECT_NE(manifest.find("\"generatedAssets\""), std::string::npos);
        EXPECT_NE(manifest.find("\"customPatches\""), std::string::npos);
        EXPECT_NE(manifest.find("\"customConfigs\""), std::string::npos);
        EXPECT_NE(manifest.find("\"source-archives\""), std::string::npos);
        EXPECT_NE(manifest.find("\"status\":\"matched-local-download\""), std::string::npos);
        EXPECT_NE(manifest.find("\"url\":\"nxm://skyrimspecialedition/mods/3863/files/123\""), std::string::npos);
        EXPECT_EQ(manifest.find("Old MO2 Archive.7z.meta"), std::string::npos);
        EXPECT_NE(manifest.find("profiles/Default/plugins.txt"), std::string::npos);
        EXPECT_EQ(manifest.find("\"text\":\"*Skyrim.esm\\n*MyPatch.esp\\n\""), std::string::npos);

        const FluxPackSummary inspected = service.inspectFluxPack(output);
        EXPECT_EQ(inspected.buildName, L"FluxPack Test Build");
        EXPECT_EQ(inspected.sourceArchiveCount, 1U);
        EXPECT_EQ(inspected.generatedAssetCount, 1U);
        EXPECT_EQ(inspected.customPatchCount, 1U);
        EXPECT_GE(inspected.customConfigCount, 3U);
        EXPECT_EQ(inspected.installStepCount, 4U);
        EXPECT_TRUE(inspected.generatedAssetsIncluded);
        EXPECT_TRUE(inspected.installPlanAvailable);

        service.shutdown();
        downloadService.shutdown();
        projects.shutdown();
        templates.shutdown();
        pathSettings.shutdown();
        settings.shutdown();
        logger.shutdown();
#endif
    }

    TEST(FluxPackServiceTests, ExportProjectEmbedsLocalModsWithoutDirectLinksAndInstallRestoresThem)
    {
#ifndef _WIN32
        GTEST_SKIP() << "FluxPack export uses Windows instance metadata in this build.";
#else
        TempDirectory temp;
        ExtendedPathCleanup extendedPathCleanup(temp.path());
        ScopedEnvironmentVariable appData(L"APPDATA", (temp.path() / L"AppData").wstring());

        const std::filesystem::path installRoot = temp.path() / L"Builds";
        const std::filesystem::path project = installRoot / L"FluxPack Embedded Build";
        const std::filesystem::path game = temp.path() / L"Skyrim Special Edition";
        const std::filesystem::path config = temp.path() / L"configs" / L"FluxPack Embedded Build.json";
        const std::filesystem::path externalPaths = temp.path() / L"External Build Paths";
        const std::filesystem::path mods = externalPaths / L"mods";
        const std::filesystem::path profiles = externalPaths / L"profiles";
        const std::filesystem::path downloads = externalPaths / L"downloads";
        const std::filesystem::path overwrite = externalPaths / L"overwrite";
        const std::filesystem::path localPatch = mods / L"Local Nexus Patch";
        const std::filesystem::path secondLocalPatch = mods / L"Second Local Patch";
        const std::string largePayload(4 * 1024 * 1024, 'Z');
        const std::string largeConfig(512 * 1024, 'C');
        const std::string sharedPayload = pseudoRandomBytes(512 * 1024, 0x7f4a7c15U);
        const std::string longPathPayload = "payload from an exactly 260-character path";
        const std::string deepLongPathPayload = "payload from a deeply nested 340-character path";
        const std::filesystem::path longPayloadPath = pathWithExactLength(
            localPatch / L"textures" / L"actors" / L"character" / L"character assets" / L"tintmasks",
            L"femaleheadblackbloodtattoo_01.dds",
            260);
        const std::filesystem::path longPayloadRelativePath =
            longPayloadPath.lexically_relative(localPatch);
        const std::filesystem::path deepLongPayloadPath = pathWithExactLength(
            localPatch / L"textures" / L"actors" / L"character" / L"character assets" / L"tintmasks",
            L"femaleheaddeepwarpaint_01.dds",
            340);
        const std::filesystem::path deepLongPayloadRelativePath =
            deepLongPayloadPath.lexically_relative(localPatch);

        writeTextFile(game / L"SkyrimSE.exe", "MZ");
        writeTextFile(game / L"Data" / L"Skyrim.esm", "master");
        writeTextFile(localPatch / L"Data" / L"LocalPatch.esp", "embedded-local");
        writeTextFile(localPatch / L"textures" / L"large-payload.bin", largePayload);
        writeTextFile(localPatch / L"meshes" / L"shared-resource.bin", sharedPayload);
        writeTextFile(secondLocalPatch / L"meshes" / L"shared-resource.bin", sharedPayload);
        writeTextFile(extendedLengthPath(longPayloadPath), longPathPayload);
        writeTextFile(extendedLengthPath(deepLongPayloadPath), deepLongPathPayload);
        writeTextFile(profiles / L"Default" / L"plugins.txt", "*LocalPatch.esp\n");
        writeTextFile(overwrite / L"SKSE" / L"Plugins" / L"large-config.json", largeConfig);
        std::filesystem::create_directories(downloads);
        writeTextFile(
            config,
            std::string("{")
            + "\"schemaVersion\":\"1\","
            + "\"name\":\"FluxPack Embedded Build\","
            + "\"templateId\":\"skyrimse\","
            + "\"gameName\":\"Skyrim Special Edition\","
            + "\"gamePath\":\"" + toUtf8(game.generic_wstring()) + "\","
            + "\"installRoot\":\"" + toUtf8(installRoot.generic_wstring()) + "\","
            + "\"projectDirectory\":\"" + toUtf8(project.generic_wstring()) + "\","
            + "\"dataDirectory\":\"Data\","
            + "\"nexusDomain\":\"skyrimspecialedition\","
            + "\"defaultProfile\":\"Default\""
            + "}");

        Logger logger;
        logger.initialize();
        AppSettingsService settings(logger);
        settings.initialize();
        TemplateService templates(logger);
        templates.initialize();
        ProjectService projects(logger, templates);
        projects.initialize();
        BuildPathSettingsService pathSettings(logger);
        pathSettings.initialize();
        DownloadService downloadService(logger, settings, pathSettings);
        downloadService.initialize();
        const BuildPathSettings savedPaths = pathSettings.saveForConfig(
            config,
            BuildPathSettings{
                game,
                mods,
                profiles,
                downloads,
                overwrite
            });
        EXPECT_EQ(normalized(savedPaths.modsDirectory), normalized(mods));

        InstanceMetadataStore::ensureInstance(project, L"skyrimse");
        InstanceMetadataStore::registerInstalledMods(
            project,
            {
                InstalledModImportRecord{
                    localPatch,
                    L"Local Nexus Patch",
                    L"1.0",
                    true,
                    ModSourceRecord{
                        L"nexus",
                        L"skyrimspecialedition",
                        L"999",
                        L"",
                        L"",
                        {},
                        L"1.0"
                    }
                },
                InstalledModImportRecord{
                    secondLocalPatch,
                    L"Second Local Patch",
                    L"1.0",
                    true,
                    {}}
            });
        InstanceMetadataStore::replaceProfileOrderItems(
            project,
            L"Default",
            {
                ProfileOrderImportItemRecord{L"mod", L"Local Nexus Patch", {}},
                ProfileOrderImportItemRecord{L"mod", L"Second Local Patch", {}}
            });

        FluxPackService service(logger, projects, downloadService, pathSettings);
        service.initialize();

        const std::filesystem::path output = temp.path() / L"Embedded.fluxpack";
        std::vector<FluxPackExportProgress> exportProgress;
        const FluxPackSummary exported = service.exportProject(FluxPackExportRequest{
            config,
            output,
            false,
            [&exportProgress](const FluxPackExportProgress& update)
            {
                exportProgress.push_back(update);
            }
        });

        EXPECT_EQ(exported.sourceArchiveCount, 0U);
        EXPECT_EQ(exported.customPatchCount, 2U);
        EXPECT_EQ(exported.formatVersion, 3);
        EXPECT_EQ(exported.compressionMode, L"optimal");
        EXPECT_GT(exported.deduplicatedPayloadBytes, 0U);
        EXPECT_LT(exported.uniquePayloadBytes, exported.logicalPayloadBytes);
        EXPECT_LT(
            std::filesystem::file_size(output),
            static_cast<std::uintmax_t>(largePayload.size() + largeConfig.size() + 256 * 1024));

        std::ifstream package(output, std::ios::in | std::ios::binary);
        ASSERT_TRUE(package);
        std::array<char, 9> magic{};
        package.read(magic.data(), static_cast<std::streamsize>(magic.size()));
        ASSERT_EQ(package.gcount(), static_cast<std::streamsize>(magic.size()));
        EXPECT_EQ(std::string(magic.data(), magic.size()), "FLUXPACK3");

        const std::string manifest = FluxPackPackageReader(output).readManifest();
        EXPECT_NE(manifest.find("\"customPatches\""), std::string::npos);
        EXPECT_NE(manifest.find("\"embedsContent\":true"), std::string::npos);
        EXPECT_NE(manifest.find("\"payload\""), std::string::npos);
        EXPECT_NE(manifest.find("\"chunks\""), std::string::npos);
        EXPECT_NE(manifest.find("\"compression\":\"zstd\""), std::string::npos);
        EXPECT_EQ(manifest.find("\"contentBase64\""), std::string::npos);
        EXPECT_NE(manifest.find("LocalPatch.esp"), std::string::npos);
        EXPECT_NE(manifest.find("femaleheadblackbloodtattoo_01.dds"), std::string::npos);
        EXPECT_NE(manifest.find("femaleheaddeepwarpaint_01.dds"), std::string::npos);
        EXPECT_EQ(manifest.find("\"requiresDownload\":true"), std::string::npos);

        ASSERT_FALSE(exportProgress.empty());
        EXPECT_EQ(exportProgress.front().overallPercent, 0);
        EXPECT_EQ(exportProgress.front().currentStep, L"Изучаем сборку");
        EXPECT_EQ(exportProgress.back().overallPercent, 100);
        EXPECT_EQ(exportProgress.back().currentStep, L"Сборка упакована");
        EXPECT_GE(exportProgress.back().processedBytes, largePayload.size());
        EXPECT_TRUE(std::is_sorted(
            exportProgress.begin(),
            exportProgress.end(),
            [](const FluxPackExportProgress& left, const FluxPackExportProgress& right)
            {
                return left.overallPercent < right.overallPercent;
            }));
        EXPECT_NE(
            std::find_if(exportProgress.begin(), exportProgress.end(), [](const FluxPackExportProgress& update)
            {
                return update.phase == L"manifest" && update.currentStep == L"Сохраняем описание сборки";
            }),
            exportProgress.end());

        const FluxPackSummary inspected = service.inspectFluxPack(output);
        EXPECT_EQ(inspected.formatVersion, 3);
        EXPECT_EQ(inspected.customPatchCount, 2U);
        EXPECT_EQ(inspected.deduplicatedPayloadBytes, exported.deduplicatedPayloadBytes);

        std::vector<FluxPackInstallProgress> progress;
        const FluxPackInstallResult installed = service.installFluxPack(FluxPackInstallRequest{
            output,
            temp.path() / L"Installed",
            [&progress](const FluxPackInstallProgress& update)
            {
                progress.push_back(update);
            }
        });

        const std::filesystem::path restoredFile =
            installed.projectDirectory / L"mods" / L"Local Nexus Patch" / L"Data" / L"LocalPatch.esp";
        ASSERT_TRUE(std::filesystem::is_regular_file(restoredFile));
        EXPECT_EQ(readTextFile(restoredFile), "embedded-local");
        const std::filesystem::path restoredLargeFile =
            installed.projectDirectory / L"mods" / L"Local Nexus Patch" / L"textures" / L"large-payload.bin";
        ASSERT_TRUE(std::filesystem::is_regular_file(restoredLargeFile));
        EXPECT_EQ(readTextFile(restoredLargeFile), largePayload);
        EXPECT_EQ(
            readTextFile(
                installed.projectDirectory / L"mods" / L"Local Nexus Patch" /
                L"meshes" / L"shared-resource.bin"),
            sharedPayload);
        EXPECT_EQ(
            readTextFile(
                installed.projectDirectory / L"mods" / L"Second Local Patch" /
                L"meshes" / L"shared-resource.bin"),
            sharedPayload);
        const std::filesystem::path restoredLongPath =
            installed.projectDirectory / L"mods" / L"Local Nexus Patch" / longPayloadRelativePath;
        ASSERT_TRUE(std::filesystem::is_regular_file(extendedLengthPath(restoredLongPath)));
        EXPECT_EQ(readTextFile(extendedLengthPath(restoredLongPath)), longPathPayload);
        const std::filesystem::path restoredDeepLongPath =
            installed.projectDirectory / L"mods" / L"Local Nexus Patch" / deepLongPayloadRelativePath;
        ASSERT_TRUE(std::filesystem::is_regular_file(extendedLengthPath(restoredDeepLongPath)));
        EXPECT_EQ(readTextFile(extendedLengthPath(restoredDeepLongPath)), deepLongPathPayload);
        EXPECT_EQ(
            readTextFile(installed.projectDirectory / L"profiles" / L"Default" / L"plugins.txt"),
            "*LocalPatch.esp\n");
        EXPECT_EQ(
            readTextFile(
                installed.projectDirectory / L"overwrite" / L"SKSE" / L"Plugins" / L"large-config.json"),
            largeConfig);
        const std::vector<InstalledModRecord> installedMods =
            InstanceMetadataStore::listInstalledMods(installed.projectDirectory, installed.projectDirectory / L"mods");
        ASSERT_EQ(installedMods.size(), 2U);
        EXPECT_TRUE(std::all_of(installedMods.begin(), installedMods.end(), [](const InstalledModRecord& mod)
        {
            return mod.isLocal && mod.state == L"installed";
        }));
        EXPECT_FALSE(progress.empty());

        const std::filesystem::path unsafeOutput = localPatch / L"nested.fluxpack";
        EXPECT_THROW(
            static_cast<void>(service.exportProject(FluxPackExportRequest{config, unsafeOutput, false})),
            std::invalid_argument);
        EXPECT_FALSE(std::filesystem::exists(unsafeOutput));

        const std::filesystem::path corruptPackage = temp.path() / L"Corrupt.fluxpack";
        std::filesystem::copy_file(output, corruptPackage);
        {
            std::fstream corrupt(corruptPackage, std::ios::in | std::ios::out | std::ios::binary);
            ASSERT_TRUE(corrupt);
            corrupt.seekp(16, std::ios::beg);
            corrupt.put('X');
            ASSERT_TRUE(corrupt);
        }

        const std::filesystem::path corruptInstallRoot = temp.path() / L"Corrupt Installed";
        EXPECT_THROW(
            static_cast<void>(service.installFluxPack(FluxPackInstallRequest{
                corruptPackage,
                corruptInstallRoot,
                {}
            })),
            std::runtime_error);
        EXPECT_FALSE(std::filesystem::exists(corruptInstallRoot / L"FluxPack Embedded Build"));

        const std::filesystem::path disappearingPayload =
            localPatch / L"textures" / L"disappearing.bin";
        writeTextFile(disappearingPayload, "temporary payload");
        const std::filesystem::path preservedOutput = temp.path() / L"Preserved.fluxpack";
        writeTextFile(preservedOutput, "previous output");
        bool removedPayload = false;
        EXPECT_THROW(
            static_cast<void>(service.exportProject(FluxPackExportRequest{
                config,
                preservedOutput,
                false,
                [&removedPayload, &disappearingPayload](const FluxPackExportProgress& update)
                {
                    if (!removedPayload && update.phase == L"packing")
                    {
                        removedPayload = std::filesystem::remove(disappearingPayload);
                    }
                }
            })),
            std::runtime_error);
        EXPECT_TRUE(removedPayload);
        EXPECT_EQ(readTextFile(preservedOutput), "previous output");

        service.shutdown();
        downloadService.shutdown();
        projects.shutdown();
        templates.shutdown();
        pathSettings.shutdown();
        settings.shutdown();
        logger.shutdown();
#endif
    }

    TEST(FluxPackServiceTests, InstallFluxPackCreatesProjectAndAppliesEmbeddedConfigs)
    {
#ifndef _WIN32
        GTEST_SKIP() << "FluxPack install project creation uses Windows game detection in this build.";
#else
        TempDirectory temp;
        ScopedEnvironmentVariable appData(L"APPDATA", (temp.path() / L"AppData").wstring());

        const std::filesystem::path installRoot = temp.path() / L"Installed";
        const std::filesystem::path game = temp.path() / L"Skyrim Special Edition";
        const std::filesystem::path fluxPack = temp.path() / L"Foundation.fluxpack";
        ASSERT_FALSE(std::filesystem::exists(installRoot));
        writeTextFile(game / L"SkyrimSE.exe", "MZ");
        writeTextFile(game / L"Data" / L"Skyrim.esm", "master");
        const std::string fluxPackJson =
            std::string("{")
            + "\"format\":\"FluxPack\","
            + "\"formatVersion\":1,"
            + "\"build\":{"
            + "\"name\":\"Foundation Edition\","
            + "\"templateId\":\"skyrimse\","
            + "\"gameName\":\"Skyrim Special Edition\","
            + "\"gamePath\":\"" + toUtf8(game.generic_wstring()) + "\","
            + "\"defaultProfile\":\"Default\""
            + "},"
            + "\"policies\":{"
            + "\"generatedAssets\":\"confirm-before-including\""
            + "},"
            + "\"sourceArchives\":[],"
            + "\"generatedAssets\":[],"
            + "\"customPatches\":[],"
            + "\"customConfigs\":["
            + "{"
            + "\"relativePath\":\"profiles/Default/plugins.txt\","
            + "\"size\":20,"
            + "\"hash\":{\"algorithm\":\"sha256\",\"value\":\"\",\"status\":\"unavailable\"},"
            + "\"embedsText\":true,"
            + "\"text\":\"*Skyrim.esm\\n\""
            + "}"
            + "],"
            + "\"installPlan\":{"
            + "\"version\":1,"
            + "\"defaultProfile\":\"Default\","
            + "\"stages\":[{\"id\":\"source-archives\",\"title\":\"Download\",\"policy\":\"reference-only\",\"requires\":[]}],"
            + "\"profileOrder\":[],"
            + "\"targetPaths\":{}"
            + "}"
            + "}";
        writeTextFile(
            fluxPack,
            fluxPackJson);

        Logger logger;
        Logger::setOperationId(L"fluxpack-auto-root-test");
        logger.initialize();
        const std::filesystem::path operationsLogPath = logger.operationsLogPath();
        AppSettingsService settings(logger);
        settings.initialize();
        TemplateService templates(logger);
        templates.initialize();
        ProjectService projects(logger, templates);
        projects.initialize();
        BuildPathSettingsService pathSettings(logger);
        pathSettings.initialize();
        DownloadService downloadService(logger, settings, pathSettings);
        downloadService.initialize();
        FluxPackService service(logger, projects, downloadService, pathSettings);
        service.initialize();

        std::vector<FluxPackInstallProgress> progress;
        const FluxPackInstallResult result = service.installFluxPack(FluxPackInstallRequest{
            fluxPack,
            installRoot,
            [&progress](const FluxPackInstallProgress& update)
            {
                progress.push_back(update);
            }
        });

        EXPECT_EQ(result.buildName, L"Foundation Edition");
        EXPECT_TRUE(std::filesystem::is_directory(installRoot));
        EXPECT_TRUE(std::filesystem::is_regular_file(result.configPath));
        EXPECT_TRUE(std::filesystem::is_directory(result.projectDirectory));
        EXPECT_EQ(result.totalSourceCount, 0U);
        EXPECT_EQ(result.installedSourceCount, 0U);
        EXPECT_EQ(result.pendingSourceCount, 0U);
        EXPECT_EQ(result.failedSourceCount, 0U);
        EXPECT_EQ(result.appliedConfigCount, 1U);
        EXPECT_FALSE(result.hasWarnings);
        EXPECT_EQ(readTextFile(result.projectDirectory / L"profiles" / L"Default" / L"plugins.txt"), "*Skyrim.esm\n");
        ASSERT_FALSE(progress.empty());
        EXPECT_EQ(progress.back().phase, L"complete");
        EXPECT_EQ(progress.back().overallPercent, 100);

        service.shutdown();
        downloadService.shutdown();
        projects.shutdown();
        templates.shutdown();
        pathSettings.shutdown();
        settings.shutdown();
        logger.shutdown();

        const std::string operationsLog = readTextFile(operationsLogPath);
        EXPECT_NE(
            operationsLog.find("FluxPack install will create missing install root"),
            std::string::npos);
        EXPECT_NE(operationsLog.find("operationId=fluxpack-auto-root-test"), std::string::npos);
        Logger::clearOperationId();
#endif
    }

    TEST(FluxPackServiceTests, InstallFluxPackReportsNexusDownloadFailuresAsErrorsAndCleansPlaceholder)
    {
#ifndef _WIN32
        GTEST_SKIP() << "FluxPack install project creation uses Windows game detection in this build.";
#else
        TempDirectory temp;
        ScopedEnvironmentVariable appData(L"APPDATA", (temp.path() / L"AppData").wstring());

        const std::filesystem::path installRoot = temp.path() / L"Installed";
        const std::filesystem::path game = temp.path() / L"Skyrim Special Edition";
        const std::filesystem::path fluxPack = temp.path() / L"Foundation.fluxpack";
        std::filesystem::create_directories(installRoot);
        writeTextFile(game / L"SkyrimSE.exe", "MZ");
        writeTextFile(game / L"Data" / L"Skyrim.esm", "master");
        const std::string fluxPackJson =
            std::string("{")
            + "\"format\":\"FluxPack\","
            + "\"formatVersion\":1,"
            + "\"build\":{"
            + "\"name\":\"Foundation Edition\","
            + "\"templateId\":\"skyrimse\","
            + "\"gameName\":\"Skyrim Special Edition\","
            + "\"gamePath\":\"" + toUtf8(game.generic_wstring()) + "\","
            + "\"defaultProfile\":\"Default\""
            + "},"
            + "\"policies\":{\"generatedAssets\":\"confirm-before-including\"},"
            + "\"sourceArchives\":[{"
            + "\"folderName\":\"Nexus Source\","
            + "\"displayName\":\"Nexus Source\","
            + "\"version\":\"1.0\","
            + "\"enabled\":true,"
            + "\"requiresDownload\":true,"
            + "\"source\":{"
            + "\"provider\":\"nexus\","
            + "\"gameDomain\":\"skyrimspecialedition\","
            + "\"remoteModId\":\"3863\","
            + "\"remoteFileId\":\"123\","
            + "\"url\":\"nxm://skyrimspecialedition/mods/3863/files/123\""
            + "}"
            + "}],"
            + "\"generatedAssets\":[],"
            + "\"customPatches\":[],"
            + "\"customConfigs\":[],"
            + "\"installPlan\":{"
            + "\"version\":1,"
            + "\"defaultProfile\":\"Default\","
            + "\"stages\":[{\"id\":\"source-archives\",\"title\":\"Download\",\"policy\":\"reference-only\",\"requires\":[]}],"
            + "\"profileOrder\":[],"
            + "\"targetPaths\":{}"
            + "}"
            + "}";
        writeTextFile(fluxPack, fluxPackJson);

        Logger logger;
        logger.initialize();
        AppSettingsService settings(logger);
        settings.initialize();
        TemplateService templates(logger);
        templates.initialize();
        ProjectService projects(logger, templates);
        projects.initialize();
        BuildPathSettingsService pathSettings(logger);
        pathSettings.initialize();
        DownloadService downloadService(logger, settings, pathSettings);
        downloadService.initialize();
        FluxPackService service(logger, projects, downloadService, pathSettings);
        service.initialize();

        std::vector<FluxPackInstallProgress> progress;
        const FluxPackInstallResult result = service.installFluxPack(FluxPackInstallRequest{
            fluxPack,
            installRoot,
            [&progress](const FluxPackInstallProgress& update)
            {
                progress.push_back(update);
            }
        });

        EXPECT_EQ(result.totalSourceCount, 1U);
        EXPECT_EQ(result.installedSourceCount, 0U);
        EXPECT_EQ(result.pendingSourceCount, 0U);
        EXPECT_EQ(result.failedSourceCount, 1U);
        EXPECT_TRUE(result.hasWarnings);
        const std::filesystem::path downloadsDirectory = result.projectDirectory / L"downloads";
        if (std::filesystem::exists(downloadsDirectory))
        {
            for (const auto& entry : std::filesystem::directory_iterator(downloadsDirectory))
            {
                EXPECT_NE(entry.path().extension().wstring(), L".nxm");
                const std::wstring fileName = entry.path().filename().wstring();
                EXPECT_FALSE(fileName.size() == 11 && fileName.rfind(L".fb", 0) == 0);
            }
        }

        const FluxPackInstallProgress* failedUpdate = nullptr;
        for (const FluxPackInstallProgress& update : progress)
        {
            EXPECT_EQ(update.pendingSourceCount, 0U);
            if (update.phase == L"sources" && update.failedSourceCount == 1U)
            {
                failedUpdate = &update;
            }
        }

        ASSERT_NE(failedUpdate, nullptr);
        EXPECT_EQ(failedUpdate->currentStep, L"Ошибка загрузки");
        ASSERT_EQ(failedUpdate->providers.size(), 1U);
        EXPECT_EQ(failedUpdate->providers.front().providerId, L"nexus");
        EXPECT_EQ(failedUpdate->providers.front().pendingCount, 0U);
        EXPECT_EQ(failedUpdate->providers.front().failedCount, 1U);
        EXPECT_NE(failedUpdate->providers.front().statusText.find(L"Ошибка загрузки"), std::wstring::npos);
        EXPECT_EQ(failedUpdate->providers.front().statusText.find(L"Ожидает"), std::wstring::npos);

        service.shutdown();
        downloadService.shutdown();
        projects.shutdown();
        templates.shutdown();
        pathSettings.shutdown();
        settings.shutdown();
        logger.shutdown();
#endif
    }

    TEST(FluxPackServiceTests, InstallFluxPackUsesSourceBuildArchiveBeforeNexusDownload)
    {
#ifndef _WIN32
        GTEST_SKIP() << "FluxPack install project creation uses Windows game detection in this build.";
#else
        TempDirectory temp;
        ScopedEnvironmentVariable appData(L"APPDATA", (temp.path() / L"AppData").wstring());

        const std::filesystem::path sourceProject = temp.path() / L"Transferred Foundation";
        const std::filesystem::path sourceGame = sourceProject / L"stock game";
        const std::filesystem::path sourceArchive = sourceProject / L"downloads" / L"SkyUI.bsa";
        const std::filesystem::path installRoot = temp.path() / L"Installed";
        const std::filesystem::path fluxPack = temp.path() / L"Foundation.fluxpack";
        std::filesystem::create_directories(installRoot);
        writeTextFile(sourceGame / L"SkyrimSE.exe", "MZ");
        writeTextFile(sourceGame / L"Data" / L"Skyrim.esm", "master");
        writeTextFile(sourceArchive, "archive");

        const std::string fluxPackJson =
            std::string("{")
            + "\"format\":\"FluxPack\","
            + "\"formatVersion\":1,"
            + "\"build\":{"
            + "\"name\":\"Foundation Edition\","
            + "\"templateId\":\"skyrimse\","
            + "\"gameName\":\"Skyrim Special Edition\","
            + "\"gamePath\":\"" + toUtf8(sourceGame.generic_wstring()) + "\","
            + "\"projectDirectoryHint\":\"" + toUtf8(sourceProject.generic_wstring()) + "\","
            + "\"defaultProfile\":\"Default\""
            + "},"
            + "\"policies\":{\"generatedAssets\":\"confirm-before-including\"},"
            + "\"sourceArchives\":[{"
            + "\"folderName\":\"SkyUI\","
            + "\"displayName\":\"SkyUI\","
            + "\"version\":\"5.2\","
            + "\"enabled\":true,"
            + "\"archiveHash\":{\"algorithm\":\"sha256\",\"value\":\"\",\"status\":\"matched-local-download\"},"
            + "\"archiveFileName\":\"SkyUI.bsa\","
            + "\"archiveSize\":7,"
            + "\"requiresDownload\":true,"
            + "\"source\":{"
            + "\"provider\":\"nexus\","
            + "\"gameDomain\":\"skyrimspecialedition\","
            + "\"remoteModId\":\"3863\","
            + "\"remoteFileId\":\"123\","
            + "\"url\":\"nxm://skyrimspecialedition/mods/3863/files/123\","
            + "\"latestVersion\":\"5.2\""
            + "}"
            + "}],"
            + "\"generatedAssets\":[],"
            + "\"customPatches\":[],"
            + "\"customConfigs\":[],"
            + "\"installPlan\":{"
            + "\"version\":1,"
            + "\"defaultProfile\":\"Default\","
            + "\"stages\":[{\"id\":\"source-archives\",\"title\":\"Download\",\"policy\":\"reference-only\",\"requires\":[]}],"
            + "\"profileOrder\":[],"
            + "\"targetPaths\":{}"
            + "}"
            + "}";
        writeTextFile(fluxPack, fluxPackJson);

        Logger logger;
        logger.initialize();
        AppSettingsService settings(logger);
        settings.initialize();
        TemplateService templates(logger);
        templates.initialize();
        ProjectService projects(logger, templates);
        projects.initialize();
        BuildPathSettingsService pathSettings(logger);
        pathSettings.initialize();
        DownloadService downloadService(logger, settings, pathSettings);
        downloadService.initialize();
        FluxPackService service(logger, projects, downloadService, pathSettings);
        service.initialize();

        std::vector<FluxPackInstallProgress> progress;
        const FluxPackInstallResult result = service.installFluxPack(FluxPackInstallRequest{
            fluxPack,
            installRoot,
            [&progress](const FluxPackInstallProgress& update)
            {
                progress.push_back(update);
            }
        });

        EXPECT_EQ(result.totalSourceCount, 1U);
        EXPECT_EQ(result.installedSourceCount, 1U);
        EXPECT_EQ(result.pendingSourceCount, 0U);
        EXPECT_EQ(result.failedSourceCount, 0U);
        EXPECT_FALSE(result.hasWarnings);

        const BuildPathSettings installedPaths = pathSettings.loadForConfig(result.configPath);
        EXPECT_TRUE(std::filesystem::is_regular_file(installedPaths.modsDirectory / L"SkyUI" / L"SkyUI.bsa"));
        EXPECT_TRUE(std::filesystem::is_regular_file(result.projectDirectory / L"downloads" / L"SkyUI.bsa"));
        EXPECT_FALSE(std::filesystem::exists(result.projectDirectory / L"downloads" / L"skyrimspecialedition-3863-123.nxm"));

        const std::vector<InstalledModRecord> installedMods =
            InstanceMetadataStore::listInstalledMods(result.projectDirectory, installedPaths.modsDirectory);
        const InstalledModRecord* skyUi = nullptr;
        for (const InstalledModRecord& mod : installedMods)
        {
            if (mod.folderName == L"SkyUI")
            {
                skyUi = &mod;
                break;
            }
        }

        ASSERT_NE(skyUi, nullptr);
        EXPECT_EQ(skyUi->source.provider, L"nexus");
        EXPECT_EQ(skyUi->source.gameDomain, L"skyrimspecialedition");
        EXPECT_EQ(skyUi->source.remoteModId, L"3863");
        EXPECT_EQ(skyUi->source.remoteFileId, L"123");
        EXPECT_EQ(skyUi->source.url, L"nxm://skyrimspecialedition/mods/3863/files/123");

        bool copiedLocalArchive = false;
        for (const FluxPackInstallProgress& update : progress)
        {
            EXPECT_EQ(update.failedSourceCount, 0U);
            if (update.currentStep == L"Копируем источник")
            {
                copiedLocalArchive = true;
            }
        }
        EXPECT_TRUE(copiedLocalArchive);

        service.shutdown();
        downloadService.shutdown();
        projects.shutdown();
        templates.shutdown();
        pathSettings.shutdown();
        settings.shutdown();
        logger.shutdown();
#endif
    }

    TEST(FluxPackServiceTests, InstallFluxPackKeepsLocalGameAlignedWhenCatalogNameCollides)
    {
#ifndef _WIN32
        GTEST_SKIP() << "FluxPack install project creation uses Windows instance metadata in this build.";
#else
        TempDirectory temp;
        ScopedEnvironmentVariable appData(L"APPDATA", (temp.path() / L"AppData").wstring());

        const std::filesystem::path sourceProject = temp.path() / L"Source Foundation";
        const std::filesystem::path sourceGame = sourceProject / L"stock game";
        const std::filesystem::path installRoot = temp.path() / L"Installed";
        const std::filesystem::path fluxPack = temp.path() / L"Foundation.fluxpack";
        std::filesystem::create_directories(installRoot);
        writeTextFile(sourceGame / L"SkyrimSE.exe", "MZ");
        writeTextFile(sourceGame / L"Data" / L"Skyrim.esm", "master");

        const std::string fluxPackJson =
            std::string("{")
            + "\"format\":\"FluxPack\","
            + "\"formatVersion\":1,"
            + "\"build\":{"
            + "\"name\":\"Foundation Edition\","
            + "\"templateId\":\"skyrimse\","
            + "\"gameName\":\"Skyrim Special Edition\","
            + "\"gamePath\":\"" + toUtf8(sourceGame.generic_wstring()) + "\","
            + "\"projectDirectoryHint\":\"" + toUtf8(sourceProject.generic_wstring()) + "\","
            + "\"defaultProfile\":\"Default\""
            + "},"
            + "\"policies\":{\"generatedAssets\":\"confirm-before-including\"},"
            + "\"sourceArchives\":[],"
            + "\"generatedAssets\":[],"
            + "\"customPatches\":[],"
            + "\"customConfigs\":[],"
            + "\"installPlan\":{"
            + "\"version\":1,"
            + "\"defaultProfile\":\"Default\","
            + "\"stages\":[{\"id\":\"source-archives\",\"title\":\"Download\",\"policy\":\"reference-only\",\"requires\":[]}],"
            + "\"profileOrder\":[],"
            + "\"targetPaths\":{}"
            + "}"
            + "}";
        writeTextFile(fluxPack, fluxPackJson);
        std::filesystem::remove_all(sourceProject);
        ASSERT_FALSE(std::filesystem::exists(sourceGame));

        Logger logger;
        logger.initialize();
        AppSettingsService settings(logger);
        settings.initialize();
        TemplateService templates(logger);
        templates.initialize();
        ProjectService projects(logger, templates);
        projects.initialize();
        const ProjectDescriptor catalogCollision = projects.createProject(ProjectCreateRequest{
            L"Foundation Edition",
            L"skyrimse",
            temp.path() / L"Existing Skyrim" / L"SkyrimSE.exe",
            temp.path() / L"Existing Builds",
            false
        });
        const std::filesystem::path collisionSentinel =
            catalogCollision.projectDirectory / L"keep-existing.txt";
        writeTextFile(collisionSentinel, "existing catalog build");
        const std::filesystem::path plannedProjectDirectory =
            projects.buildProjectDirectory(installRoot, L"Foundation Edition");
        ASSERT_EQ(
            normalized(plannedProjectDirectory),
            normalized(installRoot / L"Foundation Edition-2"));
        BuildPathSettingsService pathSettings(logger);
        pathSettings.initialize();
        DownloadService downloadService(logger, settings, pathSettings);
        downloadService.initialize();
        FluxPackService service(logger, projects, downloadService, pathSettings);
        service.initialize();

        const FluxPackInstallResult result = service.installFluxPack(FluxPackInstallRequest{
            fluxPack,
            installRoot,
            {}
        });

        const std::filesystem::path localGame = result.projectDirectory / L"stock game";
        EXPECT_EQ(result.buildName, L"Foundation Edition");
        EXPECT_EQ(normalized(result.projectDirectory), normalized(plannedProjectDirectory));
        EXPECT_TRUE(std::filesystem::is_regular_file(result.configPath));
        EXPECT_TRUE(std::filesystem::is_directory(localGame));
        EXPECT_FALSE(std::filesystem::exists(sourceProject));
        EXPECT_FALSE(std::filesystem::exists(installRoot / L"Foundation Edition"));
        EXPECT_EQ(readTextFile(collisionSentinel), "existing catalog build");
        EXPECT_TRUE(std::filesystem::is_regular_file(catalogCollision.configPath));

        const BuildPathSettings savedPaths = pathSettings.loadForConfig(result.configPath);
        EXPECT_EQ(normalized(savedPaths.gameDirectory), normalized(localGame));
        const std::string manifest = readTextFile(result.configPath);
        EXPECT_NE(manifest.find("\"gamePath\":\"stock game\""), std::string::npos);
        EXPECT_NE(manifest.find("\"gameDirectory\":\"stock game\""), std::string::npos);

        service.shutdown();
        downloadService.shutdown();
        projects.shutdown();
        templates.shutdown();
        pathSettings.shutdown();
        settings.shutdown();
        logger.shutdown();
#endif
    }

    TEST(FluxPackServiceTests, ExportProjectWritesGamePathFromPathSettingsWhenManifestGamePathIsMissing)
    {
#ifndef _WIN32
        GTEST_SKIP() << "FluxPack export uses Windows game detection in this build.";
#else
        TempDirectory temp;
        ScopedEnvironmentVariable appData(L"APPDATA", (temp.path() / L"AppData").wstring());

        const std::filesystem::path installRoot = temp.path() / L"Builds";
        const std::filesystem::path project = installRoot / L"Foundation Edition";
        const std::filesystem::path game = project / L"Stock Game";
        const std::filesystem::path config = temp.path() / L"configs" / L"Foundation Edition.json";
        writeTextFile(game / L"SkyrimSE.exe", "MZ");
        writeTextFile(game / L"Data" / L"Skyrim.esm", "master");
        std::filesystem::create_directories(project / L"mods");
        std::filesystem::create_directories(project / L"profiles");
        std::filesystem::create_directories(project / L"downloads");
        std::filesystem::create_directories(project / L"overwrite");
        writeTextFile(
            config,
            std::string("{")
            + "\"schemaVersion\":\"1\","
            + "\"name\":\"Foundation Edition\","
            + "\"templateId\":\"skyrimse\","
            + "\"gameName\":\"Skyrim Special Edition\","
            + "\"installRoot\":\"" + toUtf8(installRoot.generic_wstring()) + "\","
            + "\"projectDirectory\":\"" + toUtf8(project.generic_wstring()) + "\","
            + "\"dataDirectory\":\"Data\","
            + "\"nexusDomain\":\"skyrimspecialedition\","
            + "\"defaultProfile\":\"Default\","
            + "\"paths\":{"
            + "\"gameDirectory\":\"Stock Game\","
            + "\"modsDirectory\":\"mods\","
            + "\"profilesDirectory\":\"profiles\","
            + "\"downloadsDirectory\":\"downloads\","
            + "\"overwriteDirectory\":\"overwrite\""
            + "}"
            + "}");

        Logger logger;
        logger.initialize();
        AppSettingsService settings(logger);
        settings.initialize();
        TemplateService templates(logger);
        templates.initialize();
        ProjectService projects(logger, templates);
        projects.initialize();
        BuildPathSettingsService pathSettings(logger);
        pathSettings.initialize();
        DownloadService downloadService(logger, settings, pathSettings);
        downloadService.initialize();
        InstanceMetadataStore::ensureInstance(project, L"skyrimse");

        FluxPackService service(logger, projects, downloadService, pathSettings);
        service.initialize();

        const std::filesystem::path output = temp.path() / L"Foundation Edition.fluxpack";
        const FluxPackSummary exported = service.exportProject(FluxPackExportRequest{
            config,
            output,
            false
        });

        EXPECT_EQ(exported.buildName, L"Foundation Edition");
        const std::string manifest = readTextFile(output);
        EXPECT_NE(manifest.find("\"gamePath\":\""), std::string::npos);
        EXPECT_EQ(manifest.find("\"gamePath\":\"\""), std::string::npos);
        EXPECT_NE(manifest.find("Stock Game"), std::string::npos);

        service.shutdown();
        downloadService.shutdown();
        projects.shutdown();
        templates.shutdown();
        pathSettings.shutdown();
        settings.shutdown();
        logger.shutdown();
#endif
    }

    TEST(FluxPackServiceTests, InstallLegacyFluxPackRecoversGamePathFromProjectDirectoryHint)
    {
#ifndef _WIN32
        GTEST_SKIP() << "FluxPack install project creation uses Windows game detection in this build.";
#else
        TempDirectory temp;
        ScopedEnvironmentVariable appData(L"APPDATA", (temp.path() / L"AppData").wstring());

        const std::filesystem::path projectHint = temp.path() / L"Exported Foundation";
        const std::filesystem::path game = projectHint / L"Stock Game";
        const std::filesystem::path installRoot = temp.path() / L"Installed";
        const std::filesystem::path fluxPack = temp.path() / L"Legacy.fluxpack";
        std::filesystem::create_directories(installRoot);
        writeTextFile(game / L"SkyrimSE.exe", "MZ");
        writeTextFile(game / L"Data" / L"Skyrim.esm", "master");
        std::filesystem::create_directories(projectHint / L"mods");
        std::filesystem::create_directories(projectHint / L"profiles");
        std::filesystem::create_directories(projectHint / L"downloads");
        std::filesystem::create_directories(projectHint / L"overwrite");

        const std::string fluxPackJson =
            std::string("{")
            + "\"format\":\"FluxPack\","
            + "\"formatVersion\":1,"
            + "\"build\":{"
            + "\"name\":\"Foundation Edition\","
            + "\"templateId\":\"skyrimse\","
            + "\"gameName\":\"Skyrim Special Edition\","
            + "\"projectDirectoryHint\":\"" + toUtf8(projectHint.generic_wstring()) + "\","
            + "\"defaultProfile\":\"Default\""
            + "},"
            + "\"policies\":{\"generatedAssets\":\"confirm-before-including\"},"
            + "\"sourceArchives\":[],"
            + "\"generatedAssets\":[],"
            + "\"customPatches\":[],"
            + "\"customConfigs\":[],"
            + "\"installPlan\":{"
            + "\"version\":1,"
            + "\"defaultProfile\":\"Default\","
            + "\"stages\":[{\"id\":\"source-archives\",\"title\":\"Download\",\"policy\":\"reference-only\",\"requires\":[]}],"
            + "\"profileOrder\":[],"
            + "\"targetPaths\":{}"
            + "}"
            + "}";
        writeTextFile(fluxPack, fluxPackJson);

        Logger logger;
        logger.initialize();
        AppSettingsService settings(logger);
        settings.initialize();
        TemplateService templates(logger);
        templates.initialize();
        ProjectService projects(logger, templates);
        projects.initialize();
        BuildPathSettingsService pathSettings(logger);
        pathSettings.initialize();
        DownloadService downloadService(logger, settings, pathSettings);
        downloadService.initialize();
        FluxPackService service(logger, projects, downloadService, pathSettings);
        service.initialize();

        const FluxPackInstallResult result = service.installFluxPack(FluxPackInstallRequest{
            fluxPack,
            installRoot,
            {}
        });

        EXPECT_EQ(result.buildName, L"Foundation Edition");
        EXPECT_TRUE(std::filesystem::is_regular_file(result.configPath));
        const std::filesystem::path localGame = result.projectDirectory / L"stock game";
        EXPECT_TRUE(std::filesystem::is_directory(localGame));
        const BuildPathSettings savedPaths = pathSettings.loadForConfig(result.configPath);
        EXPECT_EQ(normalized(savedPaths.gameDirectory), normalized(localGame));
        const std::string manifest = readTextFile(result.configPath);
        EXPECT_NE(manifest.find("\"gamePath\":\"stock game\""), std::string::npos);
        EXPECT_EQ(manifest.find(toUtf8(projectHint.generic_wstring())), std::string::npos);

        service.shutdown();
        downloadService.shutdown();
        projects.shutdown();
        templates.shutdown();
        pathSettings.shutdown();
        settings.shutdown();
        logger.shutdown();
#endif
    }

    TEST(FluxPackServiceTests, UpdateExistingBuildReusesMatchingEmbeddedFilesAndPreservesTargetsOnFailure)
    {
#ifndef _WIN32
        GTEST_SKIP() << "FluxPack install project creation uses Windows game detection in this build.";
#else
        TempDirectory temp;
        ScopedEnvironmentVariable appData(L"APPDATA", (temp.path() / L"AppData").wstring());

        const std::filesystem::path game = temp.path() / L"Skyrim Special Edition";
        const std::filesystem::path installRoot = temp.path() / L"Builds";
        const std::filesystem::path fluxPack = temp.path() / L"Foundation Update.fluxpack";
        writeTextFile(game / L"SkyrimSE.exe", "MZ");
        writeTextFile(game / L"Data" / L"Skyrim.esm", "master");

        Logger logger;
        logger.initialize();
        AppSettingsService settings(logger);
        settings.initialize();
        TemplateService templates(logger);
        templates.initialize();
        ProjectService projects(logger, templates);
        projects.initialize();
        BuildPathSettingsService pathSettings(logger);
        pathSettings.initialize();
        DownloadService downloadService(logger, settings, pathSettings);
        downloadService.initialize();

        const ProjectDescriptor existing = projects.createProject(ProjectCreateRequest{
            L"Foundation Edition",
            L"skyrimse",
            game,
            installRoot,
            true
        });
        const BuildPathSettings existingPaths = pathSettings.loadForConfig(existing.configPath);
        const std::filesystem::path unchangedFile =
            existingPaths.modsDirectory / L"Local Patch" / L"same.txt";
        const std::filesystem::path changedFile =
            existingPaths.modsDirectory / L"Local Patch" / L"changed.txt";
        writeTextFile(unchangedFile, "same");
        writeTextFile(changedFile, "old");
        const auto preservedWriteTime =
            std::filesystem::file_time_type::clock::now() - std::chrono::hours(24);
        std::filesystem::last_write_time(unchangedFile, preservedWriteTime);

        const std::string unchangedContent = "same";
        const std::string changedContent = "new";
        const std::wstring unchangedHash =
            computeFluxPackBytesSha256(unchangedContent.data(), unchangedContent.size());
        const std::wstring changedHash =
            computeFluxPackBytesSha256(changedContent.data(), changedContent.size());
        const std::string fluxPackJson =
            std::string("{")
            + "\"format\":\"FluxPack\","
            + "\"formatVersion\":1,"
            + "\"build\":{"
            + "\"name\":\"Foundation Edition\","
            + "\"templateId\":\"skyrimse\","
            + "\"gameName\":\"Skyrim Special Edition\","
            + "\"gamePath\":\"" + toUtf8(game.generic_wstring()) + "\","
            + "\"projectDirectoryHint\":\"" + toUtf8(existing.projectDirectory.generic_wstring()) + "\","
            + "\"defaultProfile\":\"Default\""
            + "},"
            + "\"policies\":{\"generatedAssets\":\"confirm-before-including\"},"
            + "\"sourceArchives\":[],"
            + "\"generatedAssets\":[],"
            + "\"customPatches\":[{"
            + "\"folderName\":\"Local Patch\","
            + "\"displayName\":\"Local Patch\","
            + "\"version\":\"2.0\","
            + "\"enabled\":true,"
            + "\"source\":{},"
            + "\"files\":[{"
            + "\"relativePath\":\"mods/Local Patch/same.txt\","
            + "\"hash\":{\"algorithm\":\"sha256\",\"value\":\"" + toUtf8(unchangedHash) + "\"},"
            + "\"size\":4,"
            + "\"contentBase64\":\"c2FtZQ==\","
            + "\"embedsContent\":true"
            + "},{"
            + "\"relativePath\":\"mods/Local Patch/changed.txt\","
            + "\"hash\":{\"algorithm\":\"sha256\",\"value\":\"" + toUtf8(changedHash) + "\"},"
            + "\"size\":3,"
            + "\"contentBase64\":\"bmV3\","
            + "\"embedsContent\":true"
            + "}]"
            + "}],"
            + "\"customConfigs\":[],"
            + "\"installPlan\":{"
            + "\"version\":1,"
            + "\"defaultProfile\":\"Default\","
            + "\"stages\":[{\"id\":\"embedded-mods\",\"title\":\"Restore\",\"policy\":\"package-payload\",\"requires\":[]}],"
            + "\"profileOrder\":[],"
            + "\"targetPaths\":{}"
            + "}"
            + "}";
        writeTextFile(fluxPack, fluxPackJson);

        FluxPackService service(logger, projects, downloadService, pathSettings);
        service.initialize();
        const FluxPackInstallResult result = service.installFluxPack(FluxPackInstallRequest{
            fluxPack,
            installRoot,
            {},
            existing.configPath
        });

        EXPECT_TRUE(result.updatedExistingProject);
        EXPECT_EQ(normalized(result.configPath), normalized(existing.configPath));
        EXPECT_EQ(normalized(result.projectDirectory), normalized(existing.projectDirectory));
        EXPECT_EQ(result.reusedFileCount, 1U);
        EXPECT_EQ(result.materializedFileCount, 1U);
        EXPECT_EQ(readTextFile(unchangedFile), unchangedContent);
        EXPECT_EQ(readTextFile(changedFile), changedContent);
        EXPECT_EQ(std::filesystem::last_write_time(unchangedFile), preservedWriteTime);
        EXPECT_FALSE(std::filesystem::exists(installRoot / L"Foundation Edition 2"));

        std::string corruptFluxPackJson = fluxPackJson;
        const std::size_t encodedContent = corruptFluxPackJson.find("c2FtZQ==");
        ASSERT_NE(encodedContent, std::string::npos);
        corruptFluxPackJson.replace(encodedContent, std::string("c2FtZQ==").size(), "bm9wZQ==");
        const std::filesystem::path corruptFluxPack = temp.path() / L"Corrupt Update.fluxpack";
        writeTextFile(corruptFluxPack, corruptFluxPackJson);
        writeTextFile(unchangedFile, "keep");

        EXPECT_THROW(
            static_cast<void>(service.installFluxPack(FluxPackInstallRequest{
                corruptFluxPack,
                installRoot,
                {},
                existing.configPath
            })),
            std::runtime_error);
        EXPECT_EQ(readTextFile(unchangedFile), "keep");

        service.shutdown();
        downloadService.shutdown();
        projects.shutdown();
        templates.shutdown();
        pathSettings.shutdown();
        settings.shutdown();
        logger.shutdown();
#endif
    }

    TEST(FluxPackServiceTests, UpdateExistingBuildReusesMatchingInstalledSourceMod)
    {
#ifndef _WIN32
        GTEST_SKIP() << "FluxPack install project creation uses Windows game detection in this build.";
#else
        TempDirectory temp;
        ScopedEnvironmentVariable appData(L"APPDATA", (temp.path() / L"AppData").wstring());

        const std::filesystem::path game = temp.path() / L"Skyrim Special Edition";
        const std::filesystem::path installRoot = temp.path() / L"Builds";
        const std::filesystem::path fluxPack = temp.path() / L"Foundation Sources Update.fluxpack";
        writeTextFile(game / L"SkyrimSE.exe", "MZ");
        writeTextFile(game / L"Data" / L"Skyrim.esm", "master");

        Logger logger;
        logger.initialize();
        AppSettingsService settings(logger);
        settings.initialize();
        TemplateService templates(logger);
        templates.initialize();
        ProjectService projects(logger, templates);
        projects.initialize();
        BuildPathSettingsService pathSettings(logger);
        pathSettings.initialize();
        DownloadService downloadService(logger, settings, pathSettings);
        downloadService.initialize();

        const ProjectDescriptor existing = projects.createProject(ProjectCreateRequest{
            L"Foundation Edition",
            L"skyrimse",
            game,
            installRoot,
            true
        });
        const BuildPathSettings existingPaths = pathSettings.loadForConfig(existing.configPath);
        const std::filesystem::path installedModDirectory = existingPaths.modsDirectory / L"SkyUI";
        const std::filesystem::path installedFile = installedModDirectory / L"SkyUI.bsa";
        writeTextFile(installedFile, "already installed");
        const auto preservedWriteTime =
            std::filesystem::file_time_type::clock::now() - std::chrono::hours(24);
        std::filesystem::last_write_time(installedFile, preservedWriteTime);

        InstalledModImportRecord installedMod;
        installedMod.modDirectory = installedModDirectory;
        installedMod.displayName = L"SkyUI";
        installedMod.version = L"5.2";
        installedMod.isEnabled = true;
        installedMod.source = ModSourceRecord{
            L"nexus",
            L"skyrimspecialedition",
            L"3863",
            L"123",
            L"nxm://skyrimspecialedition/mods/3863/files/123",
            {},
            L"5.2"
        };
        InstanceMetadataStore::registerInstalledMods(existing.projectDirectory, {installedMod});

        const std::string fluxPackJson =
            std::string("{")
            + "\"format\":\"FluxPack\","
            + "\"formatVersion\":1,"
            + "\"build\":{"
            + "\"name\":\"Foundation Edition\","
            + "\"templateId\":\"skyrimse\","
            + "\"gameName\":\"Skyrim Special Edition\","
            + "\"gamePath\":\"" + toUtf8(game.generic_wstring()) + "\","
            + "\"projectDirectoryHint\":\"\","
            + "\"defaultProfile\":\"Default\""
            + "},"
            + "\"policies\":{\"generatedAssets\":\"confirm-before-including\"},"
            + "\"sourceArchives\":[{"
            + "\"folderName\":\"SkyUI\","
            + "\"displayName\":\"SkyUI\","
            + "\"version\":\"5.2\","
            + "\"enabled\":true,"
            + "\"archiveHash\":{\"algorithm\":\"sha256\",\"value\":\"\",\"status\":\"source-archive-not-included\"},"
            + "\"archiveFileName\":\"\","
            + "\"archiveSize\":0,"
            + "\"requiresDownload\":true,"
            + "\"source\":{"
            + "\"provider\":\"nexus\","
            + "\"gameDomain\":\"skyrimspecialedition\","
            + "\"remoteModId\":\"3863\","
            + "\"remoteFileId\":\"123\","
            + "\"url\":\"nxm://skyrimspecialedition/mods/3863/files/123\","
            + "\"latestVersion\":\"5.2\""
            + "}"
            + "}],"
            + "\"generatedAssets\":[],"
            + "\"customPatches\":[],"
            + "\"customConfigs\":[],"
            + "\"installPlan\":{"
            + "\"version\":1,"
            + "\"defaultProfile\":\"Default\","
            + "\"stages\":[{\"id\":\"source-archives\",\"title\":\"Download\",\"policy\":\"reference-only\",\"requires\":[]}],"
            + "\"profileOrder\":[],"
            + "\"targetPaths\":{}"
            + "}"
            + "}";
        writeTextFile(fluxPack, fluxPackJson);

        FluxPackService service(logger, projects, downloadService, pathSettings);
        service.initialize();
        const FluxPackInstallResult result = service.installFluxPack(FluxPackInstallRequest{
            fluxPack,
            installRoot,
            {},
            existing.configPath
        });

        EXPECT_TRUE(result.updatedExistingProject);
        EXPECT_EQ(result.totalSourceCount, 1U);
        EXPECT_EQ(result.reusedSourceCount, 1U);
        EXPECT_EQ(result.installedSourceCount, 0U);
        EXPECT_EQ(result.failedSourceCount, 0U);
        EXPECT_FALSE(result.hasWarnings);
        EXPECT_EQ(readTextFile(installedFile), "already installed");
        EXPECT_EQ(std::filesystem::last_write_time(installedFile), preservedWriteTime);

        service.shutdown();
        downloadService.shutdown();
        projects.shutdown();
        templates.shutdown();
        pathSettings.shutdown();
        settings.shutdown();
        logger.shutdown();
#endif
    }

    TEST(FluxPackServiceTests, UpdateExistingBuildReusesMatchingDownloadArchive)
    {
#ifndef _WIN32
        GTEST_SKIP() << "FluxPack install project creation uses Windows game detection in this build.";
#else
        TempDirectory temp;
        ScopedEnvironmentVariable appData(L"APPDATA", (temp.path() / L"AppData").wstring());

        const std::filesystem::path game = temp.path() / L"Skyrim Special Edition";
        const std::filesystem::path installRoot = temp.path() / L"Builds";
        const std::filesystem::path fluxPack = temp.path() / L"Foundation Cached Source Update.fluxpack";
        writeTextFile(game / L"SkyrimSE.exe", "MZ");
        writeTextFile(game / L"Data" / L"Skyrim.esm", "master");

        Logger logger;
        logger.initialize();
        AppSettingsService settings(logger);
        settings.initialize();
        TemplateService templates(logger);
        templates.initialize();
        ProjectService projects(logger, templates);
        projects.initialize();
        BuildPathSettingsService pathSettings(logger);
        pathSettings.initialize();
        DownloadService downloadService(logger, settings, pathSettings);
        downloadService.initialize();

        const ProjectDescriptor existing = projects.createProject(ProjectCreateRequest{
            L"Foundation Edition",
            L"skyrimse",
            game,
            installRoot,
            true
        });
        const BuildPathSettings existingPaths = pathSettings.loadForConfig(existing.configPath);
        const std::filesystem::path oldModDirectory = existingPaths.modsDirectory / L"SkyUI";
        const std::filesystem::path oldOnlyFile = oldModDirectory / L"old-only.txt";
        writeTextFile(oldOnlyFile, "old version");
        InstalledModImportRecord oldInstalledMod;
        oldInstalledMod.modDirectory = oldModDirectory;
        oldInstalledMod.displayName = L"SkyUI";
        oldInstalledMod.version = L"5.1";
        oldInstalledMod.isEnabled = true;
        oldInstalledMod.source = ModSourceRecord{
            L"nexus",
            L"skyrimspecialedition",
            L"3863",
            L"122",
            L"nxm://skyrimspecialedition/mods/3863/files/122",
            {},
            L"5.1"
        };
        InstanceMetadataStore::registerInstalledMods(existing.projectDirectory, {oldInstalledMod});

        const std::filesystem::path cachedArchive = existingPaths.downloadsDirectory / L"SkyUI.bsa";
        writeTextFile(cachedArchive, "archive");
        const auto preservedWriteTime =
            std::filesystem::file_time_type::clock::now() - std::chrono::hours(24);
        std::filesystem::last_write_time(cachedArchive, preservedWriteTime);
        const std::wstring archiveHash = computeFluxPackFileSha256(cachedArchive);

        const std::string fluxPackJson =
            std::string("{")
            + "\"format\":\"FluxPack\","
            + "\"formatVersion\":1,"
            + "\"build\":{"
            + "\"name\":\"Foundation Edition\","
            + "\"templateId\":\"skyrimse\","
            + "\"gameName\":\"Skyrim Special Edition\","
            + "\"gamePath\":\"" + toUtf8(game.generic_wstring()) + "\","
            + "\"projectDirectoryHint\":\"\","
            + "\"defaultProfile\":\"Default\""
            + "},"
            + "\"policies\":{\"generatedAssets\":\"confirm-before-including\"},"
            + "\"sourceArchives\":[{"
            + "\"folderName\":\"SkyUI\","
            + "\"displayName\":\"SkyUI\","
            + "\"version\":\"5.2\","
            + "\"enabled\":true,"
            + "\"archiveHash\":{\"algorithm\":\"sha256\",\"value\":\"" + toUtf8(archiveHash) + "\",\"status\":\"matched-local-download\"},"
            + "\"archiveFileName\":\"SkyUI.bsa\","
            + "\"archiveSize\":7,"
            + "\"requiresDownload\":true,"
            + "\"source\":{"
            + "\"provider\":\"nexus\","
            + "\"gameDomain\":\"skyrimspecialedition\","
            + "\"remoteModId\":\"3863\","
            + "\"remoteFileId\":\"123\","
            + "\"url\":\"nxm://skyrimspecialedition/mods/3863/files/123\","
            + "\"latestVersion\":\"5.2\""
            + "}"
            + "}],"
            + "\"generatedAssets\":[],"
            + "\"customPatches\":[],"
            + "\"customConfigs\":[],"
            + "\"installPlan\":{"
            + "\"version\":1,"
            + "\"defaultProfile\":\"Default\","
            + "\"stages\":[{\"id\":\"source-archives\",\"title\":\"Download\",\"policy\":\"reference-only\",\"requires\":[]}],"
            + "\"profileOrder\":[],"
            + "\"targetPaths\":{}"
            + "}"
            + "}";
        writeTextFile(fluxPack, fluxPackJson);

        FluxPackService service(logger, projects, downloadService, pathSettings);
        service.initialize();
        const FluxPackInstallResult result = service.installFluxPack(FluxPackInstallRequest{
            fluxPack,
            installRoot,
            {},
            existing.configPath
        });

        EXPECT_TRUE(result.updatedExistingProject);
        EXPECT_EQ(result.reusedDownloadCount, 1U);
        EXPECT_EQ(result.reusedSourceCount, 0U);
        EXPECT_EQ(result.installedSourceCount, 1U);
        EXPECT_EQ(result.failedSourceCount, 0U);
        EXPECT_FALSE(result.hasWarnings);
        EXPECT_EQ(std::filesystem::last_write_time(cachedArchive), preservedWriteTime);
        EXPECT_EQ(
            readTextFile(existingPaths.modsDirectory / L"SkyUI" / L"SkyUI.bsa"),
            "archive");
        EXPECT_FALSE(std::filesystem::exists(oldOnlyFile));

        service.shutdown();
        downloadService.shutdown();
        projects.shutdown();
        templates.shutdown();
        pathSettings.shutdown();
        settings.shutdown();
        logger.shutdown();
#endif
    }
}
