#include "FluxoraVfs/VfsTree.hpp"

#include "TestFilesystem.hpp"

#include <gtest/gtest.h>

#include <algorithm>
#include <array>
#include <cstdint>

namespace fluxora::tests
{
    namespace
    {
        bool containsChild(
            const std::vector<vfs::DirChild>& children,
            const std::wstring& name)
        {
            return std::any_of(
                children.begin(),
                children.end(),
                [&name](const vfs::DirChild& child)
                {
                    return vfs::VfsTree::equalsIgnoreCase(child.name, name);
                });
        }

        void expectSamePath(
            const std::wstring& actual,
            const std::filesystem::path& expected)
        {
            EXPECT_EQ(
                normalized(std::filesystem::path(actual)),
                normalized(expected));
        }

        std::vector<std::wstring> createModRoots(
            const std::filesystem::path& root,
            const std::size_t count)
        {
            std::vector<std::wstring> mods;
            mods.reserve(count);
            for (std::size_t index = 0; index < count; ++index)
            {
                const std::filesystem::path mod =
                    root / (std::wstring(L"Mod ") + std::to_wstring(index));
                std::filesystem::create_directories(mod);
                mods.push_back(mod.wstring());
            }
            return mods;
        }
    }

    TEST(VfsTreeTests, BuildMergesRealModsOverwriteByPriorityAndKeepsBaseSiblings)
    {
        TempDirectory temp;

        const std::filesystem::path data = temp.path() / L"Game" / L"Data";
        const std::filesystem::path modLow = temp.path() / L"mods" / L"Low Priority";
        const std::filesystem::path modHigh = temp.path() / L"mods" / L"High Priority";
        const std::filesystem::path overwrite = temp.path() / L"overwrite";

        writeTextFile(data / L"textures" / L"base.dds", "base");
        writeTextFile(data / L"textures" / L"shared.dds", "real");
        writeTextFile(modLow / L"textures" / L"shared.dds", "low");
        writeTextFile(modLow / L"textures" / L"low-only.dds", "low-only");
        writeTextFile(modHigh / L"textures" / L"shared.dds", "high");
        writeTextFile(modHigh / L"meshes" / L"high-only.nif", "high-only");
        writeTextFile(overwrite / L"textures" / L"shared.dds", "overwrite");

        vfs::VfsTree tree;
        tree.build(vfs::VfsMountConfig{
            data.wstring(),
            overwrite.wstring(),
            {modLow.wstring(), modHigh.wstring()},
            {}
        });

        const vfs::VfsTree::PathInfo shared = tree.classify(L"textures\\shared.dds");
        ASSERT_EQ(shared.kind, vfs::VfsTree::PathInfo::Kind::File);
        expectSamePath(shared.winner, overwrite / L"textures" / L"shared.dds");

        const vfs::VfsTree::PathInfo highOnly = tree.classify(L"meshes\\high-only.nif");
        ASSERT_EQ(highOnly.kind, vfs::VfsTree::PathInfo::Kind::File);
        expectSamePath(highOnly.winner, modHigh / L"meshes" / L"high-only.nif");

        const auto textures =
            tree.listing(vfs::VfsTree::toLower(L"textures"));
        EXPECT_TRUE(containsChild(*textures, L"base.dds"));
        EXPECT_TRUE(containsChild(*textures, L"low-only.dds"));
        EXPECT_TRUE(containsChild(*textures, L"shared.dds"));
    }

    TEST(VfsTreeTests, BuildExcludesRootBuilderTopLevelFolderFromDataMount)
    {
        TempDirectory temp;

        const std::filesystem::path data = temp.path() / L"Game" / L"Data";
        const std::filesystem::path mod = temp.path() / L"mods" / L"Root Builder Mod";
        const std::filesystem::path overwrite = temp.path() / L"overwrite";

        writeTextFile(data / L"Skyrim.esm", "base");
        writeTextFile(mod / L"root" / L"SkyrimSE.exe", "root executable");
        writeTextFile(mod / L"Scripts" / L"mod.pex", "script");

        vfs::VfsTree tree;
        tree.build(vfs::VfsMountConfig{
            data.wstring(),
            overwrite.wstring(),
            {mod.wstring()},
            {L"root"}
        });

        const vfs::VfsTree::PathInfo rootFile = tree.classify(L"root\\SkyrimSE.exe");
        EXPECT_EQ(rootFile.kind, vfs::VfsTree::PathInfo::Kind::Unknown);

        const vfs::VfsTree::PathInfo script = tree.classify(L"Scripts\\mod.pex");
        ASSERT_EQ(script.kind, vfs::VfsTree::PathInfo::Kind::File);
        expectSamePath(script.winner, mod / L"Scripts" / L"mod.pex");

        const auto root = tree.listing(L"");
        EXPECT_FALSE(containsChild(*root, L"root"));
        EXPECT_TRUE(containsChild(*root, L"Scripts"));
        EXPECT_TRUE(containsChild(*root, L"Skyrim.esm"));
    }

