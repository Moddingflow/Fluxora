#pragma once

#include "FluxoraCore/Services/ModdingFlowAuthService.hpp"

#include <cstddef>
#include <cstdint>
#include <memory>
#include <stdexcept>
#include <string>
#include <string_view>
#include <vector>

namespace fluxora
{
    enum class ModdingFlowHttpMethod
    {
        Get,
        Post
    };

    struct ModdingFlowHttpHeader
    {
        std::string name;
        std::string value;
    };

    struct ModdingFlowHttpRequest
    {
        ModdingFlowHttpMethod method{ModdingFlowHttpMethod::Get};
        std::string url;
        std::vector<ModdingFlowHttpHeader> headers;
        std::string body;
        std::wstring operationId;
        ModdingFlowHttpPolicy policy;
        std::size_t maximumResponseHeaderBytes{16U * 1024U};
        std::size_t maximumResponseBodyBytes{64U * 1024U};
    };

    struct ModdingFlowHttpResponse
    {
        std::uint16_t statusCode{0};
        std::vector<ModdingFlowHttpHeader> headers;
        std::string body;

        [[nodiscard]] std::string_view firstHeader(std::string_view name) const noexcept;
    };

    enum class ModdingFlowHttpFailureKind
    {
        DefinitelyNotSent,
        Ambiguous,
        Timeout,
        Security,
        Protocol,
        ResponseTooLarge
    };

    class ModdingFlowHttpException final : public std::runtime_error
    {
    public:
        ModdingFlowHttpException(
            ModdingFlowHttpFailureKind kind,
            bool requestMayHaveBeenSent,
            std::string message);

        [[nodiscard]] ModdingFlowHttpFailureKind kind() const noexcept;
        [[nodiscard]] bool requestMayHaveBeenSent() const noexcept;

    private:
        ModdingFlowHttpFailureKind kind_;
        bool requestMayHaveBeenSent_;
    };

    class IModdingFlowHttpTransport
    {
    public:
        virtual ~IModdingFlowHttpTransport() = default;
        [[nodiscard]] virtual ModdingFlowHttpResponse send(
            const ModdingFlowHttpRequest& request) = 0;
    };

    class WinHttpModdingFlowTransport final : public IModdingFlowHttpTransport
    {
    public:
        explicit WinHttpModdingFlowTransport(std::wstring userAgent);
        ~WinHttpModdingFlowTransport() override;

        WinHttpModdingFlowTransport(const WinHttpModdingFlowTransport&) = delete;
        WinHttpModdingFlowTransport& operator=(const WinHttpModdingFlowTransport&) = delete;

        [[nodiscard]] ModdingFlowHttpResponse send(
            const ModdingFlowHttpRequest& request) override;

    private:
        struct State;
        std::unique_ptr<State> state_;
    };

#ifdef FLUXORA_MODDINGFLOW_HTTP_TEST_HOOKS
    void validateModdingFlowHttpResponseFramingForTests(
        const std::vector<ModdingFlowHttpHeader>& headers);

#ifdef _WIN32
    struct ModdingFlowHttpFailureClassification
    {
        ModdingFlowHttpFailureKind kind{ModdingFlowHttpFailureKind::Ambiguous};
        bool requestMayHaveBeenSent{true};
    };

    [[nodiscard]] ModdingFlowHttpFailureClassification
    classifyModdingFlowWinHttpAsyncFailureForTests(
        std::uintptr_t asyncApiResult,
        std::uint32_t error,
        bool requestSubmissionStarted) noexcept;
#endif
#endif
}
