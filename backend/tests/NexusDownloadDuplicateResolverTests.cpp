#include "FluxoraCore/Services/NexusDownloadDuplicateResolver.hpp"

#include <gtest/gtest.h>

namespace fluxora
{
    namespace
    {
        NexusDownloadFileVersion file(
            std::wstring id,
            std::wstring gameDomain,
            std::wstring modId,
            std::wstring fileId,
            std::wstring version = {})
        {
            return NexusDownloadFileVersion{
                std::move(id),
                std::move(gameDomain),
                std::move(modId),
                std::move(fileId),
                L"archive.zip",
                std::move(version),
                {}};
        }
    }

    TEST(NexusDownloadDuplicateResolverTests, ClassifiesUpgradeDowngradeAndMixedHistory)
    {
        const std::vector<NexusFileUpdateLink> updates{
            {L"100", L"200", 0},
            {L"200", L"300", 0}
        };
        const NexusDownloadDuplicateResolver resolver;

        EXPECT_EQ(
            resolver.resolve(
                file(L"incoming", L"skyrimspecialedition", L"3863", L"300", L"1.0.2"),
                {
                    file(L"old-1", L"skyrimspecialedition", L"3863", L"100", L"1.0.0"),
                    file(L"old-2", L"skyrimspecialedition", L"3863", L"200", L"1.0.1")
                },
                updates).kind,
            NexusDownloadDuplicateKind::Upgrade);

        EXPECT_EQ(
            resolver.resolve(
                file(L"incoming", L"skyrimspecialedition", L"3863", L"100", L"1.0.0"),
                {file(L"newer", L"skyrimspecialedition", L"3863", L"300", L"1.0.2")},
                updates).kind,
            NexusDownloadDuplicateKind::Downgrade);

        const NexusDownloadDuplicateResolution mixed = resolver.resolve(
            file(L"incoming", L"skyrimspecialedition", L"3863", L"200", L"1.0.1"),
            {
                file(L"older", L"skyrimspecialedition", L"3863", L"100", L"1.0.0"),
                file(L"newer", L"skyrimspecialedition", L"3863", L"300", L"1.0.2")
            },
            updates);
        EXPECT_EQ(mixed.kind, NexusDownloadDuplicateKind::Mixed);
        EXPECT_EQ(mixed.existingFiles.size(), 2U);
    }

    TEST(NexusDownloadDuplicateResolverTests, ReusesTheSameFileIdWithoutDecision)
    {
        const NexusDownloadDuplicateResolution resolution = NexusDownloadDuplicateResolver().resolve(
            file(L"incoming", L"skyrimspecialedition", L"3863", L"200"),
            {
                file(L"same", L"skyrimspecialedition", L"3863", L"200"),
                file(L"older", L"skyrimspecialedition", L"3863", L"100")
            },
            {{L"100", L"200", 0}});

        EXPECT_EQ(resolution.kind, NexusDownloadDuplicateKind::SameFile);
        ASSERT_TRUE(resolution.sameFile.has_value());
        EXPECT_EQ(resolution.sameFile->id, L"same");
        EXPECT_TRUE(resolution.existingFiles.empty());
    }

    TEST(NexusDownloadDuplicateResolverTests, RequiresTheExactGameAndModPair)
    {
        const NexusDownloadFileVersion incoming =
            file(L"incoming", L"skyrimspecialedition", L"3863", L"200");
        const NexusDownloadDuplicateResolution resolution = NexusDownloadDuplicateResolver().resolve(
            incoming,
            {
                file(L"wrong-game", L"skyrim", L"3863", L"100"),
                file(L"wrong-mod", L"skyrimspecialedition", L"9999", L"100")
            },
            {{L"100", L"200", 0}});

        EXPECT_EQ(resolution.kind, NexusDownloadDuplicateKind::None);
    }

    TEST(NexusDownloadDuplicateResolverTests, TreatsSeparateAmbiguousAndMissingLineageAsDifferentFiles)
    {
        const NexusDownloadDuplicateResolver resolver;
        const NexusDownloadFileVersion incoming =
            file(L"incoming", L"skyrimspecialedition", L"3863", L"200");
        const NexusDownloadFileVersion optional =
            file(L"optional", L"skyrimspecialedition", L"3863", L"400");

        EXPECT_EQ(
            resolver.resolve(
                incoming,
                {optional},
                {{L"100", L"200", 0}, {L"300", L"400", 0}}).kind,
            NexusDownloadDuplicateKind::None);
        EXPECT_EQ(
            resolver.resolve(incoming, {optional}, {}).kind,
            NexusDownloadDuplicateKind::None);
        EXPECT_EQ(
            resolver.resolve(
                incoming,
                {file(L"old", L"skyrimspecialedition", L"3863", L"100")},
                {{L"100", L"200", 0}, {L"100", L"300", 0}}).kind,
            NexusDownloadDuplicateKind::None);
    }
}
