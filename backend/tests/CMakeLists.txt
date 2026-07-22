include(FetchContent)

find_package(GTest CONFIG QUIET)
if(NOT TARGET GTest::gtest_main)
    set(gtest_force_shared_crt ON CACHE BOOL "" FORCE)
    set(BUILD_GMOCK OFF CACHE BOOL "" FORCE)
    set(INSTALL_GTEST OFF CACHE BOOL "" FORCE)
    FetchContent_Declare(
        googletest
        URL https://github.com/google/googletest/archive/refs/tags/v1.17.0.zip
        DOWNLOAD_EXTRACT_TIMESTAMP TRUE
    )
    FetchContent_MakeAvailable(googletest)
endif()

add_executable(FluxoraCoreTests
    AppSettingsServiceTests.cpp
    AiRollbackCheckpointStoreTests.cpp
    ArchiveCatalogServiceTests.cpp
    AtomicFileStoreTests.cpp
    BodySlideIntegrationServiceTests.cpp
    BuildFileWorkspaceServiceTests.cpp
    BuildPathSettingsServiceTests.cpp
    ContentLayoutServiceTests.cpp
    DownloadServiceTests.cpp
    DownloadTransferLimiterTests.cpp
    EffectiveFileTreeServiceTests.cpp
    ExecutableServiceTests.cpp
    ExternalConnectionServiceTests.cpp
    PgPatcherExecutableServiceTests.cpp
    GameDetectionHealthServiceTests.cpp
    GameDefinitionLoaderTests.cpp
    GameSupportRegistryTests.cpp
    GameTypesTests.cpp
    HookServiceTests.cpp
    InstallConflictPreviewServiceTests.cpp
    InstallSchedulerTests.cpp
    InstallTransactionJournalTests.cpp
    InstanceMetadataStoreTests.cpp
    InverseTextMergeServiceTests.cpp
    JsonSupportTests.cpp
    LaunchDescriptorStoreTests.cpp
    FomodInstallerServiceTests.cpp
    FomodProfileContextServiceTests.cpp
    FomodAutoSelectionServiceTests.cpp
    FluxPackServiceTests.cpp
    GrassCacheServiceTests.cpp
    LoggerTests.cpp
    ModFileOperationsIntegrationTests.cpp
    ModIdentityResolverTests.cpp
    ModUpdateServiceTests.cpp
    NexusDownloadDuplicateResolverTests.cpp
    NexusFileLineageResolverTests.cpp
    ModOrganizerTransferBuildTests.cpp
    ModOrganizerImportServiceTests.cpp
    ModOrganizerPluginGroupServiceTests.cpp
    ModOrganizerProfileOrderServiceTests.cpp
    NexusModsAuthServiceTests.cpp
    OperationCancellationTests.cpp
    PathSafetyServiceTests.cpp
    PluginServiceTests.cpp
    ProjectServiceTests.cpp
    RootBuilderLaunchCacheReconcilerTests.cpp
    ProjectStateTransactionTests.cpp
    ScopedFileCleanupTests.cpp
    TemplateServiceTests.cpp
    VfsMountPlanTests.cpp
    TestFilesystem.hpp
    ../src/Services/AppSettingsService.cpp
    ../src/Services/AiRollbackCheckpointStore.cpp
    ../src/Services/ArchiveCatalogService.cpp
    ../src/Services/BulkFileCopyService.cpp
    ../src/Services/BuildFileDiscoveryService.cpp
    ../src/Services/ConfigRecipeRegistry.cpp
    ../src/Services/BuildFileWorkspaceService.cpp
    ../src/Services/BuildPathSettingsService.cpp
    ../src/Services/BodySlideIntegrationService.cpp
    ../src/Services/ContentLayoutService.cpp
    ../src/GameSupport/DefinitionBackedGameSupport.cpp
    ../src/GameSupport/GameDefinitionLoader.cpp
    ../src/GameSupport/GameDetectionService.cpp
    ../src/GameSupport/GameHealthCheckService.cpp
    ../src/GameSupport/GameSupportRegistry.cpp
    ../src/GameSupport/ProjectFingerprint.cpp
    ../src/GameSupport/SkyrimSpecialEditionSupport.cpp
    ../src/Services/DownloadService.cpp
    ../src/Services/DownloadTransferLimiter.cpp
    ../src/Services/EffectiveFileTreeService.cpp
    ../src/Services/ExecutableIconService.cpp
    ../src/Services/ExecutableService.cpp
    ../src/Services/ExternalConnectionService.cpp
    ../src/Services/FomodInstallerService.cpp
    ../src/Services/FomodProfileContextService.cpp
    ../src/Services/FomodAutoSelectionService.cpp
    ../src/Services/FluxPackPackage.cpp
    ../src/Services/FluxPackService.cpp
    ../src/Services/GrassCacheService.cpp
    ../src/Services/InverseTextMergeService.cpp
    ../src/Services/ManagedAiOverrideService.cpp
    ../src/Services/HookService.cpp
    ../src/Services/InstallConflictPreviewService.cpp
    ../src/Services/InstallOperationService.cpp
    ../src/Services/InstallProjectGate.cpp
    ../src/Services/InstallScheduler.cpp
    ../src/Services/InstallTransactionJournal.cpp
    ../src/Services/Logger.cpp
    ../src/Services/ModOrganizerExecutableImportService.cpp
    ../src/Services/ModOrganizerImportService.cpp
    ../src/Services/ModService.cpp
    ../src/Services/ModUpdateService.cpp
    ../src/Services/NexusDownloadDuplicateResolver.cpp
    ../src/Services/NexusFileLineageResolver.cpp
    ../src/Services/NexusUpdateCache.cpp
    ../src/Services/NexusUpdateHttpApi.cpp
    ../src/Services/ModIdentityResolver.cpp
    ../src/Services/NifPreviewResolver.cpp
    ../src/Services/NexusModsAuthService.cpp
    ../src/Services/ModOrganizerPluginGroupService.cpp
    ../src/Services/ModOrganizerProfileOrderService.cpp
    ../src/Services/PathSafetyService.cpp
    ../src/Services/PluginService.cpp
    ../src/Services/PreviewArchiveReader.cpp
    ../src/Services/ProfileOrderService.cpp
    ../src/Services/ProfileService.cpp
    ../src/Services/ProjectService.cpp
    ../src/Services/RootBuilderLaunchCacheReconciler.cpp
    ../src/Services/TemplateService.cpp
    ../src/Services/VfsMountPlan.cpp
    ../src/Storage/AtomicFileStore.cpp
    ../src/Storage/InstanceMetadataStore.cpp
    ../src/Storage/ProjectStateTransaction.cpp
    ../src/Support/LaunchDescriptorStore.cpp
)

