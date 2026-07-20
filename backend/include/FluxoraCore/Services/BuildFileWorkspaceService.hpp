#pragma once

#include "FluxoraCore/Services/IService.hpp"
#include "FluxoraCore/Services/ConfigRecipeRegistry.hpp"

#include <cstdint>
#include <filesystem>
#include <functional>
#include <memory>
#include <stdexcept>
#include <string>
#include <string_view>
#include <vector>

namespace fluxora
{
    class BuildPathSettingsService;
    class Logger;

    enum class BuildFileScope
    {
        Build,
        Game,
        Downloads
    };

    enum class BuildFileKind
    {
        Directory,
        Text,
        Archive,
        Unsupported
    };

    enum class BuildFileTextEncoding
    {
        Utf8,
        Utf8Bom,
        Utf16Le,
        Utf16Be,
        Windows1251,
        Windows1252,
        Unsupported
    };

    enum class BuildFileLineEnding
    {
        None,
        Lf,
        CrLf,
        Mixed
    };

    enum class BuildFileMutationFormat
    {
        PlainText,
        Json,
        Jsonc,
        Ini,
        ExactText
    };

    enum class BuildFileMutationOperation
    {
        ExactPatch,
        JsonSetPointer,
        IniSetKey,
        IniAddKey,
        IniRemoveKey
    };

    enum class BuildFileChangeStatus
    {
        Applied,
        Created,
        RolledBack,
        Conflict
    };

    enum class BuildFileRollbackState
    {
        Available,
        RolledBack,
        Conflict,
        Unavailable
    };

    enum class BuildFileResolution
    {
        Unique,
        Ambiguous,
        NotFound
    };

    class BuildFileWorkspaceError final : public std::runtime_error
    {
    public:
        BuildFileWorkspaceError(std::string code, std::string message);

        [[nodiscard]] const std::string& code() const noexcept;

    private:
        std::string code_;
    };

    struct BuildFileMetadata
    {
        std::wstring fileRef;
        std::wstring parentRef;
        BuildFileScope scope{BuildFileScope::Build};
        BuildFileKind kind{BuildFileKind::Unsupported};
        std::wstring ownerMod;
        std::wstring relativePath;
        std::wstring fileName;
        std::wstring extension;
        std::uintmax_t size{0};
        std::wstring createdAt;
        std::wstring modifiedAt;
        bool readOnly{false};
        bool hidden{false};
        std::vector<std::wstring> conflictingOwners;
        std::wstring indexRevision;
        std::wstring version;
    };

    struct BuildFileSearchRequest
    {
        BuildFileScope scope{BuildFileScope::Build};
        std::wstring query;
        std::size_t limit{20};
        std::wstring cursor;
        std::function<bool()> cancellationRequested;
        std::wstring revision;
    };

    struct BuildFileSearchPage
    {
        std::vector<BuildFileMetadata> entries;
        std::wstring nextCursor;
        std::wstring revision;
        std::size_t totalMatches{0};
        std::size_t indexedCount{0};
        bool complete{false};
        bool cancelled{false};
        bool indexed{false};
    };

    struct BuildFileDiscoveryRequest
    {
        std::vector<BuildFileScope> scopes;
        std::vector<std::wstring> aliases;
        std::vector<std::wstring> extensions;
        std::vector<std::wstring> configHints;
        std::vector<std::wstring> semanticKeys;
        std::size_t limit{20};
        std::wstring revision;
        std::wstring cursor;
        std::function<bool()> cancellationRequested;
    };

    struct BuildFileDiscoveryCandidate
    {
        BuildFileMetadata file;
        double confidence{0.0};
        std::vector<std::wstring> matchReasons;
        std::wstring virtualPath;
        std::wstring effectiveOwner;
        bool effectiveWinner{false};
    };

    struct BuildFileDiscoveryStatistics
    {
        std::size_t scannedEntries{0};
        std::size_t skippedEntries{0};
        std::size_t unavailableRoots{0};
        std::size_t candidateCount{0};
    };

    struct BuildFileDiscoveryPage
    {
        std::vector<BuildFileDiscoveryCandidate> candidates;
        BuildFileDiscoveryStatistics statistics;
        std::wstring revision;
        std::wstring nextCursor;
        std::size_t totalMatches{0};
        std::size_t indexedCount{0};
        BuildFileResolution resolution{BuildFileResolution::NotFound};
        bool complete{false};
        bool cancelled{false};
    };

    struct BuildFileTextReadRequest
    {
        std::wstring fileRef;
        std::size_t startLine{1};
        std::size_t maxLines{120};
        std::size_t maxBytes{8192};
        bool editorMode{false};
    };

    struct BuildFileTextRead
    {
        std::wstring fileRef;
        BuildFileScope scope{BuildFileScope::Build};
        std::wstring relativePath;
        std::wstring content;
        std::size_t startLine{1};
        std::size_t endLine{1};
        bool truncated{false};
        BuildFileTextEncoding encoding{BuildFileTextEncoding::Unsupported};
        BuildFileLineEnding lineEnding{BuildFileLineEnding::None};
        std::wstring sha256;
        std::wstring revision;
        std::wstring version;
    };

    struct BuildFileQueryResult
    {
        std::wstring fileRef;
        std::wstring query;
        std::wstring kind;
        std::wstring value;
        std::wstring sha256;
        std::wstring version;
    };

    struct BuildFileTextSearchMatch
    {
        std::wstring fileRef;
        BuildFileScope scope{BuildFileScope::Build};
        std::wstring relativePath;
        std::size_t line{1};
        std::wstring before;
        std::wstring match;
        std::wstring after;
    };

