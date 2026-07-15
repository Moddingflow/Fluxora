#pragma once

#if defined(_WIN32) && defined(FLUXORA_CORE_EXPORTS)
#define FLUXORA_CORE_API __declspec(dllexport)
#elif defined(_WIN32)
#define FLUXORA_CORE_API __declspec(dllimport)
#else
#define FLUXORA_CORE_API
#endif

#if defined(_MSC_VER)
#define FLUXORA_CORE_CALL __cdecl
#else
#define FLUXORA_CORE_CALL
#endif

extern "C"
{
    typedef void (FLUXORA_CORE_CALL *FluxoraCoreProgressCallback)(const wchar_t* progressJson, void* userData);

    enum FluxoraCoreResult
    {
        FluxoraCoreResultOk = 0,
        FluxoraCoreResultInvalidArgument = 1,
        FluxoraCoreResultBufferTooSmall = 2,
        FluxoraCoreResultCoreError = 3
    };

    FLUXORA_CORE_API int fluxora_core_is_available();

    FLUXORA_CORE_API int fluxora_core_shutdown();

    // Sets a thread-local operation id used by native bridge/core/operation log
    // lines. Passing null or an empty string clears the current context.
    FLUXORA_CORE_API int fluxora_set_operation_context(
        const wchar_t* operationId);

    // Returns the thread-local output length required by the most recent
    // FluxoraCoreResultBufferTooSmall result, including the null terminator.
    FLUXORA_CORE_API int fluxora_get_last_required_buffer_length();

    // Copies the thread-local output buffered by the most recent
    // FluxoraCoreResultBufferTooSmall result. This lets callers resize once
    // without re-running a bridge operation that may have side effects.
    FLUXORA_CORE_API int fluxora_copy_last_output(
        wchar_t* jsonBuffer,
        int jsonBufferLength);

    // Returns a JSON array describing the available game templates that can be
    // layered on top of the base template. Deprecated compatibility fields remain
    // in place while additive game-definition fields include uiTemplateId,
    // gameCapabilities, archiveExtensions and requiredFiles:
    //   [ { "id", "displayName", "gameName", "summary", ... }, ... ]
    FLUXORA_CORE_API int fluxora_get_game_templates(
        wchar_t* jsonBuffer,
        int jsonBufferLength);

    // Returns a JSON object with the fully resolved (base + game) template for a
    // given template id. Deprecated compatibility fields remain in place while
    // the frontend migrates; additive game-definition fields include
    // uiTemplateId, gameCapabilities, archiveExtensions, requiredFiles,
    // contentLayoutSummary, executableDisplayMetadata and launchTrackingMetadata.
    FLUXORA_CORE_API int fluxora_resolve_template(
        const wchar_t* templateId,
        wchar_t* jsonBuffer,
        int jsonBufferLength);

    FLUXORA_CORE_API int fluxora_preview_project_directory(
        const wchar_t* projectName,
        const wchar_t* installRootDirectory,
        wchar_t* projectDirectoryBuffer,
        int projectDirectoryBufferLength);

    FLUXORA_CORE_API int fluxora_create_project(
        const wchar_t* projectName,
        const wchar_t* templateId,
        const wchar_t* gamePath,
        const wchar_t* installRootDirectory,
        wchar_t* jsonBuffer,
        int jsonBufferLength);

    // Returns a JSON array of lightweight build descriptors from a directory of
    // Fluxora build configs. This is intended for the UI catalog and does not
    // fully open or mutate each project instance.
    FLUXORA_CORE_API int fluxora_list_project_configs(
        const wchar_t* buildConfigsDirectory,
        wchar_t* jsonBuffer,
        int jsonBufferLength);

    // Opens an existing build from a Fluxora build config and returns a JSON
    // descriptor:
    //   { "id", "name", "gameName", "gamePath", "installRootDirectory",
    //     "projectDirectory", "configPath", "template": { ...resolved... },
    //     "gameCapabilities", "gameHealthSummary", "projectFingerprint",
    //     "contentLayoutSummary", "uiTemplateId" }
    FLUXORA_CORE_API int fluxora_open_project_config(
        const wchar_t* configPath,
        wchar_t* jsonBuffer,
        int jsonBufferLength);

    FLUXORA_CORE_API int fluxora_rename_project(
        const wchar_t* configPath,
        const wchar_t* newName,
        wchar_t* jsonBuffer,
        int jsonBufferLength);

    FLUXORA_CORE_API int fluxora_delete_project(
        const wchar_t* configPath);

    FLUXORA_CORE_API int fluxora_delete_project_with_progress(
        const wchar_t* configPath,
        FluxoraCoreProgressCallback progressCallback,
        void* progressUserData);

    FLUXORA_CORE_API int fluxora_get_build_path_settings(
        const wchar_t* configPath,
        wchar_t* jsonBuffer,
        int jsonBufferLength);

    // settingsJson is:
    //   { "gameDirectory", "modsDirectory", "profilesDirectory",
    //     "downloadsDirectory", "overwriteDirectory" }
    FLUXORA_CORE_API int fluxora_save_build_path_settings(
        const wchar_t* configPath,
        const wchar_t* settingsJson,
        wchar_t* jsonBuffer,
        int jsonBufferLength);

    // Writes a FluxPack v3 content store with FastCDC-style chunking, SHA-256
    // content addressing and adaptive maximum-level Zstandard compression.
    // Legacy entry points export a recipe package.
    FLUXORA_CORE_API int fluxora_export_fluxpack(
        const wchar_t* configPath,
        const wchar_t* outputPath,
        int includeGeneratedAssets,
        wchar_t* jsonBuffer,
        int jsonBufferLength);

    FLUXORA_CORE_API int fluxora_export_fluxpack_with_progress(
        const wchar_t* configPath,
        const wchar_t* outputPath,
        int includeGeneratedAssets,
        FluxoraCoreProgressCallback progressCallback,
        void* progressUserData,
        wchar_t* jsonBuffer,
        int jsonBufferLength);

    // packageType: 1 = full/autonomous, 2 = recipe/source-backed.
    FLUXORA_CORE_API int fluxora_export_fluxpack_with_options_and_progress(
        const wchar_t* configPath,
        const wchar_t* outputPath,
        int includeGeneratedAssets,
        int packageType,
        FluxoraCoreProgressCallback progressCallback,
        void* progressUserData,
        wchar_t* jsonBuffer,
        int jsonBufferLength);

    // Reads a full or recipe FluxPack and returns a lightweight install summary.
    FLUXORA_CORE_API int fluxora_inspect_fluxpack(
        const wchar_t* fluxPackPath,
        wchar_t* jsonBuffer,
        int jsonBufferLength);

    // Returns the source acquisition plan for a new or in-place install.
    // Premium Nexus sources may be automatic; free-account sources are marked
    // for manual selection while reusable mods and archives remain local.
    FLUXORA_CORE_API int fluxora_plan_fluxpack_install(
        const wchar_t* fluxPackPath,
        const wchar_t* existingConfigPath,
        wchar_t* jsonBuffer,
        int jsonBufferLength);

    // Creates a Fluxora build from a FluxPack. Recipe packages acquire referenced
    // sources; full packages restore bundled content without network downloads.
    //   { "configPath", "projectDirectory", "buildName", source counters, ... }
    FLUXORA_CORE_API int fluxora_install_fluxpack(
        const wchar_t* fluxPackPath,
        const wchar_t* installRootDirectory,
        FluxoraCoreProgressCallback progressCallback,
        void* progressUserData,
        wchar_t* jsonBuffer,
        int jsonBufferLength);

    // Installs into an existing Fluxora build when existingConfigPath is set.
    // Matching source mods, cached downloads and payload files are reused.
    FLUXORA_CORE_API int fluxora_install_fluxpack_with_target(
        const wchar_t* fluxPackPath,
        const wchar_t* installRootDirectory,
        const wchar_t* existingConfigPath,
        FluxoraCoreProgressCallback progressCallback,
        void* progressUserData,
        wchar_t* jsonBuffer,
        int jsonBufferLength);

    // Additive install entry for user-selected source archives. The two JSON
    // arrays are parallel arrays of plan source ids and local archive paths.
    FLUXORA_CORE_API int fluxora_install_fluxpack_with_options_and_progress(
        const wchar_t* fluxPackPath,
        const wchar_t* installRootDirectory,
        const wchar_t* existingConfigPath,
        const wchar_t* manualSourceIdsJson,
        const wchar_t* manualSourcePathsJson,
        FluxoraCoreProgressCallback progressCallback,
        void* progressUserData,
        wchar_t* jsonBuffer,
        int jsonBufferLength);

    FLUXORA_CORE_API int fluxora_analyze_mod_organizer_instance(
        const wchar_t* sourceDirectory,
        const wchar_t* destinationRootDirectory,
        const wchar_t* existingConfigPath,
        wchar_t* jsonBuffer,
        int jsonBufferLength);

    FLUXORA_CORE_API int fluxora_import_mod_organizer_instance(
        const wchar_t* sourceDirectory,
        const wchar_t* destinationRootDirectory,
        const wchar_t* existingConfigPath,
        int replaceExisting,
        FluxoraCoreProgressCallback progressCallback,
        void* progressUserData,
        wchar_t* jsonBuffer,
        int jsonBufferLength);

    FLUXORA_CORE_API int fluxora_get_game_executables(
        const wchar_t* configPath,
        wchar_t* jsonBuffer,
        int jsonBufferLength);

    // executablesJson is a JSON array:
    //   [ { "id", "displayName", "executablePath", "arguments",
    //       "workingDirectory" }, ... ]
    FLUXORA_CORE_API int fluxora_save_game_executables(
        const wchar_t* configPath,
        const wchar_t* executablesJson,
        wchar_t* jsonBuffer,
        int jsonBufferLength);

    FLUXORA_CORE_API int fluxora_launch_game_executable(
        const wchar_t* configPath,
        const wchar_t* executableId,
        const wchar_t* profileName,
        wchar_t* jsonBuffer,
        int jsonBufferLength);

    FLUXORA_CORE_API int fluxora_get_executable_icon(
        const wchar_t* executablePath,
        wchar_t* iconPathBuffer,
        int iconPathBufferLength);

    // Returns:
    //   { "isConfigured", "isLinked", "hasApiKey", "isPremium", "displayName", "userId", "message",
    //     "clientId", "redirectUri" }
    FLUXORA_CORE_API int fluxora_get_nexusmods_auth_status(
        wchar_t* jsonBuffer,
        int jsonBufferLength);

    // Trusted native-only helper for Fluxora-owned background services. The
    // returned JSON contains the current Nexus API HTTP auth header and must not
    // be exposed through renderer-facing DTOs or logs.
    FLUXORA_CORE_API int fluxora_get_nexusmods_api_auth_header(
        wchar_t* jsonBuffer,
        int jsonBufferLength);

    // Returns a renderer-safe API quota snapshot:
    //   { "generatedAtUtc", "providers": [
    //       { "id", "label", "state", "message", "updatedAtUtc", "windows": [
    //           { "id", "label", "period", "limit", "remaining", "resetAtUtc", "resetRaw" }
    //       ] }
    //     ] }
    FLUXORA_CORE_API int fluxora_get_api_limit_status(
        wchar_t* jsonBuffer,
        int jsonBufferLength);

    // Starts the official Nexus Mods OAuth2 Authorization Code + PKCE flow for
    // public desktop applications. The core opens the system browser, listens
    // for the registered localhost callback, exchanges the code for tokens, and
    // stores the protected binding in app settings.
    FLUXORA_CORE_API int fluxora_connect_nexusmods(
        wchar_t* jsonBuffer,
        int jsonBufferLength);

    FLUXORA_CORE_API int fluxora_connect_nexusmods_with_api_key(
        const wchar_t* apiKey,
        wchar_t* jsonBuffer,
        int jsonBufferLength);

    FLUXORA_CORE_API int fluxora_disconnect_nexusmods(
        wchar_t* jsonBuffer,
        int jsonBufferLength);

    FLUXORA_CORE_API int fluxora_get_app_language(
        wchar_t* languageBuffer,
        int languageBufferLength);

    FLUXORA_CORE_API int fluxora_set_app_language(
        const wchar_t* languageCode);

    FLUXORA_CORE_API int fluxora_get_app_theme(
        wchar_t* themeBuffer,
        int themeBufferLength);

    FLUXORA_CORE_API int fluxora_set_app_theme(
        const wchar_t* themeMode);

    // Registers Fluxora as the current-user handler for nxm:// Mod Manager
    // download links. The previous command is preserved in the user registry.
    FLUXORA_CORE_API int fluxora_register_nxm_protocol(
        const wchar_t* executablePath,
        wchar_t* jsonBuffer,
        int jsonBufferLength);

    FLUXORA_CORE_API int fluxora_get_installed_mods(
        const wchar_t* projectDirectory,
        wchar_t* jsonBuffer,
        int jsonBufferLength);

    FLUXORA_CORE_API int fluxora_get_profiles(
        const wchar_t* projectDirectory,
        const wchar_t* defaultProfileName,
        wchar_t* jsonBuffer,
        int jsonBufferLength);

    FLUXORA_CORE_API int fluxora_preview_profile_text_file(
        const wchar_t* projectDirectory,
        const wchar_t* profileName,
        const wchar_t* fileName,
        int maxBytes,
        wchar_t* jsonBuffer,
        int jsonBufferLength);

    FLUXORA_CORE_API int fluxora_create_profile(
        const wchar_t* projectDirectory,
        const wchar_t* profileName,
        const wchar_t* defaultProfileName,
        const wchar_t* profileFilesJson,
        wchar_t* jsonBuffer,
        int jsonBufferLength);

    FLUXORA_CORE_API int fluxora_clone_profile(
        const wchar_t* projectDirectory,
        const wchar_t* sourceProfileName,
        const wchar_t* targetProfileName,
        const wchar_t* defaultProfileName,
        wchar_t* jsonBuffer,
        int jsonBufferLength);

    FLUXORA_CORE_API int fluxora_rename_profile(
        const wchar_t* projectDirectory,
        const wchar_t* sourceProfileName,
        const wchar_t* targetProfileName,
        const wchar_t* defaultProfileName,
        wchar_t* jsonBuffer,
        int jsonBufferLength);

    FLUXORA_CORE_API int fluxora_delete_profile(
        const wchar_t* projectDirectory,
        const wchar_t* profileName,
        const wchar_t* defaultProfileName,
        wchar_t* jsonBuffer,
        int jsonBufferLength);

    FLUXORA_CORE_API int fluxora_get_mod_order(
        const wchar_t* projectDirectory,
        const wchar_t* profileName,
        wchar_t* jsonBuffer,
        int jsonBufferLength);

    FLUXORA_CORE_API int fluxora_get_mod_workspace(
        const wchar_t* projectDirectory,
        const wchar_t* profileName,
        wchar_t* jsonBuffer,
        int jsonBufferLength);

    FLUXORA_CORE_API int fluxora_get_persisted_mod_workspace(
        const wchar_t* projectDirectory,
        const wchar_t* profileName,
        wchar_t* jsonBuffer,
        int jsonBufferLength);

    FLUXORA_CORE_API int fluxora_invalidate_mod_file_caches(
        const wchar_t* projectDirectory,
        const wchar_t* changedPathsJson,
        wchar_t* jsonBuffer,
        int jsonBufferLength);

    FLUXORA_CORE_API int fluxora_create_mod_separator(
        const wchar_t* projectDirectory,
        const wchar_t* profileName,
        const wchar_t* title,
        int targetIndex,
        wchar_t* jsonBuffer,
        int jsonBufferLength);

    FLUXORA_CORE_API int fluxora_delete_mod_separator(
        const wchar_t* projectDirectory,
        const wchar_t* profileName,
        const wchar_t* separatorId,
        wchar_t* jsonBuffer,
        int jsonBufferLength);

    FLUXORA_CORE_API int fluxora_move_mod_order_item(
        const wchar_t* projectDirectory,
        const wchar_t* profileName,
        const wchar_t* orderItemId,
        int targetIndex,
        wchar_t* jsonBuffer,
        int jsonBufferLength);

    FLUXORA_CORE_API int fluxora_delete_installed_mod(
        const wchar_t* projectDirectory,
        const wchar_t* modPath);

    FLUXORA_CORE_API int fluxora_create_empty_mod(
        const wchar_t* projectDirectory,
        const wchar_t* modName,
        wchar_t* jsonBuffer,
        int jsonBufferLength);

    FLUXORA_CORE_API int fluxora_set_installed_mod_enabled(
        const wchar_t* projectDirectory,
        const wchar_t* modPath,
        int isEnabled);

    FLUXORA_CORE_API int fluxora_set_all_installed_mods_enabled(
        const wchar_t* projectDirectory,
        int isEnabled);

    FLUXORA_CORE_API int fluxora_clear_overwrite_folder(
        const wchar_t* projectDirectory);

    FLUXORA_CORE_API int fluxora_generate_ngio_grass_cache(
        const wchar_t* configPath,
        const wchar_t* profileName,
        FluxoraCoreProgressCallback progressCallback,
        void* progressUserData,
        wchar_t* jsonBuffer,
        int jsonBufferLength);

    FLUXORA_CORE_API int fluxora_check_mod_updates(
        const wchar_t* projectDirectory,
        wchar_t* jsonBuffer,
        int jsonBufferLength);

    FLUXORA_CORE_API int fluxora_get_mod_file_tree(
        const wchar_t* projectDirectory,
        const wchar_t* modPath,
        const wchar_t* relativeDirectory,
        wchar_t* jsonBuffer,
        int jsonBufferLength);

    FLUXORA_CORE_API int fluxora_get_mod_details_content(
        const wchar_t* projectDirectory,
        const wchar_t* modPath,
        wchar_t* jsonBuffer,
        int jsonBufferLength);

    FLUXORA_CORE_API int fluxora_get_mod_conflict_tree(
        const wchar_t* projectDirectory,
        const wchar_t* modPath,
        const wchar_t* cursor,
        int limit,
        wchar_t* jsonBuffer,
        int jsonBufferLength);

    FLUXORA_CORE_API int fluxora_get_mod_details_summary(
        const wchar_t* projectDirectory,
        const wchar_t* profileName,
        const wchar_t* modPath,
        wchar_t* jsonBuffer,
        int jsonBufferLength);

    FLUXORA_CORE_API int fluxora_prepare_workspace_indexes(
        const wchar_t* projectDirectory,
        const wchar_t* profileName,
        wchar_t* jsonBuffer,
        int jsonBufferLength);

    FLUXORA_CORE_API int fluxora_get_effective_file_tree(
        const wchar_t* projectDirectory,
        const wchar_t* profileName,
        wchar_t* jsonBuffer,
        int jsonBufferLength);

    FLUXORA_CORE_API int fluxora_get_effective_file_tree_root(
        const wchar_t* projectDirectory,
        const wchar_t* profileName,
        int limit,
        wchar_t* jsonBuffer,
        int jsonBufferLength);

    FLUXORA_CORE_API int fluxora_get_effective_file_tree_children(
        const wchar_t* projectDirectory,
        const wchar_t* profileName,
        const wchar_t* revision,
        const wchar_t* relativeDirectory,
        const wchar_t* cursor,
        int limit,
        wchar_t* jsonBuffer,
        int jsonBufferLength);

    FLUXORA_CORE_API int fluxora_start_nif_preview(
        const wchar_t* projectDirectory,
        const wchar_t* profileName,
        const wchar_t* initialModPath,
        const wchar_t* relativePath,
        wchar_t* jsonBuffer,
        int jsonBufferLength);

    FLUXORA_CORE_API int fluxora_prepare_nif_preview_variant(
        const wchar_t* projectDirectory,
        const wchar_t* modPath,
        const wchar_t* relativePath,
        wchar_t* jsonBuffer,
        int jsonBufferLength);

    FLUXORA_CORE_API int fluxora_prepare_nif_preview_textures(
        const wchar_t* projectDirectory,
        const wchar_t* profileName,
        const wchar_t* modelModPath,
        const wchar_t* texturePathsJson,
        wchar_t* jsonBuffer,
        int jsonBufferLength);

    FLUXORA_CORE_API int fluxora_read_mod_text_file(
        const wchar_t* projectDirectory,
        const wchar_t* modPath,
        const wchar_t* relativePath,
        wchar_t* jsonBuffer,
        int jsonBufferLength);

    FLUXORA_CORE_API int fluxora_preview_mod_text_file(
        const wchar_t* projectDirectory,
        const wchar_t* modPath,
        const wchar_t* relativePath,
        int maxBytes,
        wchar_t* jsonBuffer,
        int jsonBufferLength);

    FLUXORA_CORE_API int fluxora_save_mod_text_file(
        const wchar_t* projectDirectory,
        const wchar_t* modPath,
        const wchar_t* relativePath,
        const wchar_t* content,
        wchar_t* jsonBuffer,
        int jsonBufferLength);

    FLUXORA_CORE_API int fluxora_read_text_file(
        const wchar_t* filePath,
        wchar_t* jsonBuffer,
        int jsonBufferLength);

    FLUXORA_CORE_API int fluxora_save_text_file(
        const wchar_t* filePath,
        const wchar_t* content,
        wchar_t* jsonBuffer,
        int jsonBufferLength);

    FLUXORA_CORE_API int fluxora_get_plugins(
        const wchar_t* projectDirectory,
        const wchar_t* templateId,
        const wchar_t* profileName,
        wchar_t* jsonBuffer,
        int jsonBufferLength);

    FLUXORA_CORE_API int fluxora_get_persisted_plugins(
        const wchar_t* projectDirectory,
        const wchar_t* templateId,
        const wchar_t* profileName,
        wchar_t* jsonBuffer,
        int jsonBufferLength);

    FLUXORA_CORE_API int fluxora_move_plugin(
        const wchar_t* projectDirectory,
        const wchar_t* templateId,
        const wchar_t* profileName,
        const wchar_t* orderItemId,
        int targetIndex,
        wchar_t* jsonBuffer,
        int jsonBufferLength);

    FLUXORA_CORE_API int fluxora_create_plugin_separator(
        const wchar_t* projectDirectory,
        const wchar_t* templateId,
        const wchar_t* profileName,
        const wchar_t* title,
        int targetIndex,
        wchar_t* jsonBuffer,
        int jsonBufferLength);

    FLUXORA_CORE_API int fluxora_delete_plugin_separator(
        const wchar_t* projectDirectory,
        const wchar_t* templateId,
        const wchar_t* profileName,
        const wchar_t* separatorId,
        wchar_t* jsonBuffer,
        int jsonBufferLength);

    FLUXORA_CORE_API int fluxora_set_plugin_enabled(
        const wchar_t* projectDirectory,
        const wchar_t* templateId,
        const wchar_t* profileName,
        const wchar_t* pluginName,
        int isEnabled,
        wchar_t* jsonBuffer,
        int jsonBufferLength);

    FLUXORA_CORE_API int fluxora_set_all_plugins_enabled(
        const wchar_t* projectDirectory,
        const wchar_t* templateId,
        const wchar_t* profileName,
        int isEnabled,
        wchar_t* jsonBuffer,
        int jsonBufferLength);

    FLUXORA_CORE_API int fluxora_get_downloads(
        const wchar_t* projectDirectory,
        wchar_t* jsonBuffer,
        int jsonBufferLength);

    // nxmLinksJson is a JSON string array: [ "nxm://...", ... ]. Passing an
    // empty project directory stores links in Fluxora's inbound download queue.
    FLUXORA_CORE_API int fluxora_capture_nxm_links(
        const wchar_t* projectDirectory,
        const wchar_t* nxmLinksJson,
        wchar_t* jsonBuffer,
        int jsonBufferLength);

    FLUXORA_CORE_API int fluxora_import_inbound_downloads(
        const wchar_t* projectDirectory,
        wchar_t* jsonBuffer,
        int jsonBufferLength);

    FLUXORA_CORE_API int fluxora_import_download_file(
        const wchar_t* projectDirectory,
        const wchar_t* sourcePath,
        wchar_t* jsonBuffer,
        int jsonBufferLength);

    FLUXORA_CORE_API int fluxora_delete_download(
        const wchar_t* projectDirectory,
        const wchar_t* downloadPath);

    FLUXORA_CORE_API int fluxora_cancel_download(
        const wchar_t* projectDirectory,
        const wchar_t* downloadPath);

    FLUXORA_CORE_API int fluxora_resume_download(
        const wchar_t* projectDirectory,
        const wchar_t* downloadPath,
        wchar_t* jsonBuffer,
        int jsonBufferLength);

    // Returns a FluxoraInstallPlan. The plan is short lived and must be supplied
    // to one of the planned install exports below.
    FLUXORA_CORE_API int fluxora_plan_download_install(
        const wchar_t* projectDirectory,
        const wchar_t* downloadPath,
        wchar_t* jsonBuffer,
        int jsonBufferLength);

    FLUXORA_CORE_API int fluxora_plan_archive_install(
        const wchar_t* projectDirectory,
        const wchar_t* archivePath,
        wchar_t* jsonBuffer,
        int jsonBufferLength);

    FLUXORA_CORE_API int fluxora_install_download(
        const wchar_t* projectDirectory,
        const wchar_t* downloadPath,
        const wchar_t* modName,
        wchar_t* jsonBuffer,
        int jsonBufferLength);

    // existingModMode: 0 = fail if a mod with the same folder name exists,
    // 1 = replace the existing mod folder, 2 = merge into it and overwrite
    // files with the same relative path.
    FLUXORA_CORE_API int fluxora_install_download_with_mode(
        const wchar_t* projectDirectory,
        const wchar_t* downloadPath,
        const wchar_t* modName,
        int existingModMode,
        wchar_t* jsonBuffer,
        int jsonBufferLength);

    // placementOverridesJson is a JSON array of objects:
    // { "sourcePath": "archive/file.ext", "target": "data|gameRoot", "targetRelativePath": "folder/file.ext" }.
    FLUXORA_CORE_API int fluxora_install_download_with_layout(
        const wchar_t* projectDirectory,
        const wchar_t* downloadPath,
        const wchar_t* modName,
        int existingModMode,
        const wchar_t* placementOverridesJson,
        wchar_t* jsonBuffer,
        int jsonBufferLength);

    // identityDecision: 0 = use matched target, 1 = install as another mod.
    // newNamePolicy: 0 = first free "Name (N)" suffix.
    FLUXORA_CORE_API int fluxora_install_download_planned(
        const wchar_t* projectDirectory,
        const wchar_t* downloadPath,
        const wchar_t* modName,
        int existingModMode,
        const wchar_t* placementOverridesJson,
        const wchar_t* resolutionId,
        int identityDecision,
        const wchar_t* targetModUuid,
        int newNamePolicy,
        wchar_t* jsonBuffer,
        int jsonBufferLength);

    FLUXORA_CORE_API int fluxora_install_archive_with_mode(
        const wchar_t* projectDirectory,
        const wchar_t* archivePath,
        const wchar_t* modName,
        int existingModMode,
        wchar_t* jsonBuffer,
        int jsonBufferLength);

    FLUXORA_CORE_API int fluxora_install_archive_with_layout(
        const wchar_t* projectDirectory,
        const wchar_t* archivePath,
        const wchar_t* modName,
        int existingModMode,
        const wchar_t* placementOverridesJson,
        wchar_t* jsonBuffer,
        int jsonBufferLength);

    FLUXORA_CORE_API int fluxora_install_archive_planned(
        const wchar_t* projectDirectory,
        const wchar_t* archivePath,
        const wchar_t* modName,
        int existingModMode,
        const wchar_t* placementOverridesJson,
        const wchar_t* resolutionId,
        int identityDecision,
        const wchar_t* targetModUuid,
        int newNamePolicy,
        wchar_t* jsonBuffer,
        int jsonBufferLength);

    // Returns a JSON placement plan for a regular archive using the selected
    // project's content layout rules. existingModMode has the same values as
    // fluxora_install_download_with_mode.
    FLUXORA_CORE_API int fluxora_analyze_download_content_layout(
        const wchar_t* projectDirectory,
        const wchar_t* downloadPath,
        int existingModMode,
        wchar_t* jsonBuffer,
        int jsonBufferLength);

    // Returns a JSON descriptor for an XML FOMOD installer in the archive, or
    // { "isFomod": false } when the download is a regular archive.
    FLUXORA_CORE_API int fluxora_analyze_fomod_download(
        const wchar_t* projectDirectory,
        const wchar_t* downloadPath,
        wchar_t* jsonBuffer,
        int jsonBufferLength);

    // selectedOptionIdsJson is a JSON string array of option ids returned by
    // fluxora_analyze_fomod_download.
    FLUXORA_CORE_API int fluxora_install_fomod_download_with_mode(
        const wchar_t* projectDirectory,
        const wchar_t* downloadPath,
        const wchar_t* modName,
        int existingModMode,
        const wchar_t* selectedOptionIdsJson,
        wchar_t* jsonBuffer,
        int jsonBufferLength);

    FLUXORA_CORE_API int fluxora_install_fomod_download_with_layout(
        const wchar_t* projectDirectory,
        const wchar_t* downloadPath,
        const wchar_t* modName,
        int existingModMode,
        const wchar_t* selectedOptionIdsJson,
        const wchar_t* placementOverridesJson,
        wchar_t* jsonBuffer,
        int jsonBufferLength);

    FLUXORA_CORE_API int fluxora_install_fomod_archive_with_mode(
        const wchar_t* projectDirectory,
        const wchar_t* archivePath,
        const wchar_t* modName,
        int existingModMode,
        const wchar_t* selectedOptionIdsJson,
        wchar_t* jsonBuffer,
        int jsonBufferLength);

    FLUXORA_CORE_API int fluxora_install_fomod_archive_with_layout(
        const wchar_t* projectDirectory,
        const wchar_t* archivePath,
        const wchar_t* modName,
        int existingModMode,
        const wchar_t* selectedOptionIdsJson,
        const wchar_t* placementOverridesJson,
        wchar_t* jsonBuffer,
        int jsonBufferLength);

    FLUXORA_CORE_API int fluxora_install_fomod_download_planned(
        const wchar_t* projectDirectory,
        const wchar_t* downloadPath,
        const wchar_t* modName,
        int existingModMode,
        const wchar_t* selectedOptionIdsJson,
        const wchar_t* placementOverridesJson,
        const wchar_t* resolutionId,
        int identityDecision,
        const wchar_t* targetModUuid,
        int newNamePolicy,
        wchar_t* jsonBuffer,
        int jsonBufferLength);

    FLUXORA_CORE_API int fluxora_install_fomod_archive_planned(
        const wchar_t* projectDirectory,
        const wchar_t* archivePath,
        const wchar_t* modName,
        int existingModMode,
        const wchar_t* selectedOptionIdsJson,
        const wchar_t* placementOverridesJson,
        const wchar_t* resolutionId,
        int identityDecision,
        const wchar_t* targetModUuid,
        int newNamePolicy,
        wchar_t* jsonBuffer,
        int jsonBufferLength);

    // Returns a JSON placement plan for selected FOMOD options without
    // registering or installing a mod.
    FLUXORA_CORE_API int fluxora_analyze_fomod_download_content_layout(
        const wchar_t* projectDirectory,
        const wchar_t* downloadPath,
        int existingModMode,
        const wchar_t* selectedOptionIdsJson,
        wchar_t* jsonBuffer,
        int jsonBufferLength);

    FLUXORA_CORE_API int fluxora_get_last_error(
        wchar_t* messageBuffer,
        int messageBufferLength);
}