    TEST(VfsTreeTests, BuildSupportsModsWithNestedDataWrapper)
    {
        TempDirectory temp;

        const std::filesystem::path data = temp.path() / L"Game" / L"Data";
        const std::filesystem::path mod = temp.path() / L"mods" / L"Wrapped Mod";
        const std::filesystem::path wrappedData = mod / L"Data";
        const std::filesystem::path overwrite = temp.path() / L"overwrite";

        writeTextFile(data / L"Skyrim.esm", "base");
        writeTextFile(wrappedData / L"Wrapped.esp", "plugin");
        writeTextFile(mod / L"fomod" / L"ModuleConfig.xml", "<config />");

        vfs::VfsTree tree;
        tree.build(vfs::VfsMountConfig{
            data.wstring(),
            overwrite.wstring(),
            {mod.wstring(), wrappedData.wstring()},
            {L"Data"}
        });

        const vfs::VfsTree::PathInfo wrappedPlugin = tree.classify(L"Wrapped.esp");
        ASSERT_EQ(wrappedPlugin.kind, vfs::VfsTree::PathInfo::Kind::File);
        expectSamePath(wrappedPlugin.winner, wrappedData / L"Wrapped.esp");

        const vfs::VfsTree::PathInfo leakedPlugin = tree.classify(L"Data\\Wrapped.esp");
        EXPECT_EQ(leakedPlugin.kind, vfs::VfsTree::PathInfo::Kind::Unknown);

        const auto root = tree.listing(L"");
        EXPECT_FALSE(containsChild(*root, L"Data"));
        EXPECT_TRUE(containsChild(*root, L"Wrapped.esp"));
    }

    TEST(VfsTreeTests, WhiteoutHidesLowerFileUntilOverwriteRecreatesIt)
    {
        TempDirectory temp;
        const std::filesystem::path data = temp.path() / L"Game" / L"Data";
        const std::filesystem::path mod = temp.path() / L"mods" / L"Settings";
        const std::filesystem::path overwrite = temp.path() / L"overwrite";
        const std::filesystem::path whiteouts = temp.path() / L"whiteouts";
        writeTextFile(data / L"NovelSubsystem" / L"state.futureext", "base");
        writeTextFile(mod / L"NovelSubsystem" / L"state.futureext", "mod");
        writeTextFile(whiteouts / L"NovelSubsystem" / L"state.futureext", "");

        vfs::VfsTree tree;
        tree.build(vfs::VfsMountConfig{
            data.wstring(),
            overwrite.wstring(),
            {mod.wstring()},
            {},
            whiteouts.wstring()
        });

        EXPECT_EQ(
            tree.classify(L"NovelSubsystem\\state.futureext").kind,
            vfs::VfsTree::PathInfo::Kind::Whiteout);
        EXPECT_FALSE(containsChild(*tree.listing(L"NovelSubsystem"), L"state.futureext"));

        writeTextFile(overwrite / L"NovelSubsystem" / L"state.futureext", "new");
        const vfs::VfsTree::PathInfo recreated = tree.classify(L"NovelSubsystem\\state.futureext");
        ASSERT_EQ(recreated.kind, vfs::VfsTree::PathInfo::Kind::File);
        expectSamePath(recreated.winner, overwrite / L"NovelSubsystem" / L"state.futureext");
    }

