#include "FluxoraCore/GameSupport/GameInstallDiscoveryService.hpp"
#include "FluxoraCore/GameSupport/GameDefinitionLoader.hpp"
#include "FluxoraCore/Services/Logger.hpp"
#include "FluxoraCore/Services/ProjectService.hpp"
#include "FluxoraCore/Services/TemplateService.hpp"

#include "TestFilesystem.hpp"

#include <gtest/gtest.h>

#include <chrono>
#include <memory>
#include <map>
#include <string>
#include <system_error>
#include <utility>
#include <vector>

namespace fluxora::tests
{
    namespace
    {
        struct RegistryLookupKey
        {
            GameInstallRegistryHive hive;
            GameInstallRegistryView view;
            std::wstring keyPath;
            std::wstring valueName;

            auto operator<=>(const RegistryLookupKey&) const = default;
        };

        struct RegistryPathKey
        {
            GameInstallRegistryHive hive;
            GameInstallRegistryView view;
            std::wstring keyPath;

            auto operator<=>(const RegistryPathKey&) const = default;
        };

        class FakeInstallRegistry final : public IGameInstallRegistry
        {
        public:
            [[nodiscard]] std::optional<std::wstring> readString(
                GameInstallRegistryHive hive,
                GameInstallRegistryView view,
                std::wstring_view keyPath,
                std::wstring_view valueName) const override
            {
                ++readStringCalls;
                if (failure.has_value())
                {
                    throw std::system_error(*failure, "registry read failed");
                }
                const auto found = values.find(RegistryLookupKey{
                    hive,
                    view,
                    std::wstring(keyPath),
                    std::wstring(valueName)});
                return found == values.end()
                    ? std::nullopt
                    : std::optional<std::wstring>(found->second);
            }

            [[nodiscard]] std::vector<GameInstallRegistrySubkey> listSubkeys(
                GameInstallRegistryHive hive,
                GameInstallRegistryView view,
                std::wstring_view keyPath) const override
            {
                ++listSubkeysCalls;
                if (failure.has_value())
                {
                    throw std::system_error(*failure, "registry enumeration failed");
                }
                const auto found = subkeys.find(RegistryPathKey{
                    hive, view, std::wstring(keyPath)});
                return found == subkeys.end()
                    ? std::vector<GameInstallRegistrySubkey>{}
                    : found->second;
            }

            [[nodiscard]] std::int64_t lastWriteTime(
                GameInstallRegistryHive hive,
                GameInstallRegistryView view,
                std::wstring_view keyPath) const override
            {
                ++lastWriteTimeCalls;
                if (failure.has_value())
                {
                    throw std::system_error(*failure, "registry timestamp failed");
                }
                const auto found = timestamps.find(RegistryPathKey{
                    hive, view, std::wstring(keyPath)});
                return found == timestamps.end() ? 0 : found->second;
            }

            std::map<RegistryLookupKey, std::wstring> values;
            std::map<RegistryPathKey, std::vector<GameInstallRegistrySubkey>> subkeys;
            std::map<RegistryPathKey, std::int64_t> timestamps;
            std::optional<std::error_code> failure;
            mutable std::size_t readStringCalls{0};
            mutable std::size_t listSubkeysCalls{0};
            mutable std::size_t lastWriteTimeCalls{0};
        };

        class FakeInstallProvider final : public IGameInstallDiscoveryProvider
        {
        public:
            FakeInstallProvider(
                GameInstallDiscoveryProviderId id,
                std::wstring fingerprint,
                GameInstallProviderScan scan)
                : id_(id),
                  fingerprint_(std::move(fingerprint)),
                  scan_(std::move(scan))
            {
            }

            [[nodiscard]] GameInstallDiscoveryProviderId id() const noexcept override
            {
                return id_;
            }

            [[nodiscard]] std::wstring fingerprint(
                const GameDefinition&,
                const GameInstallDiscoveryRequest&) const override
            {
                ++fingerprintCalls;
                return fingerprint_;
            }

            [[nodiscard]] GameInstallProviderScan scan(
                const GameDefinition&,
                const GameInstallDiscoveryRequest&) const override
            {
                ++scanCalls;
                return scan_;
            }

            mutable int fingerprintCalls{0};
            mutable int scanCalls{0};

            void setFingerprint(std::wstring value)
            {
                fingerprint_ = std::move(value);
            }

            void setScan(GameInstallProviderScan value)
            {
                scan_ = std::move(value);
            }

