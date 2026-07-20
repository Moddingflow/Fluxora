#include "FluxoraCore/Services/NexusFileLineageResolver.hpp"

#include <gtest/gtest.h>

namespace fluxora
{
    TEST(NexusFileLineageResolverTests, ProvesTheSameLineageInEitherDirection)
    {
        const NexusFileLineageResolver resolver({
            NexusFileUpdateLink{L"100", L"200", 0},
            NexusFileUpdateLink{L"200", L"300", 0}
        });

        EXPECT_EQ(
            resolver.resolve(L"100", L"300").kind,
            NexusFileLineageKind::SameLineage);
        EXPECT_EQ(
            resolver.resolve(L"300", L"100").kind,
            NexusFileLineageKind::SameLineage);
    }

    TEST(NexusFileLineageResolverTests, RejectsBranchesCyclesAndUnrelatedFileIds)
    {
        const NexusFileLineageResolver branched({
            NexusFileUpdateLink{L"100", L"200", 0},
            NexusFileUpdateLink{L"100", L"300", 0}
        });
        EXPECT_EQ(
            branched.resolve(L"100", L"200").kind,
            NexusFileLineageKind::UnprovenOrDifferentBranch);

        const NexusFileLineageResolver cyclic({
            NexusFileUpdateLink{L"100", L"200", 0},
            NexusFileUpdateLink{L"200", L"100", 0}
        });
        EXPECT_EQ(
            cyclic.resolve(L"100", L"200").kind,
            NexusFileLineageKind::UnprovenOrDifferentBranch);

        const NexusFileLineageResolver separateBranches({
            NexusFileUpdateLink{L"100", L"200", 0},
            NexusFileUpdateLink{L"300", L"400", 0}
        });
        EXPECT_EQ(
            separateBranches.resolve(L"200", L"400").kind,
            NexusFileLineageKind::UnprovenOrDifferentBranch);
        EXPECT_EQ(
            separateBranches.resolve(L"200", L"200").kind,
            NexusFileLineageKind::SameFile);
    }

    TEST(NexusFileLineageResolverTests, ReturnsOnlyTheProvenForwardChain)
    {
        const NexusFileLineageResolver resolver({
            NexusFileUpdateLink{L"100", L"200", 0},
            NexusFileUpdateLink{L"200", L"300", 0}
        });

        const NexusFileLineageResolution resolution = resolver.forwardFrom(L"200");

        EXPECT_EQ(resolution.kind, NexusFileLineageKind::SameLineage);
        EXPECT_EQ(resolution.fileIds, (std::vector<std::wstring>{L"200", L"300"}));
    }
}
