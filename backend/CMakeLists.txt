cmake_minimum_required(VERSION 3.20)

project(FluxoraCore VERSION 0.1.0 LANGUAGES CXX)

include(CTest)
include(FetchContent)

# The user-mode virtual file system (the MO2/usvfs-style "mods appear in the game
# folder without being copied" feature) needs an inline-hooking engine. We use
# Microsoft Detours, the same class of library usvfs itself relies on. Turn this
# off (-DFLUXORA_ENABLE_VFS=OFF) to build the core without it; launching then
# behaves like a plain run.
option(FLUXORA_ENABLE_VFS "Build the user-mode virtual file system (requires Microsoft Detours)" ON)

find_package(spdlog CONFIG QUIET)
if(NOT TARGET spdlog::spdlog_header_only)
    FetchContent_Declare(
        spdlog
        GIT_REPOSITORY https://github.com/gabime/spdlog.git
        GIT_TAG        v1.17.0
        GIT_SHALLOW    TRUE
    )
    FetchContent_MakeAvailable(spdlog)
endif()

find_package(ZLIB QUIET)
if(TARGET ZLIB::ZLIB)
    set(FLUXORA_ZLIB_TARGET ZLIB::ZLIB)
else()
    FetchContent_Declare(
        zlib
        GIT_REPOSITORY https://github.com/madler/zlib.git
        GIT_TAG        v1.3.1
        GIT_SHALLOW    TRUE
    )
    FetchContent_MakeAvailable(zlib)
    if(TARGET zlibstatic)
        set(FLUXORA_ZLIB_TARGET zlibstatic)
    elseif(TARGET zlib)
        set(FLUXORA_ZLIB_TARGET zlib)
    else()
        message(FATAL_ERROR "zlib target was not created.")
    endif()
endif()

find_package(zstd CONFIG QUIET)
if(TARGET zstd::libzstd_static)
    set(FLUXORA_ZSTD_TARGET zstd::libzstd_static)
else()
    set(ZSTD_BUILD_PROGRAMS OFF CACHE BOOL "" FORCE)
    set(ZSTD_BUILD_CONTRIB OFF CACHE BOOL "" FORCE)
    set(ZSTD_BUILD_TESTS OFF CACHE BOOL "" FORCE)
    set(ZSTD_BUILD_SHARED OFF CACHE BOOL "" FORCE)
    set(ZSTD_BUILD_STATIC ON CACHE BOOL "" FORCE)
    FetchContent_Declare(
        zstd
        GIT_REPOSITORY https://github.com/facebook/zstd.git
        GIT_TAG        v1.5.7
        GIT_SHALLOW    TRUE
        SOURCE_SUBDIR  build/cmake
    )
    FetchContent_MakeAvailable(zstd)
    if(TARGET libzstd_static)
        set(FLUXORA_ZSTD_TARGET libzstd_static)
    else()
        message(FATAL_ERROR "Static Zstandard target was not created.")
    endif()
endif()

set(FLUXORA_GAME_DEFINITION_DIR "${CMAKE_CURRENT_SOURCE_DIR}/resources/GameDefinitions")
file(GLOB FLUXORA_GAME_DEFINITION_JSON CONFIGURE_DEPENDS "${FLUXORA_GAME_DEFINITION_DIR}/*.json")
if(NOT FLUXORA_GAME_DEFINITION_JSON)
    message(FATAL_ERROR "No game definitions found in '${FLUXORA_GAME_DEFINITION_DIR}'.")
endif()
list(SORT FLUXORA_GAME_DEFINITION_JSON)

set(FLUXORA_GENERATED_INCLUDE_DIR "${CMAKE_CURRENT_BINARY_DIR}/generated")
set(FLUXORA_EMBEDDED_GAME_DEFINITIONS_HEADER
    "${FLUXORA_GENERATED_INCLUDE_DIR}/FluxoraCore/GameSupport/EmbeddedGameDefinitions.hpp")
list(LENGTH FLUXORA_GAME_DEFINITION_JSON FLUXORA_GAME_DEFINITION_COUNT)
file(MAKE_DIRECTORY "${FLUXORA_GENERATED_INCLUDE_DIR}/FluxoraCore/GameSupport")
set(FLUXORA_EMBEDDED_GAME_DEFINITIONS_CONTENT "")
string(APPEND FLUXORA_EMBEDDED_GAME_DEFINITIONS_CONTENT
    "#pragma once\n\n"
    "#include <array>\n"
    "#include <string_view>\n\n"
    "namespace fluxora\n"
    "{\n"
    "    namespace embedded\n"
    "    {\n"
    "        inline constexpr std::array<std::wstring_view, ${FLUXORA_GAME_DEFINITION_COUNT}> gameDefinitionJsonDocuments = {\n")