        private:
            GameInstallDiscoveryProviderId id_;
            std::wstring fingerprint_;
            GameInstallProviderScan scan_;
        };

        class ThrowingInstallProvider final : public IGameInstallDiscoveryProvider
        {
        public:
            explicit ThrowingInstallProvider(GameInstallDiscoveryProviderId id) : id_(id) {}

            [[nodiscard]] GameInstallDiscoveryProviderId id() const noexcept override
            {
                return id_;
            }

            [[nodiscard]] std::wstring fingerprint(
                const GameDefinition&,
                const GameInstallDiscoveryRequest&) const override
            {
                throw std::runtime_error("provider unavailable");
            }

            [[nodiscard]] GameInstallProviderScan scan(
                const GameDefinition&,
                const GameInstallDiscoveryRequest&) const override
            {
                throw std::runtime_error("provider unavailable");
            }

        private:
            GameInstallDiscoveryProviderId id_;
        };

        [[nodiscard]] GameDefinition syntheticDefinition(std::wstring_view provider)
        {
            std::wstring json = LR"json({
                "schemaVersion":"1",
                "definitionVersion":"1.0.0",
                "id":"examplegame",
                "displayName":"Example Game",
                "aliases":["Example"],
                "installDiscovery":{"providers":[)json";
            json.append(provider);
            json.append(LR"json(]},
                "requiredFiles":["Example.exe"],
                "executables":[{"id":"game","displayName":"Example","name":"Example.exe","role":"primary"}],
                "executableRoles":{"primary":"Example.exe"},
                "archiveExtensions":[".zip"],
                "pluginExtensions":[".esp"],
                "capabilities":{
                    "supportsPlugins":false,
                    "supportsLoadOrder":false,
                    "supportsRootFiles":false,
                    "supportsArchives":false,
                    "supportsScriptExtender":false,
                    "supportsIniProfiles":false,
                    "supportsSaveProfiles":false,
                    "supportsGameSpecificVfs":false,
                    "supportsContentLayoutRules":false
                },
                "uiTemplateId":"examplegame",
                "healthRules":{"requiredFiles":["Example.exe"]}
            })json");
            return GameDefinitionLoader::loadDefinition(json);
        }

    }

    TEST(GameInstallDiscoveryServiceTests, SteamUsesRegistryLibrariesAndOnlyExactAppManifestIds)
    {
        TempDirectory temp;
        const std::filesystem::path steamRoot = temp.path() / "steam";
        const std::filesystem::path secondaryLibrary = temp.path() / "secondary";
        const std::filesystem::path nestedAppValue = temp.path() / "not-a-library";
        const auto escapeVdfPath = [](const std::filesystem::path& path)
        {
            std::string escaped;
            for (const char character : path.string())
            {
                escaped.append(character == '\\' ? "\\\\" : std::string(1, character));
            }
            return escaped;
        };
        writeTextFile(
            steamRoot / "steamapps" / "libraryfolders.vdf",
            "\"libraryfolders\" { \"1\" { \"path\" \"" +
                escapeVdfPath(secondaryLibrary) +
                "\" \"apps\" { \"489830\" \"" + escapeVdfPath(nestedAppValue) +
                "\" } } }");
        writeTextFile(
            secondaryLibrary / "steamapps" / "appmanifest_489830.acf",
            "\"AppState\" { \"appid\" \"489830\" \"installdir\" \"Skyrim Special Edition\" }");
        writeTextFile(
            nestedAppValue / "steamapps" / "appmanifest_489830.acf",
            "\"AppState\" { \"appid\" \"489830\" \"installdir\" \"Nested App Value\" }");
        writeTextFile(
            secondaryLibrary / "steamapps" / "appmanifest_4898300.acf",
            "\"AppState\" { \"appid\" \"4898300\" \"installdir\" \"Wrong Game\" }");

        auto registry = std::make_shared<FakeInstallRegistry>();
        registry->values.emplace(
            RegistryLookupKey{
                GameInstallRegistryHive::CurrentUser,
                GameInstallRegistryView::Default,
                L"Software\\Valve\\Steam",
                L"SteamPath"},
            steamRoot.wstring());
        const GameDefinition& skyrim =
            GameSupportRegistry::embedded().definitions().front();
        const auto provider = createSteamGameInstallDiscoveryProvider(registry);

        const GameInstallProviderScan scan = provider->scan(
            skyrim,
            GameInstallDiscoveryRequest{});

        ASSERT_FALSE(scan.hadErrors);
        ASSERT_EQ(scan.candidates.size(), 1U);
        EXPECT_EQ(
            scan.candidates.front().installPath,
            secondaryLibrary / "steamapps" / "common" / "Skyrim Special Edition");
    }

