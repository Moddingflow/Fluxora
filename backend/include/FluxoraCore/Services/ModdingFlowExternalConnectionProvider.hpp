#pragma once

#include "FluxoraCore/Services/ExternalConnectionService.hpp"
#include "FluxoraCore/Services/ModdingFlowAuthService.hpp"

#include <memory>

namespace fluxora
{
    [[nodiscard]] ExternalConnectionStatus mapModdingFlowExternalConnectionStatus(
        const ModdingFlowAuthStatus& status,
        std::wstring_view operationId,
        std::wstring message = {});

    [[nodiscard]] std::shared_ptr<IExternalConnectionProvider>
        createModdingFlowExternalConnectionProvider(ModdingFlowAuthService& auth);
}