    TEST(VfsTreeTests, DirectClassifyFindsNestedOverlayFileBeforeDirectoryEnumeration)
    {
        TempDirectory temp;

        const std::filesystem::path data = temp.path() / L"Game" / L"Data";
        const std::filesystem::path mod = temp.path() / L"mods" / L"Late Lookup";
        const std::filesystem::path overwrite = temp.path() / L"overwrite";

        writeTextFile(data / L"textures" / L"base.dds", "base");
        writeTextFile(mod / L"textures" / L"actors" / L"body.dds", "mod");

        vfs::VfsTree tree;
        tree.build(vfs::VfsMountConfig{
            data.wstring(),
            overwrite.wstring(),
            {mod.wstring()},
            {}
        });

        const vfs::VfsTree::PathInfo nested = tree.classify(L"textures\\actors\\body.dds");
        ASSERT_EQ(nested.kind, vfs::VfsTree::PathInfo::Kind::File);
        expectSamePath(nested.winner, mod / L"textures" / L"actors" / L"body.dds");

        const auto textures =
            tree.listing(vfs::VfsTree::toLower(L"textures"));
        EXPECT_TRUE(containsChild(*textures, L"actors"));
        EXPECT_TRUE(containsChild(*textures, L"base.dds"));
    }

    TEST(VfsTreeTests, RepeatedMissingPathUsesNegativeCacheAcrossActiveMods)
    {
        constexpr std::array<std::size_t, 4> modCounts{50, 250, 500, 1000};

        for (const std::size_t modCount : modCounts)
        {
            SCOPED_TRACE(::testing::Message() << "modCount=" << modCount);
            TempDirectory temp;

            const std::filesystem::path data = temp.path() / L"Game" / L"Data";
            std::filesystem::create_directories(data);
            const std::vector<std::wstring> mods = createModRoots(temp.path() / L"mods", modCount);

            vfs::VfsTree tree;
            tree.build(vfs::VfsMountConfig{
                data.wstring(),
                L"",
                mods,
                {}
            });

            vfs::VfsTree::resetAttributeProbeCountForTests();

            const vfs::VfsTree::PathInfo first = tree.classify(L"meshes\\missing.nif");
            EXPECT_EQ(first.kind, vfs::VfsTree::PathInfo::Kind::Unknown);
            EXPECT_FALSE(first.parentVirtual);
            const std::uint64_t probesAfterFirst =
                vfs::VfsTree::attributeProbeCountForTests();
            EXPECT_GE(probesAfterFirst, static_cast<std::uint64_t>(modCount));

            const vfs::VfsTree::PathInfo second = tree.classify(L"meshes\\missing.nif");
            EXPECT_EQ(second.kind, vfs::VfsTree::PathInfo::Kind::Unknown);
            EXPECT_FALSE(second.parentVirtual);
            const std::uint64_t probesAfterSecond =
                vfs::VfsTree::attributeProbeCountForTests();
            EXPECT_LE(probesAfterSecond - probesAfterFirst, static_cast<std::uint64_t>(1));
        }
    }

    TEST(VfsTreeTests, HitProbeCountReflectsLoadOrderPriority)
    {
        TempDirectory temp;

        constexpr std::size_t modCount = 64;
        const std::filesystem::path data = temp.path() / L"Game" / L"Data";
        std::filesystem::create_directories(data);
        const std::vector<std::wstring> mods = createModRoots(temp.path() / L"mods", modCount);
        writeTextFile(std::filesystem::path(mods.front()) / L"textures" / L"bottom.dds", "bottom");
        writeTextFile(std::filesystem::path(mods.back()) / L"textures" / L"top.dds", "top");

        vfs::VfsTree tree;
        tree.build(vfs::VfsMountConfig{
            data.wstring(),
            L"",
            mods,
            {}
        });

        vfs::VfsTree::resetAttributeProbeCountForTests();
        const vfs::VfsTree::PathInfo top = tree.classify(L"textures\\top.dds");
        ASSERT_EQ(top.kind, vfs::VfsTree::PathInfo::Kind::File);
        const std::uint64_t topProbes = vfs::VfsTree::attributeProbeCountForTests();
        EXPECT_LE(topProbes, static_cast<std::uint64_t>(1));

        vfs::VfsTree::resetAttributeProbeCountForTests();
        const vfs::VfsTree::PathInfo bottom = tree.classify(L"textures\\bottom.dds");
        ASSERT_EQ(bottom.kind, vfs::VfsTree::PathInfo::Kind::File);
        const std::uint64_t bottomProbes = vfs::VfsTree::attributeProbeCountForTests();
        EXPECT_GE(bottomProbes, static_cast<std::uint64_t>(modCount));
        EXPECT_GT(bottomProbes, topProbes);
    }