foreach(definition_file IN LISTS FLUXORA_GAME_DEFINITION_JSON)
    get_filename_component(definition_name "${definition_file}" NAME)
    file(READ "${definition_file}" definition_json)
    string(FIND "${definition_json}" ")FLUXGDJSON" raw_delimiter_position)
    if(NOT raw_delimiter_position EQUAL -1)
        message(FATAL_ERROR
            "Game definition '${definition_name}' contains the embedded raw-string delimiter.")
    endif()

    string(APPEND FLUXORA_EMBEDDED_GAME_DEFINITIONS_CONTENT
        "            LR\"FLUXGDJSON(\n")
    string(APPEND FLUXORA_EMBEDDED_GAME_DEFINITIONS_CONTENT "${definition_json}")
    string(APPEND FLUXORA_EMBEDDED_GAME_DEFINITIONS_CONTENT
        "\n)FLUXGDJSON\", // ${definition_name}\n")
endforeach()

string(APPEND FLUXORA_EMBEDDED_GAME_DEFINITIONS_CONTENT
    "        };\n"
    "    }\n"
    "}\n")

set(FLUXORA_EMBEDDED_GAME_DEFINITIONS_HEADER_TMP
    "${FLUXORA_EMBEDDED_GAME_DEFINITIONS_HEADER}.tmp")
file(WRITE
    "${FLUXORA_EMBEDDED_GAME_DEFINITIONS_HEADER_TMP}"
    "${FLUXORA_EMBEDDED_GAME_DEFINITIONS_CONTENT}")
execute_process(
    COMMAND "${CMAKE_COMMAND}" -E copy_if_different
        "${FLUXORA_EMBEDDED_GAME_DEFINITIONS_HEADER_TMP}"
        "${FLUXORA_EMBEDDED_GAME_DEFINITIONS_HEADER}"
    RESULT_VARIABLE FLUXORA_EMBEDDED_GAME_DEFINITIONS_COPY_RESULT)
file(REMOVE "${FLUXORA_EMBEDDED_GAME_DEFINITIONS_HEADER_TMP}")
if(NOT FLUXORA_EMBEDDED_GAME_DEFINITIONS_COPY_RESULT EQUAL 0)
    message(FATAL_ERROR
        "Failed to update embedded game definitions header "
        "'${FLUXORA_EMBEDDED_GAME_DEFINITIONS_HEADER}'.")
endif()

# --------------------------------------------------------------------------
# FluxoraCore: the C++ core / business logic exposed to the C# UI over a C ABI.
# --------------------------------------------------------------------------
add_library(FluxoraCore SHARED
    src/FluxoraCoreApi.cpp
    src/Core.cpp
    src/Services/AppSettingsService.cpp
    src/Services/BuildPathSettingsService.cpp
    src/Services/BulkFileCopyService.cpp
    src/GameSupport/DefinitionBackedGameSupport.cpp
    src/GameSupport/GameDefinitionLoader.cpp
    src/GameSupport/GameDetectionService.cpp
    src/GameSupport/GameHealthCheckService.cpp
    src/GameSupport/GameSupportRegistry.cpp
    src/GameSupport/ProjectFingerprint.cpp
    src/GameSupport/SkyrimSpecialEditionSupport.cpp
    src/Services/HookService.cpp
    src/Services/ContentLayoutService.cpp
    src/Services/DownloadService.cpp
    src/Services/DownloadTransferLimiter.cpp
    src/Services/EffectiveFileTreeService.cpp
    src/Services/ExecutableIconService.cpp
    src/Services/ExecutableService.cpp
    src/Services/FomodInstallerService.cpp
    src/Services/FluxPackPackage.cpp
    src/Services/FluxPackService.cpp
    src/Services/GrassCacheProcessRunner.cpp
    src/Services/GrassCacheService.cpp
    src/Services/Logger.cpp
    src/Services/ModService.cpp
    src/Services/ModIdentityResolver.cpp
    src/Services/NifPreviewResolver.cpp
    src/Services/ModOrganizerExecutableImportService.cpp
    src/Services/ModOrganizerImportService.cpp
    src/Services/ModOrganizerPluginGroupService.cpp
    src/Services/ModOrganizerProfileOrderService.cpp
    src/Services/NexusModsAuthService.cpp
    src/Services/PathSafetyService.cpp
    src/Services/PluginService.cpp
    src/Services/PreviewArchiveReader.cpp
    src/Services/ProfileOrderService.cpp
    src/Services/ProfileService.cpp
    src/Services/ProjectService.cpp
    src/Services/TemplateService.cpp
    src/Services/VfsContentPlacementAnalyzer.cpp
    src/Services/VfsMountPlan.cpp
    src/Services/VirtualFileSystemService.cpp
    src/Support/LaunchDescriptorStore.cpp
    src/Storage/AtomicFileStore.cpp
    src/Storage/InstanceMetadataStore.cpp
    src/Storage/ProjectStateTransaction.cpp
    vfs/src/VfsEnvironment.cpp
)

