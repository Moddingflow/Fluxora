#pragma once

#include "FluxoraCore/Services/FomodInstallerService.hpp"
#include "FluxoraCore/Services/FomodProfileContextService.hpp"

#include <map>
#include <string>
#include <string_view>
#include <vector>

namespace fluxora
{
    enum class FomodDependencyResult
    {
        Satisfied,
        Unsatisfied,
        Unknown
    };

    enum class FomodOptionDecisionAction
    {
        Select,
        Deselect,
        Manual,
        Locked
    };

    enum class FomodDecisionConfidence
    {
        None,
        Weak,
        Strong,
        Exact
    };

    struct FomodDecisionEvidence
    {
        std::wstring code;
        std::wstring subject;
        std::wstring expected;
        std::wstring actual;
        std::wstring sourceKind;
        std::wstring sourceName;
    };

    struct FomodOptionDecision
    {
        std::wstring optionId;
        FomodOptionDecisionAction action{FomodOptionDecisionAction::Manual};
        FomodDecisionConfidence confidence{FomodDecisionConfidence::None};
        std::wstring effectiveType;
        std::vector<std::wstring> reasonCodes;
        std::vector<FomodDecisionEvidence> evidence;
    };

    struct FomodUnresolvedGroup
    {
        std::wstring stepId;
        std::wstring groupId;
        std::wstring groupName;
        std::wstring reasonCode;
        std::vector<std::wstring> optionIds;
    };

    struct FomodManualDecision
    {
        std::wstring optionId;
        bool selected{false};
    };

    struct FomodAutoSelection
    {
        std::wstring contextId;
        std::vector<std::wstring> initialSelectedOptionIds;
        std::vector<FomodUnresolvedGroup> unresolvedGroups;
        std::vector<FomodOptionDecision> decisions;
        FomodDependencyResult moduleDependencyResult{FomodDependencyResult::Satisfied};
        bool installBlocked{false};
        bool cycleDetected{false};
        std::vector<std::wstring> warnings;
    };

    class FomodAutoSelectionService final
    {
    public:
        FomodAutoSelectionService() = delete;

        [[nodiscard]] static FomodAutoSelection analyze(
            const FomodInstallerDescriptor& descriptor,
            const FomodProfileContext& context,
            const std::vector<FomodManualDecision>& manualDecisions = {});

        [[nodiscard]] static FomodProfileContext bindContext(
            const std::filesystem::path& projectDirectory,
            std::wstring_view archiveFingerprint,
            FomodProfileContext context);

        static void validateContext(
            const std::filesystem::path& projectDirectory,
            std::wstring_view archiveFingerprint,
            std::wstring_view contextId,
            const FomodProfileContext& currentContext);

        [[nodiscard]] static FomodDependencyResult evaluateDependency(
            const FomodDependencyNode& dependency,
            const FomodProfileContext& context,
            const std::map<std::wstring, std::wstring>& flags = {});

        [[nodiscard]] static std::wstring dependencyResultName(FomodDependencyResult result);
        [[nodiscard]] static std::wstring actionName(FomodOptionDecisionAction action);
        [[nodiscard]] static std::wstring confidenceName(FomodDecisionConfidence confidence);
    };
}