    TEST(VfsTreeTests, ParentListingAmortizesLaterSiblingLookups)
    {
        TempDirectory temp;

        constexpr std::size_t modCount = 96;
        const std::filesystem::path data = temp.path() / L"Game" / L"Data";
        std::filesystem::create_directories(data);
        const std::vector<std::wstring> mods = createModRoots(temp.path() / L"mods", modCount);
        const std::filesystem::path hotMod = std::filesystem::path(mods.back());
        writeTextFile(hotMod / L"textures" / L"first.dds", "first");
        writeTextFile(hotMod / L"textures" / L"second.dds", "second");
        writeTextFile(hotMod / L"textures" / L"third.dds", "third");

        vfs::VfsTree tree;
        tree.build(vfs::VfsMountConfig{
            data.wstring(),
            L"",
            mods,
            {}
        });

        vfs::VfsTree::resetAttributeProbeCountForTests();
        const vfs::VfsTree::PathInfo first = tree.classify(L"textures\\first.dds");
        ASSERT_EQ(first.kind, vfs::VfsTree::PathInfo::Kind::File);
        EXPECT_LE(vfs::VfsTree::attributeProbeCountForTests(), static_cast<std::uint64_t>(1));

        vfs::VfsTree::resetAttributeProbeCountForTests();
        const vfs::VfsTree::PathInfo second = tree.classify(L"textures\\second.dds");
        ASSERT_EQ(second.kind, vfs::VfsTree::PathInfo::Kind::File);
        EXPECT_LE(vfs::VfsTree::attributeProbeCountForTests(), static_cast<std::uint64_t>(modCount + 2));

        vfs::VfsTree::resetAttributeProbeCountForTests();
        const vfs::VfsTree::PathInfo third = tree.classify(L"textures\\third.dds");
        ASSERT_EQ(third.kind, vfs::VfsTree::PathInfo::Kind::File);
        EXPECT_LE(vfs::VfsTree::attributeProbeCountForTests(), static_cast<std::uint64_t>(1));
    }

    TEST(VfsTreeTests, ParentListingCachesChildDirectoryLookup)
    {
        TempDirectory temp;

        constexpr std::size_t modCount = 96;
        const std::filesystem::path data = temp.path() / L"Game" / L"Data";
        std::filesystem::create_directories(data);
        const std::vector<std::wstring> mods = createModRoots(temp.path() / L"mods", modCount);
        const std::filesystem::path coldMod = std::filesystem::path(mods.front());
        writeTextFile(coldMod / L"textures" / L"actors" / L"body.dds", "body");

        vfs::VfsTree tree;
        tree.build(vfs::VfsMountConfig{
            data.wstring(),
            L"",
            mods,
            {}
        });

        const auto textures = tree.listing(L"textures");
        ASSERT_TRUE(containsChild(*textures, L"actors"));

        vfs::VfsTree::resetAttributeProbeCountForTests();
        const vfs::VfsTree::PathInfo actors = tree.classify(L"textures\\actors");
        ASSERT_EQ(actors.kind, vfs::VfsTree::PathInfo::Kind::Directory);
        expectSamePath(actors.winner, coldMod / L"textures" / L"actors");
        EXPECT_LE(vfs::VfsTree::attributeProbeCountForTests(), static_cast<std::uint64_t>(1));
    }

    TEST(VfsTreeTests, ParentListingPreservesRealDirectoryExistenceForOverlayDirectory)
    {
        TempDirectory temp;

        const std::filesystem::path data = temp.path() / L"Game" / L"Data";
        const std::filesystem::path mod = temp.path() / L"mods" / L"Textures Mod";
        writeTextFile(data / L"textures" / L"base.dds", "base");
        writeTextFile(mod / L"textures" / L"mod.dds", "mod");

        vfs::VfsTree tree;
        tree.build(vfs::VfsMountConfig{
            data.wstring(),
            L"",
            {mod.wstring()},
            {}
        });

        const auto root = tree.listing(L"");
        ASSERT_TRUE(containsChild(*root, L"textures"));

        const vfs::VfsTree::PathInfo textures = tree.classify(L"textures");
        ASSERT_EQ(textures.kind, vfs::VfsTree::PathInfo::Kind::Directory);
        EXPECT_TRUE(textures.directoryRealExists);
    }

