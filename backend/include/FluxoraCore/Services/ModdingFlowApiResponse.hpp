#pragma once

#include "FluxoraCore/Services/ModdingFlowHttpTransport.hpp"
#include "FluxoraCore/Support/JsonReader.hpp"

#include <cstddef>
#include <cstdint>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace fluxora
{
    struct ModdingFlowJsonLimits
    {
        std::size_t maximumBytes{64U * 1024U};
        std::size_t maximumDepth{16U};
        std::size_t maximumValues{2048U};
        std::size_t maximumStringCodeUnits{32U * 1024U};
    };

    [[nodiscard]] JsonValue parseModdingFlowJson(
        std::string_view utf8,
        ModdingFlowJsonLimits limits = {});
    [[nodiscard]] std::string moddingFlowJsonStringToUtf8(std::wstring_view value);

    struct ModdingFlowProblemDetails
    {
        std::string type;
        std::string title;
        std::uint16_t status{0};
        std::string instance;
        std::string code;
        std::string machineCode;
        std::string requestId;
        std::string traceId;
        bool retryable{false};
        std::optional<std::uint32_t> retryAfterSeconds;
        std::vector<std::string> requiredScopes;
    };

    [[nodiscard]] std::optional<ModdingFlowProblemDetails> parseModdingFlowProblemDetails(
        const ModdingFlowHttpResponse& response,
        ModdingFlowJsonLimits limits = {});
}
