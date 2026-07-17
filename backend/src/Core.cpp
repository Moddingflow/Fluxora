#include "FluxoraCore/Core.hpp"

#include "FluxoraCore/Services/AppSettingsService.hpp"
#include "FluxoraCore/Services/BuildPathSettingsService.hpp"
#include "FluxoraCore/Services/DownloadService.hpp"
#include "FluxoraCore/Services/DownloadTransferLimiter.hpp"
#include "FluxoraCore/Services/EffectiveFileTreeService.hpp"
#include "FluxoraCore/Services/ExecutableIconService.hpp"
#include "FluxoraCore/Services/ExecutableService.hpp"
#include "FluxoraCore/Services/FluxPackService.hpp"
#include "FluxoraCore/Services/GrassCacheService.hpp"
#include "FluxoraCore/Services/HookService.hpp"
#include "FluxoraCore/Services/Logger.hpp"
#include "FluxoraCore/Services/ModService.hpp"
#include "FluxoraCore/Services/ModUpdateService.hpp"
#include "FluxoraCore/Services/ModOrganizerImportService.hpp"
#include "FluxoraCore/Services/NexusModsAuthService.hpp"
#include "FluxoraCore/Services/PluginService.hpp"
#include "FluxoraCore/Services/ProfileOrderService.hpp"
#include "FluxoraCore/Services/ProfileService.hpp"
#include "FluxoraCore/Services/ProjectService.hpp"
#include "FluxoraCore/Services/TemplateService.hpp"
#include "FluxoraCore/Services/VirtualFileSystemService.hpp"

namespace fluxora
{
    Core::Core()
        : logger_(std::make_unique<Logger>()),
          settings_(std::make_unique<AppSettingsService>(*logger_)),
          buildPathSettings_(std::make_unique<BuildPathSettingsService>(*logger_)),
          hooks_(std::make_unique<HookService>(*logger_)),
          mods_(std::make_unique<ModService>(*logger_, *buildPathSettings_)),
          plugins_(std::make_unique<PluginService>(*logger_, *buildPathSettings_)),
          profileOrder_(std::make_unique<ProfileOrderService>(*logger_, *mods_, *buildPathSettings_)),
          profiles_(std::make_unique<ProfileService>(*logger_, *buildPathSettings_)),
          nexusModsAuth_(std::make_unique<NexusModsAuthService>(*logger_, *settings_)),
          nexusUpdateApi_(createNexusUpdateApi(*logger_, *nexusModsAuth_)),
          downloadTransferLimiter_(std::make_unique<DownloadTransferLimiter>()),
          downloads_(std::make_unique<DownloadService>(
              *logger_,
              *settings_,
              *buildPathSettings_,
              *downloadTransferLimiter_,
              *nexusModsAuth_)),
          effectiveFileTree_(std::make_unique<EffectiveFileTreeService>(*logger_, *profileOrder_, *buildPathSettings_)),
          executableIcons_(std::make_unique<ExecutableIconService>(*logger_)),
          executables_(std::make_unique<ExecutableService>(*logger_, *executableIcons_, *buildPathSettings_)),
          templates_(std::make_unique<TemplateService>(*logger_)),
          projects_(std::make_unique<ProjectService>(*logger_, *templates_)),
          fluxPacks_(std::make_unique<FluxPackService>(*logger_, *projects_, *downloads_, *buildPathSettings_)),
          modOrganizerImport_(std::make_unique<ModOrganizerImportService>(*logger_, *templates_, *projects_, *buildPathSettings_)),
          virtualFileSystem_(std::make_unique<VirtualFileSystemService>(*logger_, *executables_, *buildPathSettings_)),
          grassCache_(std::make_unique<GrassCacheService>(
              *logger_,
              *projects_,
              *executables_,
              *virtualFileSystem_,
              *mods_,
              *profileOrder_,
              *buildPathSettings_))
    {
    }

    Core::~Core()
    {
        shutdown();
    }

    void Core::initialize()
    {
        if (initialized_)
        {
            return;
        }

        logger_->initialize();
        settings_->initialize();
        buildPathSettings_->initialize();
        hooks_->initialize();
        mods_->initialize();
        plugins_->initialize();
        profileOrder_->initialize();
        profiles_->initialize();
        nexusModsAuth_->initialize();
        downloads_->initialize();
        effectiveFileTree_->initialize();
        executableIcons_->initialize();
        executables_->initialize();
        templates_->initialize();
        projects_->initialize();
        fluxPacks_->initialize();
        modOrganizerImport_->initialize();
        virtualFileSystem_->initialize();
        grassCache_->initialize();

        initialized_ = true;
        logger_->write(LogLevel::Info, "Fluxora core initialized.");
    }

    void Core::shutdown()
    {
        if (!initialized_)
        {
            return;
        }

        grassCache_->shutdown();
        virtualFileSystem_->shutdown();
        modOrganizerImport_->shutdown();
        fluxPacks_->shutdown();
        projects_->shutdown();
        templates_->shutdown();
        executables_->shutdown();
        executableIcons_->shutdown();
        effectiveFileTree_->shutdown();
        downloads_->shutdown();
        nexusModsAuth_->shutdown();
        profiles_->shutdown();
        profileOrder_->shutdown();
        plugins_->shutdown();
        mods_->shutdown();
        hooks_->shutdown();
        settings_->shutdown();
        buildPathSettings_->shutdown();
        logger_->write(LogLevel::Info, "Fluxora core shut down.");
        logger_->shutdown();

        initialized_ = false;
    }

    bool Core::isInitialized() const noexcept
    {
        return initialized_;
    }

    HookService& Core::hooks() noexcept
    {
        return *hooks_;
    }

    Logger& Core::logger() noexcept
    {
        return *logger_;
    }

    ModService& Core::mods() noexcept
    {
        return *mods_;
    }

    ModOrganizerImportService& Core::modOrganizerImport() noexcept
    {
        return *modOrganizerImport_;
    }

    PluginService& Core::plugins() noexcept
    {
        return *plugins_;
    }

    ProfileOrderService& Core::profileOrder() noexcept
    {
        return *profileOrder_;
    }

    ProfileService& Core::profiles() noexcept
    {
        return *profiles_;
    }

    DownloadService& Core::downloads() noexcept
    {
        return *downloads_;
    }

    EffectiveFileTreeService& Core::effectiveFileTree() noexcept
    {
        return *effectiveFileTree_;
    }

    ExecutableService& Core::executables() noexcept
    {
        return *executables_;
    }

    ExecutableIconService& Core::executableIcons() noexcept
    {
        return *executableIcons_;
    }

    FluxPackService& Core::fluxPacks() noexcept
    {
        return *fluxPacks_;
    }

    GrassCacheService& Core::grassCache() noexcept
    {
        return *grassCache_;
    }

    VirtualFileSystemService& Core::virtualFileSystem() noexcept
    {
        return *virtualFileSystem_;
    }

    NexusModsAuthService& Core::nexusModsAuth() noexcept
    {
        return *nexusModsAuth_;
    }

    NexusUpdateApi& Core::nexusUpdateApi() noexcept
    {
        return *nexusUpdateApi_;
    }

    ProjectService& Core::projects() noexcept
    {
        return *projects_;
    }

    TemplateService& Core::templates() noexcept
    {
        return *templates_;
    }

    AppSettingsService& Core::settings() noexcept
    {
        return *settings_;
    }

    BuildPathSettingsService& Core::buildPathSettings() noexcept
    {
        return *buildPathSettings_;
    }
}