if(WIN32)
    target_sources(FluxoraCoreTests
        PRIVATE
            VfsTreeTests.cpp
            VfsConfigTests.cpp
            VfsEnvironmentTests.cpp
            VfsLifecycleTests.cpp
            ../vfs/src/VfsConfig.cpp
            ../vfs/src/VfsEnvironment.cpp
            ../vfs/src/VfsLifecycle.cpp
            ../vfs/src/VfsLog.cpp
            ../vfs/src/VfsTree.cpp
    )
    target_compile_definitions(FluxoraCoreTests PRIVATE
        FLUXORA_DOWNLOAD_SERVICE_TEST_HOOKS
        FLUXORA_INSTANCE_METADATA_SQL_TEST_HOOKS
        FLUXORA_NEXUS_AUTH_SERVICE_TEST_HOOKS
        FLUXORA_VFS_TEST_HOOKS
    )
endif()

target_include_directories(FluxoraCoreTests
    PRIVATE
        ${CMAKE_CURRENT_SOURCE_DIR}/../include
        ${PROJECT_BINARY_DIR}/generated
)

if(WIN32)
    target_include_directories(FluxoraCoreTests
        PRIVATE
            ${CMAKE_CURRENT_SOURCE_DIR}/../vfs/include
    )
endif()

target_compile_features(FluxoraCoreTests PRIVATE cxx_std_20)

if(MSVC)
    target_compile_options(FluxoraCoreTests PRIVATE /W4 /permissive- /utf-8)
else()
    target_compile_options(FluxoraCoreTests PRIVATE -Wall -Wextra -Wpedantic)
endif()

target_link_libraries(
    FluxoraCoreTests
    PRIVATE
        GTest::gtest_main
        spdlog::spdlog_header_only
        ${FLUXORA_ZLIB_TARGET}
        ${FLUXORA_ZSTD_TARGET})

if(WIN32)
    target_link_libraries(FluxoraCoreTests PRIVATE advapi32 bcrypt crypt32 gdiplus normaliz rstrtmgr shell32 version winhttp ws2_32)
endif()

include(GoogleTest)
gtest_discover_tests(FluxoraCoreTests)

add_executable(FluxoraCoreApiTests
    FluxoraCoreApiTests.cpp
    TestFilesystem.hpp
)

target_include_directories(FluxoraCoreApiTests
    PRIVATE
        ${CMAKE_CURRENT_SOURCE_DIR}/../include
)

target_compile_features(FluxoraCoreApiTests PRIVATE cxx_std_20)

if(MSVC)
    target_compile_options(FluxoraCoreApiTests PRIVATE /W4 /permissive- /utf-8)
else()
    target_compile_options(FluxoraCoreApiTests PRIVATE -Wall -Wextra -Wpedantic)
endif()

target_link_libraries(FluxoraCoreApiTests PRIVATE GTest::gtest_main FluxoraCore)

add_custom_command(
    TARGET FluxoraCoreApiTests
    POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E copy_if_different
        $<TARGET_FILE:FluxoraCore>
        $<TARGET_FILE_DIR:FluxoraCoreApiTests>)

