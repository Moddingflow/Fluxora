#pragma once

#include <string>
#include <vector>

namespace fluxora
{
    struct PlacementPlan;

    enum class ContentLayoutAssessmentStatus
    {
        Ready,
        Warning,
        Blocked
    };

    struct ContentLayoutAssessment
    {
        ContentLayoutAssessmentStatus status{ContentLayoutAssessmentStatus::Ready};
        std::vector<std::wstring> reasonCodes;
    };

    class IContentLayoutAssessmentPolicy
    {
    public:
        virtual ~IContentLayoutAssessmentPolicy() = default;
        [[nodiscard]] virtual ContentLayoutAssessment assess(const PlacementPlan& plan) const = 0;
    };
}