    TEST(GameInstallDiscoveryServiceTests, SteamDoesNotRecursivelySearchForAppManifests)
    {
        TempDirectory temp;
        const std::filesystem::path steamRoot = temp.path() / "steam";
        writeTextFile(
            steamRoot / "steamapps" / "nested" / "appmanifest_489830.acf",
            "\"AppState\" { \"appid\" \"489830\" \"installdir\" \"Skyrim\" }");
        auto registry = std::make_shared<FakeInstallRegistry>();
        registry->values.emplace(
            RegistryLookupKey{
                GameInstallRegistryHive::CurrentUser,
                GameInstallRegistryView::Default,
                L"Software\\Valve\\Steam",
                L"SteamPath"},
            steamRoot.wstring());
        const auto provider = createSteamGameInstallDiscoveryProvider(registry);

        const GameInstallProviderScan scan = provider->scan(
            GameSupportRegistry::embedded().definitions().front(),
            GameInstallDiscoveryRequest{});

        EXPECT_FALSE(scan.hadErrors);
        EXPECT_TRUE(scan.candidates.empty());
    }

    TEST(GameInstallDiscoveryServiceTests, SteamSkipsUnavailableRemoteLibrariesWithoutBlocking)
    {
        TempDirectory temp;
        const std::filesystem::path steamRoot = temp.path() / "steam";
        writeTextFile(
            steamRoot / "steamapps" / "libraryfolders.vdf",
            R"vdf("libraryfolders" { "1" { "path" "\\\\offline.invalid\\library" } })vdf");
        auto registry = std::make_shared<FakeInstallRegistry>();
        registry->values.emplace(
            RegistryLookupKey{
                GameInstallRegistryHive::CurrentUser,
                GameInstallRegistryView::Default,
                L"Software\\Valve\\Steam",
                L"SteamPath"},
            steamRoot.wstring());
        const auto provider = createSteamGameInstallDiscoveryProvider(registry);
        const auto started = std::chrono::steady_clock::now();

        (void)provider->fingerprint(
            GameSupportRegistry::embedded().definitions().front(),
            GameInstallDiscoveryRequest{});
        const GameInstallProviderScan scan = provider->scan(
            GameSupportRegistry::embedded().definitions().front(),
            GameInstallDiscoveryRequest{});
        const auto milliseconds = std::chrono::duration_cast<std::chrono::milliseconds>(
            std::chrono::steady_clock::now() - started).count();

        EXPECT_TRUE(scan.hadErrors);
        EXPECT_TRUE(scan.candidates.empty());
        EXPECT_LE(milliseconds, 50);
    }

    TEST(GameInstallDiscoveryServiceTests, GogReadsExactProductFromBothRegistryViews)
    {
        TempDirectory temp;
        auto registry = std::make_shared<FakeInstallRegistry>();
        const std::wstring key = L"SOFTWARE\\GOG.com\\Games\\1711230643";
        const std::filesystem::path install32 = temp.path() / "GOG32" / "Skyrim";
        const std::filesystem::path install64 = temp.path() / "GOG64" / "Skyrim";
        registry->values.emplace(
            RegistryLookupKey{GameInstallRegistryHive::LocalMachine,
                GameInstallRegistryView::Registry32, key, L"path"},
            install32.wstring());
        registry->values.emplace(
            RegistryLookupKey{GameInstallRegistryHive::LocalMachine,
                GameInstallRegistryView::Registry64, key, L"path"},
            install64.wstring());
        registry->timestamps.emplace(
            RegistryPathKey{GameInstallRegistryHive::LocalMachine,
                GameInstallRegistryView::Registry32, key},
            10);
        registry->timestamps.emplace(
            RegistryPathKey{GameInstallRegistryHive::LocalMachine,
                GameInstallRegistryView::Registry64, key},
            20);
        const auto provider = createGogGameInstallDiscoveryProvider(registry);

        const GameInstallProviderScan scan = provider->scan(
            GameSupportRegistry::embedded().definitions().front(),
            GameInstallDiscoveryRequest{});

        ASSERT_FALSE(scan.hadErrors);
        ASSERT_EQ(scan.candidates.size(), 2U);
        EXPECT_EQ(scan.candidates[0].freshness, 10);
        EXPECT_EQ(scan.candidates[1].freshness, 20);
    }