if(WIN32 AND FLUXORA_ENABLE_VFS)
    add_executable(FluxoraBodySlideVfsProbe BodySlideVfsProbe.cpp)
    add_executable(FluxoraUniversalVfsProbe UniversalVfsProbe.cpp)
    target_compile_features(FluxoraBodySlideVfsProbe PRIVATE cxx_std_20)
    target_compile_features(FluxoraUniversalVfsProbe PRIVATE cxx_std_20)
    if(MSVC)
        target_compile_options(FluxoraBodySlideVfsProbe PRIVATE /W4 /permissive- /utf-8)
        target_compile_options(FluxoraUniversalVfsProbe PRIVATE /W4 /permissive- /utf-8)
    endif()
    add_dependencies(FluxoraCoreApiTests FluxoraBodySlideVfsProbe FluxoraUniversalVfsProbe FluxoraVfs)
    add_custom_command(
        TARGET FluxoraCoreApiTests
        POST_BUILD
        COMMAND ${CMAKE_COMMAND} -E copy_if_different
            $<TARGET_FILE:FluxoraBodySlideVfsProbe>
            $<TARGET_FILE_DIR:FluxoraCoreApiTests>
        COMMAND ${CMAKE_COMMAND} -E copy_if_different
            $<TARGET_FILE:FluxoraUniversalVfsProbe>
            $<TARGET_FILE_DIR:FluxoraCoreApiTests>
        COMMAND ${CMAKE_COMMAND} -E copy_if_different
            $<TARGET_FILE:FluxoraVfs>
            $<TARGET_FILE_DIR:FluxoraCoreApiTests>)
endif()

gtest_discover_tests(FluxoraCoreApiTests DISCOVERY_MODE PRE_TEST)

if(WIN32)
    add_executable(FluxoraInstallerCoreTests
        InstallerCorePackageTests.cpp
        TestFilesystem.hpp
    )

    target_include_directories(FluxoraInstallerCoreTests
        PRIVATE
            ${CMAKE_CURRENT_SOURCE_DIR}/../include
    )

    target_compile_features(FluxoraInstallerCoreTests PRIVATE cxx_std_20)

    if(MSVC)
        target_compile_options(FluxoraInstallerCoreTests PRIVATE /W4 /permissive- /utf-8)
    else()
        target_compile_options(FluxoraInstallerCoreTests PRIVATE -Wall -Wextra -Wpedantic)
    endif()

    target_link_libraries(FluxoraInstallerCoreTests PRIVATE
        GTest::gtest_main
        FluxoraInstallerCore
        bcrypt)

    add_custom_command(
        TARGET FluxoraInstallerCoreTests
        POST_BUILD
        COMMAND ${CMAKE_COMMAND} -E copy_if_different
            $<TARGET_FILE:FluxoraInstallerCore>
            $<TARGET_FILE_DIR:FluxoraInstallerCoreTests>)

    gtest_discover_tests(FluxoraInstallerCoreTests DISCOVERY_MODE PRE_TEST)
endif()

if(WIN32)
    find_program(FLUXORA_POWERSHELL_EXECUTABLE NAMES pwsh powershell REQUIRED)

    add_test(
        NAME FluxoraBridgeHostProtocol
        COMMAND "${FLUXORA_POWERSHELL_EXECUTABLE}"
            -NoProfile
            -NonInteractive
            -ExecutionPolicy Bypass
            -File "${CMAKE_CURRENT_SOURCE_DIR}/BridgeHostProtocol.Tests.ps1"
            -HostPath "$<TARGET_FILE:FluxoraBridgeHost>")
    set_tests_properties(FluxoraBridgeHostProtocol PROPERTIES
        LABELS "bridge;smoke"
        TIMEOUT 30)

    add_test(
        NAME FluxoraBuildFilesBridgeProtocol
        COMMAND "${FLUXORA_POWERSHELL_EXECUTABLE}"
            -NoProfile
            -NonInteractive
            -ExecutionPolicy Bypass
            -File "${CMAKE_CURRENT_SOURCE_DIR}/BuildFilesBridgeProtocol.Tests.ps1"
            -HostPath "$<TARGET_FILE:FluxoraBridgeHost>")
    set_tests_properties(FluxoraBuildFilesBridgeProtocol PROPERTIES
        LABELS "bridge;smoke;ai-files"
        PASS_REGULAR_EXPRESSION "Build-files bridge protocol passed"
        TIMEOUT 30)

    add_test(
        NAME FluxoraBridgeHostProtocolTimeout
        COMMAND "${FLUXORA_POWERSHELL_EXECUTABLE}"
            -NoProfile
            -NonInteractive
            -ExecutionPolicy Bypass
            -File "${CMAKE_CURRENT_SOURCE_DIR}/BridgeHostProtocol.Tests.ps1"
            -RunTimeoutProbe
            -ResponseTimeoutMilliseconds 250)
    set_tests_properties(FluxoraBridgeHostProtocolTimeout PROPERTIES
        LABELS "bridge;smoke"
        PASS_REGULAR_EXPRESSION "Bridge host timeout probe passed"
        TIMEOUT 5)
endif()