target_include_directories(FluxoraCore
    PUBLIC
        ${CMAKE_CURRENT_SOURCE_DIR}/include
    PRIVATE
        ${FLUXORA_GENERATED_INCLUDE_DIR}
        # Shared manager<->hook contract (VfsProtocol.hpp).
        ${CMAKE_CURRENT_SOURCE_DIR}/vfs/include
)

target_compile_features(FluxoraCore PUBLIC cxx_std_20)
target_compile_definitions(FluxoraCore PRIVATE FLUXORA_CORE_EXPORTS)
target_link_libraries(
    FluxoraCore
    PRIVATE
        spdlog::spdlog_header_only
        ${FLUXORA_ZLIB_TARGET}
        ${FLUXORA_ZSTD_TARGET})

if(MSVC)
    # /utf-8 makes MSVC read the UTF-8 sources correctly, so Cyrillic wide-string
    # literals (template display names, capability labels) become proper UTF-16
    # instead of being decoded through the system code page.
    target_compile_options(FluxoraCore PRIVATE /W4 /permissive- /utf-8)
else()
    target_compile_options(FluxoraCore PRIVATE -Wall -Wextra -Wpedantic)
endif()

if(WIN32)
    target_link_libraries(FluxoraCore PRIVATE advapi32 bcrypt crypt32 gdiplus normaliz rstrtmgr shell32 winhttp ws2_32)
endif()

# --------------------------------------------------------------------------
# FluxoraBridgeHost: JSON-RPC stdio host used by the Tauri shell.
# --------------------------------------------------------------------------
add_executable(FluxoraBridgeHost
    src/BridgeHost/FluxoraBridgeHost.cpp
)

target_include_directories(FluxoraBridgeHost
    PRIVATE
        ${CMAKE_CURRENT_SOURCE_DIR}/include
)

target_compile_features(FluxoraBridgeHost PRIVATE cxx_std_20)
target_link_libraries(FluxoraBridgeHost PRIVATE FluxoraCore)

if(MSVC)
    target_compile_options(FluxoraBridgeHost PRIVATE /W4 /permissive- /utf-8)
else()
    target_compile_options(FluxoraBridgeHost PRIVATE -Wall -Wextra -Wpedantic)
endif()

# --------------------------------------------------------------------------
# FluxoraInstallerCore: native installer logic used by the WPF setup UI.
# --------------------------------------------------------------------------
if(WIN32)
    add_library(FluxoraInstallerCore SHARED
        src/Installer/FluxoraInstallerApi.cpp
    )

    target_include_directories(FluxoraInstallerCore
        PUBLIC
            ${CMAKE_CURRENT_SOURCE_DIR}/include
    )

    target_compile_features(FluxoraInstallerCore PUBLIC cxx_std_20)
    target_compile_definitions(FluxoraInstallerCore PRIVATE FLUXORA_INSTALLER_EXPORTS)
    target_link_libraries(FluxoraInstallerCore PRIVATE bcrypt ole32 shell32 spdlog::spdlog_header_only)

    if(MSVC)
        target_compile_options(FluxoraInstallerCore PRIVATE /W4 /permissive- /utf-8)
    else()
        target_compile_options(FluxoraInstallerCore PRIVATE -Wall -Wextra -Wpedantic)
    endif()
endif()