    TEST(GameInstallDiscoveryServiceTests, EpicMatchesOnlyDeclaredManifestIdentifiers)
    {
        TempDirectory temp;
        const std::filesystem::path manifests = temp.path() / "epic-manifests";
        writeTextFile(
            manifests / "matching.item",
            R"json({"AppName":"example-product","InstallLocation":"C:\\Games\\Example"})json");
        writeTextFile(
            manifests / "other.item",
            R"json({"AppName":"other-product","InstallLocation":"C:\\Games\\Other"})json");
        const GameDefinition definition = syntheticDefinition(
            LR"json({"id":"epic","productIds":["example-product"]})json");
        const auto provider = createEpicGameInstallDiscoveryProvider(
            GameInstallDiscoverySystemPaths{manifests});

        const GameInstallProviderScan scan = provider->scan(
            definition,
            GameInstallDiscoveryRequest{});

        ASSERT_FALSE(scan.hadErrors);
        ASSERT_EQ(scan.candidates.size(), 1U);
        EXPECT_EQ(scan.candidates.front().installPath, std::filesystem::path(L"C:\\Games\\Example"));
    }

    TEST(GameInstallDiscoveryServiceTests, EpicIsolatesDamagedManifests)
    {
        TempDirectory temp;
        const std::filesystem::path manifests = temp.path() / "epic-manifests";
        writeTextFile(manifests / "damaged.item", "{not-json");
        writeTextFile(
            manifests / "matching.item",
            R"json({"CatalogItemId":"example-product","InstallLocation":"C:\\Games\\Example"})json");
        const GameDefinition definition = syntheticDefinition(
            LR"json({"id":"epic","productIds":["example-product"]})json");
        const auto provider = createEpicGameInstallDiscoveryProvider(
            GameInstallDiscoverySystemPaths{manifests});

        const GameInstallProviderScan scan = provider->scan(
            definition,
            GameInstallDiscoveryRequest{});

        EXPECT_TRUE(scan.hadErrors);
        ASSERT_EQ(scan.candidates.size(), 1U);
        EXPECT_EQ(scan.candidates.front().installPath, std::filesystem::path(L"C:\\Games\\Example"));
    }

    TEST(GameInstallDiscoveryServiceTests, WindowsUninstallAcceptsPrimaryDisplayIconAndRejectsLauncher)
    {
        auto registry = std::make_shared<FakeInstallRegistry>();
        constexpr std::wstring_view root =
            L"SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall";
        const RegistryPathKey rootKey{
            GameInstallRegistryHive::LocalMachine,
            GameInstallRegistryView::Registry64,
            std::wstring(root)};
        registry->subkeys[rootKey] = {
            GameInstallRegistrySubkey{L"primary", 20},
            GameInstallRegistrySubkey{L"launcher", 30}
        };
        registry->values.emplace(
            RegistryLookupKey{rootKey.hive, rootKey.view,
                std::wstring(root) + L"\\primary", L"DisplayIcon"},
            L"\"C:\\Games\\Example\\Example.exe\",0");
        registry->values.emplace(
            RegistryLookupKey{rootKey.hive, rootKey.view,
                std::wstring(root) + L"\\launcher", L"DisplayIcon"},
            L"C:\\Games\\Example\\ExampleLauncher.exe,0");
        const GameDefinition definition = syntheticDefinition(
            LR"json({"id":"windows","productIds":[]})json");
        const auto provider = createWindowsGameInstallDiscoveryProvider(registry);

        const GameInstallProviderScan scan = provider->scan(
            definition,
            GameInstallDiscoveryRequest{});

        ASSERT_FALSE(scan.hadErrors);
        ASSERT_EQ(scan.candidates.size(), 1U);
        EXPECT_EQ(
            scan.candidates.front().installPath,
            std::filesystem::path(L"C:\\Games\\Example\\Example.exe"));
    }

    TEST(GameInstallDiscoveryServiceTests, RegistryAccessFailureIsIndeterminateRatherThanNotFound)
    {
        auto registryAdapter = std::make_shared<FakeInstallRegistry>();
        registryAdapter->failure = std::make_error_code(std::errc::permission_denied);
        std::vector<std::unique_ptr<IGameInstallDiscoveryProvider>> providers;
        providers.push_back(createWindowsGameInstallDiscoveryProvider(registryAdapter));
        GameSupportRegistry definitions({syntheticDefinition(
            LR"json({"id":"windows","productIds":[]})json")});
        GameInstallDiscoveryService service(nullptr, definitions, std::move(providers));

        const GameInstallDiscoverySnapshot snapshot = service.discover(
            GameInstallDiscoveryRequest{{}, L"op-registry-denied"});

        ASSERT_EQ(snapshot.installs.size(), 1U);
        EXPECT_EQ(
            snapshot.installs.front().resolution,
            GameInstallResolutionKind::Indeterminate);
        EXPECT_GT(registryAdapter->listSubkeysCalls, 0U);
    }

