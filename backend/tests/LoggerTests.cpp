#include "FluxoraCore/Services/Logger.hpp"

#include "TestFilesystem.hpp"

#include <filesystem>
#include <fstream>
#include <sstream>
#include <string>

#include <gtest/gtest.h>

namespace
{
    std::string readFile(const std::filesystem::path& path)
    {
        std::ifstream file(path, std::ios::in | std::ios::binary);
        std::ostringstream content;
        content << file.rdbuf();
        return content.str();
    }
}

namespace fluxora::tests
{
    TEST(LoggerTests, WritesOperationIdToCoreLog)
    {
        Logger logger;
        const std::wstring operationId = L"logger-test-operation";
        const std::string marker = "logger-test-marker";

        Logger::setOperationId(operationId);
        logger.initialize();
        ASSERT_TRUE(logger.isInitialized());
        ASSERT_FALSE(logger.logPath().empty());

        logger.write(LogLevel::Info, "LoggerTests", marker);
        logger.shutdown();
        Logger::clearOperationId();

        const std::string content = readFile(logger.logPath());
        EXPECT_NE(content.find(marker), std::string::npos);
        EXPECT_NE(content.find("op=logger-test-operation"), std::string::npos);
        EXPECT_NE(content.find("operationId=logger-test-operation"), std::string::npos);
        EXPECT_TRUE(Logger::operationId().empty());
    }

    TEST(LoggerTests, WritesOperationDiagnosticsToOperationsLog)
    {
        Logger logger;
        const std::wstring operationId = L"logger-operation-channel";
        const std::string marker = "operation-diagnostics-marker operationIdFieldCheck";

        Logger::setOperationId(operationId);
        logger.initialize();
        ASSERT_TRUE(logger.isInitialized());
        ASSERT_FALSE(logger.operationsLogPath().empty());

        logger.writeOperation(LogLevel::Info, "LoggerTests", marker);
        logger.shutdown();
        Logger::clearOperationId();

        const std::string content = readFile(logger.operationsLogPath());
        EXPECT_NE(content.find(marker), std::string::npos);
        EXPECT_NE(content.find("op=logger-operation-channel"), std::string::npos);
        EXPECT_NE(content.find("operationId=logger-operation-channel"), std::string::npos);
    }

    TEST(LoggerTests, UsesConfiguredLogDirectory)
    {
        TempDirectory temp;
        const std::filesystem::path logDirectory = temp.path() / L"native-logs";
        ScopedEnvironmentVariable configuredLogDirectory(L"FLUXORA_LOG_DIR", logDirectory.wstring());

        Logger logger;
        logger.initialize();
        ASSERT_TRUE(logger.isInitialized());
        ASSERT_FALSE(logger.logPath().empty());

        EXPECT_EQ(normalized(logger.logDirectory()), normalized(logDirectory));

        const std::string marker = "configured-native-log-directory-marker";
        logger.write(LogLevel::Info, "LoggerTests", marker);
        const std::filesystem::path coreLogPath = logger.logPath();
        logger.shutdown();

        const std::string content = readFile(coreLogPath);
        EXPECT_NE(content.find(marker), std::string::npos);
    }

    TEST(LoggerTests, RedactsProviderSecretsAndPersonalIdentifiersAcrossAllChannels)
    {
        TempDirectory temp;
        const std::filesystem::path logDirectory = temp.path() / L"redacted-native-logs";
        ScopedEnvironmentVariable configuredLogDirectory(L"FLUXORA_LOG_DIR", logDirectory.wstring());

        Logger logger;
        logger.initialize();
        ASSERT_TRUE(logger.isInitialized());

        const std::string message =
            "callback=https://objects.example/archive?code=oauth-code-42&state=oauth-state-42 "
            "access_token=access-token-42 ReFrEsH_ToKeN:refresh-token-42 id_token=id-token-42 "
            "code_verifier=verifier-42 Authorization: Bearer bearer-token-42 "
            "Cookie=session-cookie-42 ClIeNt_SeCrEt=client-secret-42 user=user42@example.test "
            "stable_user_id=01234567-89ab-4cde-8fab-0123456789ab "
            "signed=https://objects.example/archive?X-Amz-Credential=credential-42&X-Amz-Signature=signature-42";

        logger.write(LogChannel::Core, LogLevel::Info, "LoggerTests", message);
        logger.write(LogChannel::Bridge, LogLevel::Info, "LoggerTests", message);
        logger.write(LogChannel::Operations, LogLevel::Info, "LoggerTests", message);
        logger.write(LogChannel::Crash, LogLevel::Info, "LoggerTests", message);

        const std::filesystem::path corePath = logger.logPath();
        const std::filesystem::path bridgePath = logger.bridgeLogPath();
        const std::filesystem::path operationsPath = logger.operationsLogPath();
        const std::filesystem::path crashPath = logger.crashLogPath();
        logger.shutdown();

        for (const std::filesystem::path& path : {
                 corePath,
                 bridgePath,
                 operationsPath,
                 crashPath})
        {
            const std::string content = readFile(path);
            for (const std::string_view forbidden : {
                     "oauth-code-42",
                     "oauth-state-42",
                     "access-token-42",
                     "refresh-token-42",
                     "id-token-42",
                     "verifier-42",
                     "bearer-token-42",
                     "session-cookie-42",
                     "client-secret-42",
                     "user42@example.test",
                     "01234567-89ab-4cde-8fab-0123456789ab",
                     "credential-42",
                     "signature-42"})
            {
                EXPECT_EQ(content.find(forbidden), std::string::npos)
                    << "Sensitive value leaked into " << path << ": " << forbidden;
            }
            EXPECT_NE(content.find("[redacted"), std::string::npos);
        }
    }

    TEST(LoggerTests, PreservesSafeCorrelationIdsAndRejectsUnsafeOperationIds)
    {
        TempDirectory temp;
        const std::filesystem::path logDirectory = temp.path() / L"operation-id-logs";
        ScopedEnvironmentVariable configuredLogDirectory(L"FLUXORA_LOG_DIR", logDirectory.wstring());

        Logger logger;
        logger.initialize();
        ASSERT_TRUE(logger.isInitialized());

        const std::wstring safeOperationId = L"01234567-89ab-4cde-8fab-0123456789ab";
        Logger::setOperationId(safeOperationId);
        logger.write(LogLevel::Info, "LoggerTests", "safe-operation-marker");
        Logger::setOperationId(L"user42@example.test");
        logger.write(LogLevel::Info, "LoggerTests", "unsafe-operation-marker");
        Logger::clearOperationId();

        const std::filesystem::path logPath = logger.logPath();
        logger.shutdown();
        const std::string content = readFile(logPath);
        EXPECT_NE(content.find("op=01234567-89ab-4cde-8fab-0123456789ab"), std::string::npos);
        EXPECT_NE(content.find("op=[invalid-operation-id]"), std::string::npos);
        EXPECT_EQ(content.find("user42@example.test"), std::string::npos);
    }
}