# --------------------------------------------------------------------------
# Virtual file system: Microsoft Detours + the injected FluxoraVfs.dll hook.
# --------------------------------------------------------------------------
if(FLUXORA_ENABLE_VFS AND WIN32)
    # Obtain Detours. Prefer a local copy when offline (-DDETOURS_SOURCE_DIR=...),
    # otherwise fetch the pinned release.
    if(DEFINED DETOURS_SOURCE_DIR)
        set(detours_root "${DETOURS_SOURCE_DIR}")
    else()
        include(FetchContent)
        FetchContent_Declare(
            detours
            GIT_REPOSITORY https://github.com/microsoft/Detours.git
            GIT_TAG        4.0.1
            GIT_SHALLOW    TRUE
        )
        FetchContent_MakeAvailable(detours)
        set(detours_root "${detours_SOURCE_DIR}")
    endif()

    set(detours_src "${detours_root}/src")
    if(NOT EXISTS "${detours_src}/detours.cpp")
        message(FATAL_ERROR
            "Detours sources were not found at '${detours_src}'. "
            "Build with -DFLUXORA_ENABLE_VFS=OFF to skip the virtual file system, "
            "or pass -DDETOURS_SOURCE_DIR=<path to Detours checkout>.")
    endif()

    set(detours_sources
        "${detours_src}/detours.cpp"
        "${detours_src}/modules.cpp"
        "${detours_src}/disasm.cpp"
        "${detours_src}/image.cpp"
        "${detours_src}/creatwth.cpp"
    )

    # Detours is third-party: silence its warnings and build one variant per CRT.
    # FluxoraCore uses the dynamic CRT (status quo); the injected DLL uses the
    # static CRT so it loads into any game without needing the VC++ redistributable.
    add_library(detours_md STATIC ${detours_sources})
    target_include_directories(detours_md PUBLIC "${detours_src}")
    set_property(TARGET detours_md PROPERTY MSVC_RUNTIME_LIBRARY "MultiThreadedDLL")
    if(MSVC)
        target_compile_options(detours_md PRIVATE /w /Gy)
    endif()

    add_library(detours_mt STATIC ${detours_sources})
    target_include_directories(detours_mt PUBLIC "${detours_src}")
    set_property(TARGET detours_mt PROPERTY MSVC_RUNTIME_LIBRARY "MultiThreaded")
    if(MSVC)
        target_compile_options(detours_mt PRIVATE /w /Gy)
    endif()

    # The manager side needs Detours to start the game with the hook injected.
    target_compile_definitions(FluxoraCore PRIVATE FLUXORA_ENABLE_VFS)
    target_include_directories(FluxoraCore PRIVATE "${detours_src}")
    target_link_libraries(FluxoraCore PRIVATE detours_md)

    # The injected hook DLL.
    add_library(FluxoraVfs SHARED
        vfs/src/DllMain.cpp
        vfs/src/VfsConfig.cpp
        vfs/src/VfsHooks.cpp
        vfs/src/VfsLifecycle.cpp
        vfs/src/VfsLog.cpp
        vfs/src/VfsTree.cpp
        # Detours injects this payload by importing ordinal #1 from it, so the DLL
        # MUST export a symbol there or every injected process fails to start. The
        # .def re-exports Detours' DetourFinishHelperProcess at ordinal 1 (MSVC
        # uses a .def among the sources as the module-definition file).
        vfs/FluxoraVfs.def
    )
    target_include_directories(FluxoraVfs PRIVATE
        ${CMAKE_CURRENT_SOURCE_DIR}/vfs/include
        ${CMAKE_CURRENT_SOURCE_DIR}/include   # reuse the header-only JSON reader
        "${detours_src}"
    )
    target_compile_features(FluxoraVfs PRIVATE cxx_std_20)
    set_property(TARGET FluxoraVfs PROPERTY MSVC_RUNTIME_LIBRARY "MultiThreaded")
    target_link_libraries(FluxoraVfs PRIVATE detours_mt)
    if(MSVC)
        target_compile_options(FluxoraVfs PRIVATE /W4 /permissive- /utf-8)
    endif()
endif()

option(FLUXORA_BUILD_TESTS "Build Fluxora C++ unit tests" ${BUILD_TESTING})
if(FLUXORA_BUILD_TESTS)
    add_subdirectory(tests)
endif()

option(FLUXORA_BUILD_BENCHMARKS "Build opt-in Fluxora performance tools" OFF)
if(FLUXORA_BUILD_BENCHMARKS)
    if(NOT WIN32)
        message(FATAL_ERROR "Fluxora performance tools currently require Windows.")
    endif()
    if(NOT CMAKE_SIZEOF_VOID_P EQUAL 8)
        message(FATAL_ERROR "Fluxora performance tools require an x64 build.")
    endif()
    add_subdirectory(performance)
endif()
