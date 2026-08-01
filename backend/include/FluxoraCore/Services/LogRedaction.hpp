#pragma once

#include <string>
#include <string_view>

namespace fluxora
{
    // Applies the process-wide log boundary policy before text reaches any sink.
    [[nodiscard]] std::string redactSensitiveLogText(std::string_view input);
}
