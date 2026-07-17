#include "FluxoraCore/Services/FomodInstallerService.hpp"
#include "FluxoraCore/Services/FomodProfileContextService.hpp"

#include "TestFilesystem.hpp"

#include <gtest/gtest.h>

#include <cstdint>
#include <filesystem>
#include <fstream>

namespace fluxora::tests
{
    namespace
    {
        constexpr const char* moduleConfig = R"xml(<?xml version="1.0" encoding="utf-8"?>
<config>
  <moduleName>Example Mod</moduleName>
  <moduleImage path="fomod/images/module.png" />
  <requiredInstallFiles>
    <file source="common/readme.txt" />
  </requiredInstallFiles>
  <installSteps order="Explicit">
    <installStep name="Choose">
      <optionalFileGroups order="Explicit">
        <group name="Variant" type="SelectExactlyOne">
          <plugins order="Explicit">
            <plugin name="Option A">
              <description>Install A</description>
              <image path="fomod/images/option-a.png" />
              <conditionFlags>
                <flag name="variant">A</flag>
              </conditionFlags>
              <typeDescriptor>
                <type name="Recommended" />
              </typeDescriptor>
            </plugin>
            <plugin name="Option B">
              <description>Install B</description>
              <conditionFlags>
                <flag name="variant">B</flag>
              </conditionFlags>
              <typeDescriptor>
                <type name="Optional" />
              </typeDescriptor>
            </plugin>
          </plugins>
        </group>
      </optionalFileGroups>
    </installStep>
  </installSteps>
  <conditionalFileInstalls>
    <patterns>
      <pattern>
        <dependencies operator="And">
          <flagDependency flag="variant" value="A" />
        </dependencies>
        <files>
          <folder source="variant-a" />
        </files>
      </pattern>
      <pattern>
        <dependencies operator="And">
          <flagDependency flag="variant" value="B" />
        </dependencies>
        <files>
          <folder source="variant-b" />
        </files>
      </pattern>
    </patterns>
  </conditionalFileInstalls>
</config>)xml";

        void writePackage(const std::filesystem::path& package)
        {
            writeTextFile(package / "fomod" / "ModuleConfig.xml", moduleConfig);
            writeTextFile(package / "fomod" / "info.xml", R"xml(<fomod><Name>Example Mod</Name><Version MachineVersion="1.2.3">1.2.3</Version><Id>example-mod</Id></fomod>)xml");
            writeTextFile(package / "common" / "readme.txt", "common");
            writeTextFile(package / "variant-a" / "Data" / "plugin.esp", "a");
            writeTextFile(package / "variant-b" / "Data" / "plugin.esp", "b");
        }

        FomodPackageIdentity identity()
        {
            return FomodPackageIdentity{
                L"nexus",
                L"skyrimspecialedition",
                L"123",
                L"456",
                L"nxm://skyrimspecialedition/mods/123/files/456",
                L"Example Mod"
            };
        }

        void appendLittleEndian16(std::string& bytes, std::uint16_t value)
        {
            bytes.push_back(static_cast<char>(value & 0xff));
            bytes.push_back(static_cast<char>((value >> 8) & 0xff));
        }

        void appendLittleEndian32(std::string& bytes, std::uint32_t value)
        {
            bytes.push_back(static_cast<char>(value & 0xff));
            bytes.push_back(static_cast<char>((value >> 8) & 0xff));
            bytes.push_back(static_cast<char>((value >> 16) & 0xff));
            bytes.push_back(static_cast<char>((value >> 24) & 0xff));
        }