    TEST(VfsTreeTests, MissingChildAfterDirectoryListingSkipsActiveModScan)
    {
        TempDirectory temp;

        constexpr std::size_t modCount = 128;
        const std::filesystem::path data = temp.path() / L"Game" / L"Data";
        std::filesystem::create_directories(data);
        const std::vector<std::wstring> mods = createModRoots(temp.path() / L"mods", modCount);
        writeTextFile(std::filesystem::path(mods.back()) / L"textures" / L"present.dds", "present");

        vfs::VfsTree tree;
        tree.build(vfs::VfsMountConfig{
            data.wstring(),
            L"",
            mods,
            {}
        });

        const auto textures = tree.listing(L"textures");
        ASSERT_TRUE(containsChild(*textures, L"present.dds"));

        vfs::VfsTree::resetAttributeProbeCountForTests();
        const vfs::VfsTree::PathInfo missing = tree.classify(L"textures\\missing.dds");
        EXPECT_EQ(missing.kind, vfs::VfsTree::PathInfo::Kind::Unknown);
        EXPECT_TRUE(missing.parentVirtual);
        EXPECT_LE(vfs::VfsTree::attributeProbeCountForTests(), static_cast<std::uint64_t>(1));
    }

    TEST(VfsTreeTests, NegativeModCacheDoesNotHideNewOverwriteFile)
    {
        TempDirectory temp;

        const std::filesystem::path data = temp.path() / L"Game" / L"Data";
        const std::filesystem::path overwrite = temp.path() / L"overwrite";
        std::filesystem::create_directories(data);
        const std::vector<std::wstring> mods = createModRoots(temp.path() / L"mods", 32);

        vfs::VfsTree tree;
        tree.build(vfs::VfsMountConfig{
            data.wstring(),
            overwrite.wstring(),
            mods,
            {}
        });

        const vfs::VfsTree::PathInfo missing = tree.classify(L"textures\\late.dds");
        ASSERT_EQ(missing.kind, vfs::VfsTree::PathInfo::Kind::Unknown);

        writeTextFile(overwrite / L"textures" / L"late.dds", "late overwrite");

        const vfs::VfsTree::PathInfo late = tree.classify(L"textures\\late.dds");
        ASSERT_EQ(late.kind, vfs::VfsTree::PathInfo::Kind::File);
        expectSamePath(late.winner, overwrite / L"textures" / L"late.dds");
    }

    TEST(VfsTreeTests, WildcardMatchSupportsNativeDosStarMasks)
    {
        EXPECT_TRUE(vfs::VfsTree::wildcardMatch(L"enginefixes.dll", L"<.dll"));
        EXPECT_TRUE(vfs::VfsTree::wildcardMatch(L"save1_character_tamriel.ess", L"<.ess"));
        EXPECT_TRUE(vfs::VfsTree::wildcardMatch(L"skse64.log", L"*.log"));
        EXPECT_FALSE(vfs::VfsTree::wildcardMatch(L"save1_character_tamriel.skse", L"<.ess"));
        EXPECT_FALSE(vfs::VfsTree::wildcardMatch(L"enginefixes.toml", L"<.dll"));
    }

    TEST(VfsTreeTests, ListingReusesImmutableSnapshotWithLowercaseKeys)
    {
        TempDirectory temp;

        const std::filesystem::path data = temp.path() / L"Game" / L"Data";
        writeTextFile(data / L"textures" / L"MixedCase.DDS", "texture");

        vfs::VfsTree tree;
        tree.build(vfs::VfsMountConfig{
            data.wstring(),
            L"",
            {},
            {}
        });

        const auto first = tree.listing(L"textures");
        const auto second = tree.listing(L"Textures");

        ASSERT_EQ(first.get(), second.get());
        ASSERT_EQ(first->size(), 1u);
        EXPECT_EQ(first->front().name, L"MixedCase.DDS");
        EXPECT_EQ(first->front().nameLower, L"mixedcase.dds");
    }
}