    TEST(GameInstallDiscoveryServiceTests, CacheReusesProviderScanAndInvalidatesOnlyChangedFingerprint)
    {
        TempDirectory temp;
        const std::filesystem::path install = temp.path() / "Skyrim";
        writeTextFile(install / "SkyrimSE.exe", "exe");
        writeTextFile(install / "Data" / "Skyrim.esm", "master");
        auto provider = std::make_unique<FakeInstallProvider>(
            GameInstallDiscoveryProviderId::Steam,
            L"v1",
            GameInstallProviderScan{{GameInstallDiscoveryCandidate{install, 1}}, false});
        FakeInstallProvider* view = provider.get();
        std::vector<std::unique_ptr<IGameInstallDiscoveryProvider>> providers;
        providers.push_back(std::move(provider));
        GameInstallDiscoveryService service(
            nullptr,
            GameSupportRegistry::embedded(),
            std::move(providers));

        (void)service.discover(GameInstallDiscoveryRequest{{}, L"op-1"});
        (void)service.discover(GameInstallDiscoveryRequest{{}, L"op-2"});
        EXPECT_EQ(view->scanCalls, 1);

        view->setFingerprint(L"v2");
        (void)service.discover(GameInstallDiscoveryRequest{{}, L"op-3"});
        EXPECT_EQ(view->scanCalls, 2);
    }

    TEST(GameInstallDiscoveryServiceTests, CacheDoesNotReuseIncompleteProviderScans)
    {
        auto provider = std::make_unique<FakeInstallProvider>(
            GameInstallDiscoveryProviderId::Steam,
            L"stable-fingerprint",
            GameInstallProviderScan{{}, true});
        FakeInstallProvider* view = provider.get();
        std::vector<std::unique_ptr<IGameInstallDiscoveryProvider>> providers;
        providers.push_back(std::move(provider));
        GameSupportRegistry registry({syntheticDefinition(
            LR"json({"id":"steam","productIds":["example-product"]})json")});
        GameInstallDiscoveryService service(nullptr, registry, std::move(providers));

        const GameInstallDiscoverySnapshot incomplete = service.discover(
            GameInstallDiscoveryRequest{{}, L"op-incomplete"});
        view->setScan(GameInstallProviderScan{});
        const GameInstallDiscoverySnapshot recovered = service.discover(
            GameInstallDiscoveryRequest{{}, L"op-recovered"});

        ASSERT_EQ(incomplete.installs.size(), 1U);
        EXPECT_EQ(
            incomplete.installs.front().resolution,
            GameInstallResolutionKind::Indeterminate);
        ASSERT_EQ(recovered.installs.size(), 1U);
        EXPECT_EQ(recovered.installs.front().resolution, GameInstallResolutionKind::NotFound);
        EXPECT_EQ(view->scanCalls, 2);
    }

    TEST(GameInstallDiscoveryServiceTests, CacheInvalidatesOnlyTheChangedProviderSource)
    {
        TempDirectory temp;
        const std::filesystem::path install = temp.path() / "Skyrim";
        writeTextFile(install / "SkyrimSE.exe", "exe");
        writeTextFile(install / "Data" / "Skyrim.esm", "master");
        auto fluxoraProvider = std::make_unique<FakeInstallProvider>(
            GameInstallDiscoveryProviderId::Fluxora,
            L"fluxora-v1",
            GameInstallProviderScan{});
        auto steamProvider = std::make_unique<FakeInstallProvider>(
            GameInstallDiscoveryProviderId::Steam,
            L"steam-v1",
            GameInstallProviderScan{{GameInstallDiscoveryCandidate{install, 1}}, false});
        FakeInstallProvider* fluxoraView = fluxoraProvider.get();
        FakeInstallProvider* steamView = steamProvider.get();
        std::vector<std::unique_ptr<IGameInstallDiscoveryProvider>> providers;
        providers.push_back(std::move(fluxoraProvider));
        providers.push_back(std::move(steamProvider));
        GameInstallDiscoveryService service(
            nullptr,
            GameSupportRegistry::embedded(),
            std::move(providers));

        (void)service.discover(GameInstallDiscoveryRequest{{}, L"op-1"});
        steamView->setFingerprint(L"steam-v2");
        (void)service.discover(GameInstallDiscoveryRequest{{}, L"op-2"});

        EXPECT_EQ(fluxoraView->scanCalls, 1);
        EXPECT_EQ(steamView->scanCalls, 2);
    }