        void writeTes4Plugin(
            const std::filesystem::path& path,
            const std::vector<std::string>& masters)
        {
            std::string payload;
            for (const std::string& master : masters)
            {
                payload += "MAST";
                appendLittleEndian16(payload, static_cast<std::uint16_t>(master.size() + 1));
                payload += master;
                payload.push_back('\0');
            }
            std::string bytes = "TES4";
            appendLittleEndian32(bytes, static_cast<std::uint32_t>(payload.size()));
            bytes.resize(24, '\0');
            bytes += payload;
            std::filesystem::create_directories(path.parent_path());
            std::ofstream output(path, std::ios::binary | std::ios::trunc);
            output.write(bytes.data(), static_cast<std::streamsize>(bytes.size()));
        }
    }

    TEST(FomodInstallerServiceTests, AnalyzeParsesXmlDescriptorAndPreviousSelection)
    {
        TempDirectory temp;
        const std::filesystem::path project = temp.path() / "project";
        const std::filesystem::path package = temp.path() / "package";
        writePackage(package);

        FomodInstallerDescriptor descriptor = FomodInstallerService::analyze(
            project,
            temp.path() / "game",
            temp.path() / "mods",
            package,
            identity());

        ASSERT_TRUE(descriptor.isFomod);
        EXPECT_EQ(L"Example Mod", descriptor.moduleName);
        EXPECT_EQ(L"1.2.3", descriptor.moduleVersion);
        ASSERT_EQ(1u, descriptor.steps.size());
        ASSERT_EQ(1u, descriptor.steps[0].groups.size());
        ASSERT_EQ(2u, descriptor.steps[0].groups[0].options.size());
        EXPECT_EQ(L"choose-variant-option-a", descriptor.steps[0].groups[0].options[0].id);
        EXPECT_EQ(L"fomod/images/module.png", descriptor.moduleImagePath);
        EXPECT_EQ(L"fomod/images/option-a.png", descriptor.steps[0].groups[0].options[0].imagePath);
        EXPECT_FALSE(descriptor.hasPreviousSelection);

        FomodInstallerService::rememberSelection(
            project,
            descriptor,
            {L"choose-variant-option-b"});

        FomodInstallerDescriptor nextDescriptor = FomodInstallerService::analyze(
            project,
            temp.path() / "game",
            temp.path() / "mods",
            package,
            identity());

        ASSERT_TRUE(nextDescriptor.hasPreviousSelection);
        ASSERT_EQ(1u, nextDescriptor.previousSelectedOptionIds.size());
        EXPECT_EQ(L"choose-variant-option-b", nextDescriptor.previousSelectedOptionIds[0]);
    }

    TEST(FomodInstallerServiceTests, InstallCopiesOnlySelectedConditionalFiles)
    {
        TempDirectory temp;
        const std::filesystem::path project = temp.path() / "project";
        const std::filesystem::path package = temp.path() / "package";
        const std::filesystem::path destination = temp.path() / "mods" / "Example Mod";
        writePackage(package);

        std::vector<std::wstring> applied = FomodInstallerService::install(FomodInstallContext{
            project,
            temp.path() / "game",
            temp.path() / "mods",
            package,
            destination,
            identity(),
            {L"choose-variant-option-a"}
        });

        ASSERT_EQ(1u, applied.size());
        EXPECT_EQ(L"choose-variant-option-a", applied[0]);
        EXPECT_TRUE(std::filesystem::exists(destination / "common" / "readme.txt"));
        EXPECT_TRUE(std::filesystem::exists(destination / "Data" / "plugin.esp"));
        EXPECT_EQ("a", readTextFile(destination / "Data" / "plugin.esp"));
    }

    TEST(FomodInstallerServiceTests, AnalyzeReportsFileDependencyState)
    {
        TempDirectory temp;
        const std::filesystem::path project = temp.path() / "project";
        const std::filesystem::path package = temp.path() / "package";
        const std::filesystem::path mods = temp.path() / "mods";
        writeTextFile(package / "fomod" / "ModuleConfig.xml", R"xml(
<config>
  <moduleName>Detected Patch</moduleName>
  <installSteps order="Explicit">
    <installStep name="Patches">
      <optionalFileGroups order="Explicit">
        <group name="Lanterns" type="SelectExactlyOne">
          <plugins order="Explicit">
            <plugin name="Lanterns patch">
              <typeDescriptor>
                <dependencyType>
                  <defaultType name="Optional" />
                  <patterns>
                    <pattern>
                      <dependencies operator="And">
                        <fileDependency file="Data/Lanterns Of Skyrim II.esp" state="Active" />
                      </dependencies>
                      <type name="Recommended" />
                    </pattern>
                  </patterns>
                </dependencyType>
              </typeDescriptor>
            </plugin>
          </plugins>
        </group>
      </optionalFileGroups>
    </installStep>
  </installSteps>
</config>)xml");
        writeTextFile(mods / "Lanterns" / "Data" / "Lanterns Of Skyrim II.esp", "plugin");

        FomodInstallerDescriptor descriptor = FomodInstallerService::analyze(
            project,
            temp.path() / "game",
            mods,
            package,
            identity());

        ASSERT_EQ(1u, descriptor.fileDependencyStates.size());
        EXPECT_EQ(L"Data\\Lanterns Of Skyrim II.esp", descriptor.fileDependencyStates[0].file);
        EXPECT_TRUE(descriptor.fileDependencyStates[0].exists);
    }

    TEST(FomodInstallerServiceTests, InstallUsesExactProfileFileStateInsteadOfFilesystemPresence)
    {
        TempDirectory temp;
        const std::filesystem::path project = temp.path() / "project";
        const std::filesystem::path package = temp.path() / "package";
        const std::filesystem::path mods = temp.path() / "mods";
        writeTextFile(package / "fomod" / "ModuleConfig.xml", R"xml(
<config>
  <moduleName>Profile Patch</moduleName>
  <installSteps order="Explicit">
    <installStep name="Patches">
      <optionalFileGroups order="Explicit">
        <group name="Patches" type="SelectAny">
          <plugins order="Explicit">
            <plugin name="Lanterns Patch">
              <files><file source="payload/patch.txt" destination="Data/patch.txt" /></files>
              <typeDescriptor>
                <dependencyType>
                  <defaultType name="NotUsable" />
                  <patterns>
                    <pattern>
                      <dependencies operator="And">
                        <fileDependency file="Data/Lanterns.esp" state="Active" />
                      </dependencies>
                      <type name="Optional" />
                    </pattern>
                  </patterns>
                </dependencyType>
              </typeDescriptor>
            </plugin>
          </plugins>
        </group>
      </optionalFileGroups>
    </installStep>
  </installSteps>
</config>)xml");
        writeTextFile(package / "payload" / "patch.txt", "patch");
        writeTextFile(mods / "Disabled Lanterns" / "Data" / "Lanterns.esp", "plugin");

        const FomodInstallerDescriptor descriptor = FomodInstallerService::analyze(
            project,
            temp.path() / "game",
            mods,
            package,
            identity());
        const std::wstring optionId = descriptor.steps[0].groups[0].options[0].id;

        FomodProfileContext context;
        context.fileStates.push_back(FomodProfileFileState{
            L"Data\\Lanterns.esp",
            FomodProfileFileStateKind::Inactive,
            L"mod",
            L"Disabled Lanterns",
            true
        });
        const std::filesystem::path inactiveDestination = temp.path() / "inactive";
        const std::vector<std::wstring> inactiveApplied = FomodInstallerService::install(FomodInstallContext{
            project,
            temp.path() / "game",
            mods,
            package,
            inactiveDestination,
            identity(),
            {optionId},
            {},
            &context
        });

        EXPECT_TRUE(inactiveApplied.empty());
        EXPECT_FALSE(std::filesystem::exists(inactiveDestination / "Data" / "patch.txt"));

        context.fileStates[0].state = FomodProfileFileStateKind::Active;
        const std::filesystem::path activeDestination = temp.path() / "active";
        const std::vector<std::wstring> activeApplied = FomodInstallerService::install(FomodInstallContext{
            project,
            temp.path() / "game",
            mods,
            package,
            activeDestination,
            identity(),
            {optionId},
            {},
            &context
        });

        EXPECT_EQ(activeApplied, (std::vector<std::wstring>{optionId}));
        EXPECT_TRUE(std::filesystem::exists(activeDestination / "Data" / "patch.txt"));
    }

    TEST(FomodInstallerServiceTests, AnalyzeParsesModuleAndScriptExtenderDependencies)
    {
        TempDirectory temp;
        const std::filesystem::path project = temp.path() / "project";
        const std::filesystem::path package = temp.path() / "package";
        writeTextFile(package / "fomod" / "ModuleConfig.xml", R"xml(
<config>
  <moduleName>Versioned Mod</moduleName>
  <moduleDependencies operator="And">
    <gameDependency version="1.6.1170" />
    <fommDependency version="0.13.21" />
    <skseDependency version="2.2.6" />
    <foseDependency version="1.3" />
    <nvseDependency version="6.3" />
    <f4seDependency version="0.7.2" />
  </moduleDependencies>
</config>)xml");

        const FomodInstallerDescriptor descriptor = FomodInstallerService::analyze(
            project,
            temp.path() / "game",
            temp.path() / "mods",
            package,
            identity());

        ASSERT_TRUE(descriptor.moduleDependencies.has_value());
        const std::vector<FomodDependencyNode>& dependencies = descriptor.moduleDependencies->children;
        ASSERT_EQ(dependencies.size(), 6u);
        EXPECT_EQ(dependencies[0].kind, L"game");
        EXPECT_EQ(dependencies[1].kind, L"fomm");
        EXPECT_EQ(dependencies[2].kind, L"skse");
        EXPECT_EQ(dependencies[3].kind, L"fose");
        EXPECT_EQ(dependencies[4].kind, L"nvse");
        EXPECT_EQ(dependencies[5].kind, L"f4se");
    }

    TEST(FomodInstallerServiceTests, AnalyzeReadsOnlyDeclaredTes4PluginHeaders)
    {
        TempDirectory temp;
        const std::filesystem::path project = temp.path() / "project";
        const std::filesystem::path package = temp.path() / "package";
        writeTextFile(package / "fomod" / "ModuleConfig.xml", R"xml(
<config>
  <moduleName>Header Patch</moduleName>
  <installSteps order="Explicit">
    <installStep name="Patch">
      <optionalFileGroups order="Explicit">
        <group name="Patch" type="SelectAny">
          <plugins order="Explicit">
            <plugin name="Patch">
              <files><file source="payload/Patch.esp" destination="Data/Patch.esp" /></files>
              <typeDescriptor><type name="Optional" /></typeDescriptor>
            </plugin>
          </plugins>
        </group>
      </optionalFileGroups>
    </installStep>
  </installSteps>
</config>)xml");
        writeTes4Plugin(package / "payload" / "Patch.esp", {"Lanterns.esp", "Unofficial Patch.esp"});
        writeTes4Plugin(package / "undeclared" / "Ignored.esp", {"ShouldNotBeRead.esp"});

        const FomodInstallerDescriptor descriptor = FomodInstallerService::analyze(
            project,
            temp.path() / "game",
            temp.path() / "mods",
            package,
            identity());

        const FomodOption& option = descriptor.steps[0].groups[0].options[0];
        ASSERT_EQ(option.pluginHeaders.size(), 1u);
        EXPECT_EQ(option.pluginHeaders[0].status, FomodPluginHeaderStatus::Parsed);
        EXPECT_EQ(option.pluginHeaders[0].outputFile, L"Data\\Patch.esp");
        EXPECT_EQ(
            option.pluginHeaders[0].masters,
            (std::vector<std::wstring>{L"Lanterns.esp", L"Unofficial Patch.esp"}));
    }

    TEST(FomodInstallerServiceTests, FolderMappingsPreserveTes4PluginOutputPaths)
    {
        TempDirectory temp;
        const std::filesystem::path project = temp.path() / "project";
        const std::filesystem::path package = temp.path() / "package";
        writeTextFile(package / "fomod" / "ModuleConfig.xml", R"xml(
<config>
  <moduleName>Folder Header Patch</moduleName>
  <installSteps order="Explicit"><installStep name="Patch"><optionalFileGroups order="Explicit">
    <group name="Patch" type="SelectAny"><plugins order="Explicit"><plugin name="Patch">
      <files><folder source="payload" destination="Data/Patches" /></files>
      <typeDescriptor><type name="Optional" /></typeDescriptor>
    </plugin></plugins></group>
  </optionalFileGroups></installStep></installSteps>
</config>)xml");
        writeTes4Plugin(package / "payload" / "Nested" / "FolderPatch.esp", {"Lanterns.esp"});

        const FomodInstallerDescriptor descriptor = FomodInstallerService::analyze(
            project,
            temp.path() / "game",
            temp.path() / "mods",
            package,
            identity());

        const FomodOption& option = descriptor.steps[0].groups[0].options[0];
        ASSERT_EQ(option.pluginHeaders.size(), 1u);
        EXPECT_EQ(option.pluginHeaders[0].status, FomodPluginHeaderStatus::Parsed);
        EXPECT_EQ(option.pluginHeaders[0].outputFile, L"Data\\Patches\\Nested\\FolderPatch.esp");
        EXPECT_EQ(option.pluginHeaders[0].masters, (std::vector<std::wstring>{L"Lanterns.esp"}));
    }

    TEST(FomodInstallerServiceTests, OversizeOrCorruptTes4HeaderRequiresReviewWithoutFailingAnalysis)
    {
        TempDirectory temp;
        const std::filesystem::path project = temp.path() / "project";
        const std::filesystem::path package = temp.path() / "package";
        writeTextFile(package / "fomod" / "ModuleConfig.xml", R"xml(
<config>
  <moduleName>Unsafe Headers</moduleName>
  <installSteps order="Explicit"><installStep name="Patch"><optionalFileGroups order="Explicit">
    <group name="Patch" type="SelectAny"><plugins order="Explicit">
      <plugin name="Oversize"><files><file source="Oversize.esp" /></files></plugin>
      <plugin name="Corrupt"><files><file source="Corrupt.esp" /></files></plugin>
      <plugin name="Missing"><files><file source="Missing.esp" destination="Data/Missing.esp" /></files></plugin>
    </plugins></group>
  </optionalFileGroups></installStep></installSteps>
</config>)xml");
        std::string oversize = "TES4";
        appendLittleEndian32(oversize, 8 * 1024 * 1024 + 1);
        oversize.resize(24, '\0');
        std::filesystem::create_directories(package);
        {
            std::ofstream output(package / "Oversize.esp", std::ios::binary | std::ios::trunc);
            output.write(oversize.data(), static_cast<std::streamsize>(oversize.size()));
        }
        writeTextFile(package / "Corrupt.esp", "not a plugin");

        const FomodInstallerDescriptor descriptor = FomodInstallerService::analyze(
            project,
            temp.path() / "game",
            temp.path() / "mods",
            package,
            identity());

        ASSERT_EQ(descriptor.steps[0].groups[0].options[0].pluginHeaders.size(), 1u);
        ASSERT_EQ(descriptor.steps[0].groups[0].options[1].pluginHeaders.size(), 1u);
        ASSERT_EQ(descriptor.steps[0].groups[0].options[2].pluginHeaders.size(), 1u);
        EXPECT_EQ(
            descriptor.steps[0].groups[0].options[0].pluginHeaders[0].status,
            FomodPluginHeaderStatus::Oversize);
        EXPECT_EQ(
            descriptor.steps[0].groups[0].options[1].pluginHeaders[0].status,
            FomodPluginHeaderStatus::Corrupt);
        EXPECT_EQ(
            descriptor.steps[0].groups[0].options[2].pluginHeaders[0].status,
            FomodPluginHeaderStatus::Corrupt);
        EXPECT_EQ(
            descriptor.steps[0].groups[0].options[2].pluginHeaders[0].issueCode,
            L"tes4.sourceMissing");
    }

    TEST(FomodInstallerServiceTests, MemoryV1IsAWeakIndependentHintAndSuccessfulInstallRewritesV2)
    {
        TempDirectory temp;
        const std::filesystem::path project = temp.path() / "project";
        const std::filesystem::path package = temp.path() / "package";
        writeTextFile(package / "fomod" / "ModuleConfig.xml", R"xml(
<config>
  <moduleName>Memory Mod</moduleName>
  <installSteps order="Explicit"><installStep name="Options"><optionalFileGroups order="Explicit">
    <group name="Independent" type="SelectExactlyOne"><plugins order="Explicit">
      <plugin name="A"><typeDescriptor><type name="Optional" /></typeDescriptor></plugin>
      <plugin name="B"><typeDescriptor><type name="Optional" /></typeDescriptor></plugin>
    </plugins></group>
    <group name="Contextual" type="SelectAny"><plugins order="Explicit">
      <plugin name="Patch"><typeDescriptor><dependencyType><defaultType name="Optional" /><patterns><pattern>
        <dependencies><fileDependency file="Data/Master.esp" state="Active" /></dependencies>
        <type name="Recommended" />
      </pattern></patterns></dependencyType></typeDescriptor></plugin>
    </plugins></group>
  </optionalFileGroups></installStep></installSteps>
</config>)xml");
        const std::wstring optionA = L"options-independent-a";
        const std::wstring optionB = L"options-independent-b";
        const std::wstring patch = L"options-contextual-patch";
        writeTextFile(project / ".flow" / "fomod-memory.json", R"json({
  "schemaVersion": 1,
  "entries": [{
    "key": "nexus:skyrimspecialedition:123",
    "moduleName": "Memory Mod",
    "moduleVersion": "",
    "selectedOptionIds": ["options-independent-a", "options-contextual-patch"]
  }]
})json");

        FomodInstallerDescriptor legacy = FomodInstallerService::analyze(
            project,
            temp.path() / "game",
            temp.path() / "mods",
            package,
            identity(),
            {},
            L"Gameplay",
            L"fingerprint-1");

        EXPECT_TRUE(legacy.previousSelectionWeak);
        EXPECT_EQ(legacy.previousSelectedOptionIds, (std::vector<std::wstring>{optionA}));

        FomodInstallerService::rememberSelection(
            project,
            legacy,
            {optionB, patch},
            L"Gameplay",
            L"fingerprint-1",
            {
                FomodRememberedManualDecision{optionA, false},
                FomodRememberedManualDecision{optionB, true},
                FomodRememberedManualDecision{patch, true}
            });

        const std::string memory = readTextFile(project / ".flow" / "fomod-memory.json");
        EXPECT_NE(memory.find("\"schemaVersion\":2"), std::string::npos);
        FomodInstallerDescriptor contextual = FomodInstallerService::analyze(
            project,
            temp.path() / "game",
            temp.path() / "mods",
            package,
            identity(),
            {},
            L"Gameplay",
            L"fingerprint-1");
        EXPECT_TRUE(contextual.previousSelectionContextual);
        EXPECT_EQ(contextual.previousSelectedOptionIds, (std::vector<std::wstring>{optionB, patch}));

        FomodInstallerDescriptor global = FomodInstallerService::analyze(
            project,
            temp.path() / "game",
            temp.path() / "mods",
            package,
            identity(),
            {},
            L"Gameplay",
            L"fingerprint-2");
        EXPECT_FALSE(global.previousSelectionContextual);
        EXPECT_FALSE(global.previousSelectionWeak);
        EXPECT_EQ(global.previousSelectedOptionIds, (std::vector<std::wstring>{optionB}));
        EXPECT_EQ(global.previousDeselectedOptionIds, (std::vector<std::wstring>{optionA}));

        FomodInstallerService::rememberSelection(
            project,
            contextual,
            {optionA},
            L"Gameplay",
            L"fingerprint-3",
            {});
        const FomodInstallerDescriptor afterAutomaticInstall = FomodInstallerService::analyze(
            project,
            temp.path() / "game",
            temp.path() / "mods",
            package,
            identity(),
            {},
            L"Gameplay",
            L"fingerprint-4");
        EXPECT_EQ(afterAutomaticInstall.previousSelectedOptionIds, (std::vector<std::wstring>{optionB}));
        EXPECT_EQ(afterAutomaticInstall.previousDeselectedOptionIds, (std::vector<std::wstring>{optionA}));
    }

    TEST(FomodInstallerServiceTests, FileDependencyUsesSelectedGameDataFolderForNormalizedMods)
    {
        TempDirectory temp;
        const std::filesystem::path project = temp.path() / "project";
        const std::filesystem::path package = temp.path() / "package";
        const std::filesystem::path mods = temp.path() / "mods";
        writeTextFile(package / "fomod" / "ModuleConfig.xml", R"xml(
<config>
  <moduleName>Fictional Patch</moduleName>
  <installSteps order="Explicit">
    <installStep name="Patches">
      <optionalFileGroups order="Explicit">
        <group name="Compatibility" type="SelectAny">
          <plugins order="Explicit">
            <plugin name="Installed plugin patch">
              <typeDescriptor>
                <dependencyType>
                  <defaultType name="Optional" />
                  <patterns>
                    <pattern>
                      <dependencies operator="And">
                        <fileDependency file="Content/Fictional.plugin" state="Active" />
                      </dependencies>
                      <type name="Recommended" />
                    </pattern>
                  </patterns>
                </dependencyType>
              </typeDescriptor>
            </plugin>
          </plugins>
        </group>
      </optionalFileGroups>
    </installStep>
  </installSteps>
</config>)xml");
        writeTextFile(mods / "Installed Fictional Mod" / "Fictional.plugin", "plugin");

        const FomodPackageIdentity fictionalIdentity{
            L"manual",
            L"fictionalgame",
            L"123",
            L"456",
            L"fictional://mods/123/files/456",
            L"Fictional Patch"
        };

        FomodInstallerDescriptor descriptor = FomodInstallerService::analyze(
            project,
            temp.path() / "game",
            mods,
            package,
            fictionalIdentity,
            {L"Content"});

        ASSERT_EQ(1u, descriptor.fileDependencyStates.size());
        EXPECT_EQ(L"Content\\Fictional.plugin", descriptor.fileDependencyStates[0].file);
        EXPECT_TRUE(descriptor.fileDependencyStates[0].exists);
    }

    TEST(FomodInstallerServiceTests, InstallRejectsPathTraversalSources)
    {
        TempDirectory temp;
        const std::filesystem::path project = temp.path() / "project";
        const std::filesystem::path package = temp.path() / "package";
        writeTextFile(package / "fomod" / "ModuleConfig.xml", R"xml(
<config>
  <moduleName>Unsafe</moduleName>
  <requiredInstallFiles>
    <file source="../outside.txt" />
  </requiredInstallFiles>
</config>)xml");

        EXPECT_THROW(
            {
                std::vector<std::wstring> ignored = FomodInstallerService::install(FomodInstallContext{
                project,
                temp.path() / "game",
                temp.path() / "mods",
                package,
                temp.path() / "mods" / "Unsafe",
                identity(),
                {}
                });
                (void)ignored;
            },
            std::invalid_argument);
    }

    TEST(FomodInstallerServiceTests, InstallRejectsPathTraversalDestinations)
    {
        TempDirectory temp;
        const std::filesystem::path project = temp.path() / "project";
        const std::filesystem::path package = temp.path() / "package";
        writeTextFile(package / "fomod" / "ModuleConfig.xml", R"xml(
<config>
  <moduleName>Unsafe Destination</moduleName>
  <requiredInstallFiles>
    <file source="safe.txt" destination="../escaped.txt" />
  </requiredInstallFiles>
</config>)xml");
        writeTextFile(package / "safe.txt", "safe");

        EXPECT_THROW(
            {
                std::vector<std::wstring> ignored = FomodInstallerService::install(FomodInstallContext{
                project,
                temp.path() / "game",
                temp.path() / "mods",
                package,
                temp.path() / "mods" / "Unsafe Destination",
                identity(),
                {}
                });
                (void)ignored;
            },
            std::invalid_argument);
    }
}
