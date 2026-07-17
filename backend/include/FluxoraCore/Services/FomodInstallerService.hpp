#pragma once

#include <filesystem>
#include <memory>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace fluxora
{
    struct FomodProfileContext;
    struct FomodAutoSelection;

    struct FomodFileEntry
    {
        std::wstring source;
        std::wstring destination;
        bool isFolder{false};
        bool alwaysInstall{false};
        bool installIfUsable{false};
        int priority{0};
    };

    struct FomodConditionFlag
    {
        std::wstring name;
        std::wstring value;
    };

    struct FomodDependencyNode
    {
        std::wstring kind;
        std::wstring op{L"And"};
        std::wstring file;
        std::wstring state;
        std::wstring flag;
        std::wstring value;
        std::wstring version;
        std::vector<FomodDependencyNode> children;
    };

    struct FomodTypePattern
    {
        FomodDependencyNode dependencies;
        std::wstring type;
    };

    struct FomodConditionalFilePattern
    {
        FomodDependencyNode dependencies;
        std::vector<FomodFileEntry> files;
    };

    struct FomodFileDependencyState
    {
        std::wstring file;
        std::wstring state;
        std::wstring sourceKind;
        std::wstring sourceName;
        bool exists{false};
    };

    enum class FomodPluginHeaderStatus
    {
        Parsed,
        Corrupt,
        Oversize,
        CandidateLimit,
        ReadBudgetExceeded
    };

    struct FomodPluginHeader
    {
        std::wstring outputFile;
        std::vector<std::wstring> masters;
        FomodPluginHeaderStatus status{FomodPluginHeaderStatus::Parsed};
        std::wstring issueCode;
    };

    struct FomodOption
    {
        std::wstring id;
        std::wstring name;
        std::wstring description;
        std::wstring imagePath;
        std::wstring type{L"Optional"};
        std::wstring defaultType{L"Optional"};
        std::vector<FomodFileEntry> files;
        std::vector<FomodConditionFlag> flags;
        std::vector<FomodTypePattern> typePatterns;
        std::vector<FomodPluginHeader> pluginHeaders;
    };

    struct FomodGroup
    {
        std::wstring id;
        std::wstring name;
        std::wstring type{L"SelectAny"};
        std::vector<FomodOption> options;
    };

    struct FomodStep
    {
        std::wstring id;
        std::wstring name;
        std::optional<FomodDependencyNode> visible;
        std::vector<FomodGroup> groups;
    };

    struct FomodInstallerDescriptor
    {
        bool isFomod{false};
        std::wstring moduleName;
        std::wstring moduleVersion;
        std::wstring moduleId;
        std::wstring moduleImagePath;
        std::wstring memoryKey;
        bool hasPreviousSelection{false};
        bool previousSelectionContextual{false};
        bool previousSelectionWeak{false};
        std::vector<std::wstring> previousSelectedOptionIds;
        std::vector<std::wstring> previousDeselectedOptionIds;
        std::vector<FomodFileDependencyState> fileDependencyStates;
        std::optional<FomodDependencyNode> moduleDependencies;
        std::vector<FomodFileEntry> requiredFiles;
        std::vector<FomodStep> steps;
        std::vector<FomodConditionalFilePattern> conditionalFilePatterns;
        std::shared_ptr<FomodProfileContext> profileContext;
        std::shared_ptr<FomodAutoSelection> autoSelection;
    };

    struct FomodPackageIdentity
    {
        std::wstring provider;
        std::wstring gameDomain;
        std::wstring remoteModId;
        std::wstring remoteFileId;
        std::wstring source;
        std::wstring fallbackName;
    };

    struct FomodInstallContext
    {
        std::filesystem::path projectDirectory;
        std::filesystem::path gameDirectory;
        std::filesystem::path modsDirectory;
        std::filesystem::path packageDirectory;
        std::filesystem::path destinationDirectory;
        FomodPackageIdentity identity;
        std::vector<std::wstring> selectedOptionIds;
        std::vector<std::wstring> gameDataFolders;
        const FomodProfileContext* profileContext{nullptr};
    };

    struct FomodRememberedManualDecision
    {
        std::wstring optionId;
        bool selected{false};
    };

    class FomodInstallerService final
    {
    public:
        FomodInstallerService() = delete;

        [[nodiscard]] static bool hasXmlInstaller(const std::filesystem::path& packageDirectory);

        [[nodiscard]] static FomodInstallerDescriptor analyze(
            const std::filesystem::path& projectDirectory,
            const std::filesystem::path& gameDirectory,
            const std::filesystem::path& modsDirectory,
            const std::filesystem::path& packageDirectory,
            const FomodPackageIdentity& identity,
            const std::vector<std::wstring>& gameDataFolders = {},
            std::wstring_view profileName = {},
            std::wstring_view profileFingerprint = {});

        [[nodiscard]] static std::vector<std::wstring> install(const FomodInstallContext& context);

        [[nodiscard]] static std::vector<std::wstring> referencedProfileFiles(
            const FomodInstallerDescriptor& descriptor);

        static void rememberSelection(
            const std::filesystem::path& projectDirectory,
            const FomodInstallerDescriptor& descriptor,
            const std::vector<std::wstring>& selectedOptionIds);

        static void rememberSelection(
            const std::filesystem::path& projectDirectory,
            const FomodInstallerDescriptor& descriptor,
            const std::vector<std::wstring>& selectedOptionIds,
            std::wstring_view profileName,
            std::wstring_view profileFingerprint,
            const std::vector<FomodRememberedManualDecision>& manualDecisions);
    };
}