    TEST(GameInstallDiscoveryServiceTests, ReportsNotFoundAndIndeterminateWithoutLeakingCandidateFields)
    {
        const auto run = [](bool hadErrors)
        {
            std::vector<std::unique_ptr<IGameInstallDiscoveryProvider>> providers;
            for (const GameInstallDiscoveryProviderId id : {
                     GameInstallDiscoveryProviderId::Fluxora,
                     GameInstallDiscoveryProviderId::Steam,
                     GameInstallDiscoveryProviderId::Gog,
                     GameInstallDiscoveryProviderId::Windows})
            {
                providers.push_back(std::make_unique<FakeInstallProvider>(
                    id,
                    L"empty",
                    GameInstallProviderScan{{}, hadErrors && id == GameInstallDiscoveryProviderId::Steam}));
            }
            GameInstallDiscoveryService service(
                nullptr,
                GameSupportRegistry::embedded(),
                std::move(providers));
            return service.discover(GameInstallDiscoveryRequest{{}, L"op-empty"}).installs.front();
        };

        const GameInstallResolution notFound = run(false);
        EXPECT_EQ(notFound.resolution, GameInstallResolutionKind::NotFound);
        EXPECT_FALSE(notFound.primaryExecutablePath.has_value());
        EXPECT_FALSE(notFound.providerId.has_value());

        const GameInstallResolution indeterminate = run(true);
        EXPECT_EQ(indeterminate.resolution, GameInstallResolutionKind::Indeterminate);
        EXPECT_FALSE(indeterminate.primaryExecutablePath.has_value());
        EXPECT_FALSE(indeterminate.providerId.has_value());
    }

    TEST(GameInstallDiscoveryServiceTests, RanksNewestCandidateThenNormalizedPathWithinProvider)
    {
        TempDirectory temp;
        const std::filesystem::path older = temp.path() / "B-older";
        const std::filesystem::path newerA = temp.path() / "A-newer";
        const std::filesystem::path newerZ = temp.path() / "Z-newer";
        for (const auto& install : {older, newerA, newerZ})
        {
            writeTextFile(install / "Example.exe", "exe");
        }
        const GameDefinition definition = syntheticDefinition(
            LR"json({"id":"steam","productIds":["example-product"]})json");
        GameSupportRegistry registry({definition});
        std::vector<std::unique_ptr<IGameInstallDiscoveryProvider>> providers;
        providers.push_back(std::make_unique<FakeInstallProvider>(
            GameInstallDiscoveryProviderId::Steam,
            L"rank-v1",
            GameInstallProviderScan{{
                GameInstallDiscoveryCandidate{older, 1},
                GameInstallDiscoveryCandidate{newerZ, 2},
                GameInstallDiscoveryCandidate{newerA, 2}}, false}));
        GameInstallDiscoveryService service(nullptr, registry, std::move(providers));

        const GameInstallDiscoverySnapshot snapshot = service.discover(
            GameInstallDiscoveryRequest{{}, L"op-rank"});
        const GameInstallResolution& result = snapshot.installs.front();

        ASSERT_EQ(result.resolution, GameInstallResolutionKind::Found);
        ASSERT_TRUE(result.primaryExecutablePath.has_value());
        EXPECT_EQ(
            result.primaryExecutablePath.value(),
            std::filesystem::weakly_canonical(newerA / "Example.exe"));
    }