    struct BuildFileTextSearchPage
    {
        std::vector<BuildFileTextSearchMatch> matches;
        std::wstring nextCursor;
        std::wstring revision;
        std::size_t totalMatches{0};
        std::size_t indexedCount{0};
        bool complete{false};
        bool cancelled{false};
    };

    struct BuildFileMutation
    {
        std::wstring fileRef;
        std::wstring revision;
        std::wstring parentRef;
        std::wstring fileName;
        std::wstring baseSha256;
        std::wstring expectedText;
        std::wstring replacementText;
        std::wstring content;
        BuildFileMutationFormat format{BuildFileMutationFormat::ExactText};
        BuildFileMutationOperation operation{BuildFileMutationOperation::ExactPatch};
        std::wstring section;
        std::wstring key;
        std::wstring value;
        std::wstring pointer;
        std::wstring expectedValue;
        bool createFile{false};
        bool expectedAbsent{false};
        bool wholeDocument{false};
        bool allowKnownConflict{false};

        [[nodiscard]] static BuildFileMutation patch(
            std::wstring fileRef,
            std::wstring baseSha256,
            std::wstring expectedText,
            std::wstring replacementText,
            BuildFileMutationFormat format = BuildFileMutationFormat::ExactText);

        [[nodiscard]] static BuildFileMutation create(
            std::wstring parentRef,
            std::wstring fileName,
            std::wstring content,
            BuildFileMutationFormat format = BuildFileMutationFormat::ExactText);

        [[nodiscard]] static BuildFileMutation iniKey(
            BuildFileMutationOperation operation,
            std::wstring fileRef,
            std::wstring baseSha256,
            std::wstring section,
            std::wstring key,
            std::wstring value = L"");

        [[nodiscard]] static BuildFileMutation jsonPointer(
            std::wstring fileRef,
            std::wstring baseSha256,
            std::wstring pointer,
            std::wstring expectedValue,
            std::wstring value);
    };

    struct BuildFileDiffHunk
    {
        std::size_t oldStart{1};
        std::size_t oldLines{0};
        std::size_t newStart{1};
        std::size_t newLines{0};
        std::vector<std::wstring> lines;
    };

    struct BuildFileChange
    {
        std::wstring fileRef;
        BuildFileScope scope{BuildFileScope::Build};
        std::wstring ownerMod;
        std::wstring relativePath;
        BuildFileChangeStatus status{BuildFileChangeStatus::Applied};
        std::vector<BuildFileDiffHunk> hunks;
        std::size_t addedLines{0};
        std::size_t removedLines{0};
        std::wstring validation;
        std::wstring verification;
        std::wstring beforeVersion;
        std::wstring afterVersion;
        BuildFileRollbackState rollbackState{BuildFileRollbackState::Available};
    };

    struct FluxoraAiFileChangeSet
    {
        std::wstring operationId;
        std::wstring runId;
        std::wstring chatId;
        std::vector<BuildFileChange> files;
        BuildFileRollbackState rollbackState{BuildFileRollbackState::Available};
    };

    struct BuildFileRollbackResult
    {
        std::wstring operationId;
        std::wstring runId;
        BuildFileRollbackState state{BuildFileRollbackState::Unavailable};
        std::vector<BuildFileChange> files;
    };

    class BuildFileWorkspaceService final : public IService
    {
    public:
        struct State;

        BuildFileWorkspaceService(
            Logger& logger,
            const BuildPathSettingsService& pathSettings) noexcept;
        ~BuildFileWorkspaceService() override;

        BuildFileWorkspaceService(const BuildFileWorkspaceService&) = delete;
        BuildFileWorkspaceService& operator=(const BuildFileWorkspaceService&) = delete;

        void initialize() override;
        void shutdown() override;

        void beginChat(
            std::wstring_view chatId,
            const std::filesystem::path& projectDirectory,
            std::wstring_view profileName = L"Default");
        void endChat(std::wstring_view chatId);

        [[nodiscard]] BuildFileDiscoveryPage discover(
            std::wstring_view chatId,
            const BuildFileDiscoveryRequest& request);

        [[nodiscard]] BuildFileSearchPage search(
            std::wstring_view chatId,
            const BuildFileSearchRequest& request);
        [[nodiscard]] BuildFileMetadata stat(
            std::wstring_view chatId,
            std::wstring_view fileRef);
        [[nodiscard]] BuildFileTextRead readText(
            std::wstring_view chatId,
            const BuildFileTextReadRequest& request);
        [[nodiscard]] BuildFileQueryResult queryJson(
            std::wstring_view chatId,
            std::wstring_view fileRef,
            std::wstring_view pointer);
        [[nodiscard]] BuildFileQueryResult queryIni(
            std::wstring_view chatId,
            std::wstring_view fileRef,
            std::wstring_view section,
            std::wstring_view key);
        [[nodiscard]] ConfigRecipeInspection inspectConfigRecipe(
            std::wstring_view chatId,
            std::wstring_view fileRef,
            std::wstring_view targetPointer,
            std::wstring_view requestedValue);
        [[nodiscard]] BuildFileTextSearchPage searchText(
            std::wstring_view chatId,
            const BuildFileSearchRequest& request);

        [[nodiscard]] FluxoraAiFileChangeSet apply(
            std::wstring_view chatId,
            std::wstring_view runId,
            std::wstring_view operationId,
            const std::vector<BuildFileMutation>& mutations);
        [[nodiscard]] BuildFileRollbackResult rollbackFile(
            std::wstring_view chatId,
            std::wstring_view runId,
            std::wstring_view fileRef,
            std::wstring_view operationId);
        [[nodiscard]] BuildFileRollbackResult rollbackRun(
            std::wstring_view chatId,
            std::wstring_view runId,
            std::wstring_view operationId);

        [[nodiscard]] bool isInitialized() const noexcept;

    private:
        std::unique_ptr<State> state_;
    };
}
