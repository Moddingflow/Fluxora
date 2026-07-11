add_executable(FluxoraSyntheticModlistFixture
    SyntheticModlistFixture.cpp
)
target_compile_features(FluxoraSyntheticModlistFixture PRIVATE cxx_std_20)

add_executable(FluxoraLaunchProbe
    FluxoraLaunchProbe.cpp
)
target_compile_features(FluxoraLaunchProbe PRIVATE cxx_std_20)

if(MSVC)
    target_compile_options(FluxoraSyntheticModlistFixture PRIVATE /W4 /permissive- /utf-8)
    target_compile_options(FluxoraLaunchProbe PRIVATE /W4 /permissive- /utf-8)
endif()

add_custom_target(FluxoraPerformanceTools
    DEPENDS
        FluxoraSyntheticModlistFixture
        FluxoraLaunchProbe
        FluxoraBridgeHost
        FluxoraVfs
)

if(BUILD_TESTING)
    find_program(FLUXORA_PERFORMANCE_POWERSHELL_EXECUTABLE NAMES pwsh powershell REQUIRED)
    add_test(
        NAME FluxoraPerformanceFixtureSmoke
        COMMAND "${FLUXORA_PERFORMANCE_POWERSHELL_EXECUTABLE}" -NoProfile -ExecutionPolicy Bypass
            -File "${CMAKE_CURRENT_SOURCE_DIR}/Verify-SyntheticFixture.ps1"
            -FixtureBuilderPath "$<TARGET_FILE:FluxoraSyntheticModlistFixture>"
            -ProbePath "$<TARGET_FILE:FluxoraLaunchProbe>"
            -OutputPath "${CMAKE_CURRENT_BINARY_DIR}/fixture-smoke"
    )
    set_tests_properties(FluxoraPerformanceFixtureSmoke PROPERTIES
        LABELS "performance;smoke"
        TIMEOUT 60
    )

    add_test(
        NAME FluxoraPerformanceHarnessSmoke
        COMMAND "${FLUXORA_PERFORMANCE_POWERSHELL_EXECUTABLE}" -NoProfile -ExecutionPolicy Bypass
            -File "${CMAKE_CURRENT_SOURCE_DIR}/Run-FluxoraPerformance.ps1"
            -HostPath "$<TARGET_FILE:FluxoraBridgeHost>"
            -CorePath "$<TARGET_FILE:FluxoraCore>"
            -VfsPath "$<TARGET_FILE:FluxoraVfs>"
            -FixtureBuilderPath "$<TARGET_FILE:FluxoraSyntheticModlistFixture>"
            -ProbePath "$<TARGET_FILE:FluxoraLaunchProbe>"
            -ResultPath "${CMAKE_CURRENT_BINARY_DIR}/harness-smoke/result.json"
            -WorkRoot "${CMAKE_CURRENT_BINARY_DIR}/harness-smoke/work"
            -ModCounts 12
            -FilesPerMod 8
            -PluginCount 5
            -Runs 2
            -Warmups 1
            -ColdRuns 1
    )
    set_tests_properties(FluxoraPerformanceHarnessSmoke PROPERTIES
        LABELS "performance;smoke"
        TIMEOUT 120
    )

    add_test(
        NAME FluxoraPerformanceResultSchemaSmoke
        COMMAND "${FLUXORA_PERFORMANCE_POWERSHELL_EXECUTABLE}" -NoProfile -ExecutionPolicy Bypass
            -File "${CMAKE_CURRENT_SOURCE_DIR}/Verify-PerformanceResultSchema.ps1"
            -ResultPath "${CMAKE_CURRENT_BINARY_DIR}/harness-smoke/result.json"
    )
    set_tests_properties(FluxoraPerformanceResultSchemaSmoke PROPERTIES
        DEPENDS FluxoraPerformanceHarnessSmoke
        LABELS "performance;smoke"
        TIMEOUT 30
    )

    add_test(
        NAME FluxoraPerformanceParameterBindingSmoke
        COMMAND "${FLUXORA_PERFORMANCE_POWERSHELL_EXECUTABLE}" -NoProfile -ExecutionPolicy Bypass
            -File "${CMAKE_CURRENT_SOURCE_DIR}/Verify-PerformanceParameterBinding.ps1"
            -HarnessPath "${CMAKE_CURRENT_SOURCE_DIR}/Run-FluxoraPerformance.ps1"
            -WorkRoot "${CMAKE_CURRENT_BINARY_DIR}/lock-smoke/work"
    )
    set_tests_properties(FluxoraPerformanceParameterBindingSmoke PROPERTIES
        LABELS "performance;smoke"
        TIMEOUT 30
    )

    add_test(
        NAME FluxoraPerformanceStructuralStatisticsSmoke
        COMMAND "${FLUXORA_PERFORMANCE_POWERSHELL_EXECUTABLE}" -NoProfile -ExecutionPolicy Bypass
            -File "${CMAKE_CURRENT_SOURCE_DIR}/Verify-StructuralStatistics.ps1"
            -FixtureBuilderPath "$<TARGET_FILE:FluxoraSyntheticModlistFixture>"
            -ProbePath "$<TARGET_FILE:FluxoraLaunchProbe>"
            -HarnessPath "${CMAKE_CURRENT_SOURCE_DIR}/Run-FluxoraPerformance.ps1"
            -OutputPath "${CMAKE_CURRENT_BINARY_DIR}/structural-statistics-smoke.json"
            -FixtureDirectory "${CMAKE_CURRENT_BINARY_DIR}/structural-statistics-fixture"
    )
    set_tests_properties(FluxoraPerformanceStructuralStatisticsSmoke PROPERTIES
        LABELS "performance;smoke"
        TIMEOUT 90
    )
endif()
