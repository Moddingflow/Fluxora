#include "FluxoraCore/Services/InverseTextMergeService.hpp"

#include <gtest/gtest.h>

namespace fluxora::tests
{
    TEST(InverseTextMergeServiceTests, UndoPreservesANewerNonOverlappingInsertion)
    {
        const InverseTextMergeResult result = InverseTextMergeService().merge(
            L"alpha\nbeta changed by selected run\ngamma\n",
            L"newer heading\nalpha\nbeta changed by selected run\ngamma\n",
            L"alpha\nbeta\ngamma\n");

        ASSERT_TRUE(result.succeeded());
        EXPECT_TRUE(result.preservedNewerChanges);
        EXPECT_EQ(result.content, L"newer heading\nalpha\nbeta\ngamma\n");
    }

    TEST(InverseTextMergeServiceTests, LaterInsertionMayShiftSelectedLinesWithoutConflict)
    {
        const InverseTextMergeResult result = InverseTextMergeService().merge(
            L"one\ntwo selected\nthree\nfour\n",
            L"one\ninserted later\ntwo selected\nthree\nfour\n",
            L"one\ntwo\nthree\nfour\n");

        ASSERT_TRUE(result.succeeded());
        EXPECT_TRUE(result.preservedNewerChanges);
        EXPECT_EQ(result.content, L"one\ninserted later\ntwo\nthree\nfour\n");
    }

    TEST(InverseTextMergeServiceTests, OverlappingLogicalLinesReturnConflictWithoutContent)
    {
        const InverseTextMergeResult result = InverseTextMergeService().merge(
            L"alpha\nselected value\nomega\n",
            L"alpha\nnewer overlapping value\nomega\n",
            L"alpha\noriginal value\nomega\n");

        EXPECT_FALSE(result.succeeded());
        EXPECT_EQ(result.conflict, InverseTextMergeConflict::OverlappingEdit);
        EXPECT_TRUE(result.content.empty());
    }
}