    TEST(GameInstallDiscoveryServiceTests, HonorsDeclarativeProviderPriorityForSyntheticGames)
    {
        TempDirectory temp;
        const std::filesystem::path steamInstall = temp.path() / "Steam";
        const std::filesystem::path fluxoraInstall = temp.path() / "Fluxora";
        writeTextFile(steamInstall / "Example.exe", "exe");
        writeTextFile(fluxoraInstall / "Example.exe", "exe");
        const GameDefinition definition = syntheticDefinition(
            LR"json({"id":"steam","productIds":["example-product"]},{"id":"fluxora","productIds":[]})json");
        GameSupportRegistry registry({definition});
        std::vector<std::unique_ptr<IGameInstallDiscoveryProvider>> providers;
        providers.push_back(std::make_unique<FakeInstallProvider>(
            GameInstallDiscoveryProviderId::Fluxora,
            L"fluxora",
            GameInstallProviderScan{{GameInstallDiscoveryCandidate{fluxoraInstall, 100}}, false}));
        providers.push_back(std::make_unique<FakeInstallProvider>(
            GameInstallDiscoveryProviderId::Steam,
            L"steam",
            GameInstallProviderScan{{GameInstallDiscoveryCandidate{steamInstall, 1}}, false}));
        GameInstallDiscoveryService service(nullptr, registry, std::move(providers));

        const GameInstallDiscoverySnapshot snapshot = service.discover(
            GameInstallDiscoveryRequest{{}, L"op-provider-priority"});
        const GameInstallResolution& result = snapshot.installs.front();

        EXPECT_EQ(
            result.providerId,
            std::optional<GameInstallDiscoveryProviderId>(GameInstallDiscoveryProviderId::Steam));
    }

#ifdef _WIN32
    TEST(GameInstallDiscoveryServiceTests, ProductionProvidersMeetColdAndWarmWindowsBudget)
    {
        TempDirectory temp;
        const std::filesystem::path buildConfigs = temp.path() / "build-configs";
        const std::filesystem::path steamRoot = temp.path() / "steam";
        const std::filesystem::path manifests = temp.path() / "epic-manifests";
        std::filesystem::create_directories(buildConfigs);
        std::string escapedSteamRoot;
        for (const char character : steamRoot.string())
        {
            escapedSteamRoot.append(character == '\\' ? "\\\\" : std::string(1, character));
        }
        writeTextFile(
            steamRoot / "steamapps" / "libraryfolders.vdf",
            "\"libraryfolders\" { \"0\" { \"path\" \"" + escapedSteamRoot +
                "\" \"apps\" { \"489830\" \"123456\" } } }");
        for (int index = 0; index < 500; ++index)
        {
            writeTextFile(
                manifests / ("unrelated-" + std::to_string(index) + ".item"),
                "{\"AppName\":\"unrelated-" + std::to_string(index) +
                    "\",\"InstallLocation\":\"C:\\\\Missing\"}");
        }

        auto registryAdapter = std::make_shared<FakeInstallRegistry>();
        registryAdapter->values.emplace(
            RegistryLookupKey{
                GameInstallRegistryHive::CurrentUser,
                GameInstallRegistryView::Default,
                L"Software\\Valve\\Steam",
                L"SteamPath"},
            steamRoot.wstring());
        constexpr std::wstring_view uninstallRoot =
            L"SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall";
        std::vector<GameInstallRegistrySubkey>& uninstallEntries = registryAdapter->subkeys[
            RegistryPathKey{
                GameInstallRegistryHive::LocalMachine,
                GameInstallRegistryView::Registry64,
                std::wstring(uninstallRoot)}];
        uninstallEntries.reserve(500U);
        for (int index = 0; index < 500; ++index)
        {
            uninstallEntries.push_back(GameInstallRegistrySubkey{
                L"unrelated-" + std::to_wstring(index),
                index});
        }

        const GameDefinition definition = syntheticDefinition(
            LR"json(
                {"id":"fluxora","productIds":[]},
                {"id":"steam","productIds":["missing-steam-product"]},
                {"id":"gog","productIds":["missing-gog-product"]},
                {"id":"epic","productIds":["missing-epic-product"]},
                {"id":"windows","productIds":[]}
            )json");
        GameSupportRegistry definitions({definition});
        Logger logger;
        TemplateService templates(logger);
        templates.initialize();
        ProjectService projects(logger, templates);
        projects.initialize();
        std::vector<std::unique_ptr<IGameInstallDiscoveryProvider>> providers;
        providers.push_back(createFluxoraGameInstallDiscoveryProvider(projects));
        providers.push_back(createSteamGameInstallDiscoveryProvider(registryAdapter));
        providers.push_back(createGogGameInstallDiscoveryProvider(registryAdapter));
        providers.push_back(createEpicGameInstallDiscoveryProvider(
            GameInstallDiscoverySystemPaths{manifests}));
        providers.push_back(createWindowsGameInstallDiscoveryProvider(registryAdapter));
        GameInstallDiscoveryService service(nullptr, definitions, std::move(providers));

        const auto coldStarted = std::chrono::steady_clock::now();
        const GameInstallDiscoverySnapshot cold = service.discover(
            GameInstallDiscoveryRequest{buildConfigs, L"op-cold"});
        const auto coldMicroseconds = std::chrono::duration_cast<std::chrono::microseconds>(
            std::chrono::steady_clock::now() - coldStarted).count();
        const auto warmStarted = std::chrono::steady_clock::now();
        const GameInstallDiscoverySnapshot warm = service.discover(
            GameInstallDiscoveryRequest{buildConfigs, L"op-warm"});
        const auto warmMicroseconds = std::chrono::duration_cast<std::chrono::microseconds>(
            std::chrono::steady_clock::now() - warmStarted).count();

        ASSERT_EQ(cold.installs.front().resolution, GameInstallResolutionKind::NotFound);
        ASSERT_EQ(warm.installs.front().resolution, GameInstallResolutionKind::NotFound);
        EXPECT_GE(registryAdapter->readStringCalls, 1500U);
        EXPECT_GE(registryAdapter->listSubkeysCalls, 12U);
        EXPECT_GE(registryAdapter->lastWriteTimeCalls, 4U);
        EXPECT_LE(coldMicroseconds, 150'000);
        EXPECT_LE(warmMicroseconds, 5'000);
    }
#endif

    TEST(GameInstallDiscoveryServiceTests, ProviderFailureIsIsolatedAndLaterProviderCanWin)
    {
        TempDirectory temp;
        const std::filesystem::path install = temp.path() / "Skyrim";
        writeTextFile(install / "SkyrimSE.exe", "exe");
        writeTextFile(install / "Data" / "Skyrim.esm", "master");
        std::vector<std::unique_ptr<IGameInstallDiscoveryProvider>> providers;
        providers.push_back(std::make_unique<ThrowingInstallProvider>(
            GameInstallDiscoveryProviderId::Fluxora));
        providers.push_back(std::make_unique<FakeInstallProvider>(
            GameInstallDiscoveryProviderId::Steam,
            L"steam-ok",
            GameInstallProviderScan{{GameInstallDiscoveryCandidate{install, 1}}, false}));
        GameInstallDiscoveryService service(
            nullptr,
            GameSupportRegistry::embedded(),
            std::move(providers));

        const GameInstallDiscoverySnapshot snapshot = service.discover(
            GameInstallDiscoveryRequest{{}, L"op-provider-isolation"});

        ASSERT_EQ(snapshot.installs.size(), 1U);
        EXPECT_EQ(snapshot.installs.front().resolution, GameInstallResolutionKind::Found);
        EXPECT_EQ(
            snapshot.installs.front().providerId,
            std::optional<GameInstallDiscoveryProviderId>(GameInstallDiscoveryProviderId::Steam));
    }

    TEST(GameInstallDiscoveryServiceTests, FindsCanonicalPrimaryExecutableThroughDeclarativeProvider)
    {
        TempDirectory temp;
        const std::filesystem::path install = temp.path() / "Skyrim Special Edition";
        writeTextFile(install / "SkyrimSE.exe", "exe");
        writeTextFile(install / "Data" / "Skyrim.esm", "master");

        auto provider = std::make_unique<FakeInstallProvider>(
            GameInstallDiscoveryProviderId::Steam,
            L"steam-fixture-v1",
            GameInstallProviderScan{
                {GameInstallDiscoveryCandidate{install, 42}},
                false
            });
        FakeInstallProvider* providerView = provider.get();
        std::vector<std::unique_ptr<IGameInstallDiscoveryProvider>> providers;
        providers.push_back(std::move(provider));
        GameInstallDiscoveryService service(
            nullptr,
            GameSupportRegistry::embedded(),
            std::move(providers));

        const GameInstallDiscoverySnapshot snapshot = service.discover(
            GameInstallDiscoveryRequest{{}, L"op-discovery-1"});

        ASSERT_EQ(snapshot.installs.size(), 1U);
        const GameInstallResolution& result = snapshot.installs.front();
        EXPECT_EQ(result.templateId, L"skyrimse");
        EXPECT_EQ(result.resolution, GameInstallResolutionKind::Found);
        ASSERT_TRUE(result.primaryExecutablePath.has_value());
        EXPECT_EQ(
            result.primaryExecutablePath.value(),
            std::filesystem::weakly_canonical(install / "SkyrimSE.exe"));
        ASSERT_TRUE(result.providerId.has_value());
        EXPECT_EQ(result.providerId.value(), GameInstallDiscoveryProviderId::Steam);
        EXPECT_EQ(snapshot.operationId, L"op-discovery-1");
        EXPECT_EQ(providerView->fingerprintCalls, 1);
        EXPECT_EQ(providerView->scanCalls, 1);
    }
}
