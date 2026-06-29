#include "FluxoraVfs/VfsLifecycle.hpp"

#include <gtest/gtest.h>

namespace fluxora
{
    TEST(VfsLifecycleTests, RefusesDescriptorWithoutManagerProcess)
    {
        EXPECT_EQ(
            vfs::managerLifetimeWatchPlan(0, 100),
            vfs::ManagerLifetimeWatchPlan::RefuseMissingManager);
    }

    TEST(VfsLifecycleTests, DoesNotWaitOnCurrentProcessManager)
    {
        EXPECT_EQ(
            vfs::managerLifetimeWatchPlan(4242, 4242),
            vfs::ManagerLifetimeWatchPlan::CurrentProcessOwnsSession);
    }

    TEST(VfsLifecycleTests, WatchesExternalManagerProcess)
    {
        EXPECT_EQ(
            vfs::managerLifetimeWatchPlan(4242, 100),
            vfs::ManagerLifetimeWatchPlan::WatchExternalManager);
    }

    TEST(VfsLifecycleTests, InjectsVirtualizedGameChildrenByDefault)
    {
        EXPECT_EQ(
            vfs::childProcessVirtualizationPlan(L"C:\\Games\\Skyrim Special Edition\\SkyrimSE.exe", L""),
            vfs::ChildProcessVirtualizationPlan::InjectVirtualizedChild);
    }

    TEST(VfsLifecycleTests, LaunchesSteamBootstrapWithoutVfsByApplicationName)
    {
        EXPECT_EQ(
            vfs::childProcessVirtualizationPlan(L"C:\\Program Files (x86)\\Steam\\steam.exe", L""),
            vfs::ChildProcessVirtualizationPlan::LaunchExternalBootstrap);
    }

    TEST(VfsLifecycleTests, LaunchesSteamBootstrapWithoutVfsByQuotedCommandLine)
    {
        EXPECT_EQ(
            vfs::childProcessVirtualizationPlan({}, L"\"C:\\Program Files (x86)\\Steam\\Steam.exe\" -silent"),
            vfs::ChildProcessVirtualizationPlan::LaunchExternalBootstrap);
    }

    TEST(VfsLifecycleTests, DoesNotTreatSteamArgumentAsBootstrapExecutable)
    {
        EXPECT_EQ(
            vfs::childProcessVirtualizationPlan(
                L"C:\\Games\\Skyrim Special Edition\\skse64_loader.exe",
                L"\"C:\\Games\\Skyrim Special Edition\\skse64_loader.exe\" -forcesteamloader"),
            vfs::ChildProcessVirtualizationPlan::InjectVirtualizedChild);
    }
}
