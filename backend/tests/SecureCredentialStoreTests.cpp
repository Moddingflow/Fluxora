#include "FluxoraCore/Services/SecureCredentialStore.hpp"

#include <gtest/gtest.h>

#include <chrono>
#include <memory>
#include <string>

namespace fluxora::tests
{
    TEST(SecureCredentialStoreTests, WindowsStoreAtomicallyReplacesAndRemovesGenericCredential)
    {
#ifndef _WIN32
        GTEST_SKIP() << "Windows Credential Manager is available only on Windows.";
#else
        const std::wstring target =
            L"Fluxora/Test/SecureCredentialStore/" +
            std::to_wstring(std::chrono::steady_clock::now().time_since_epoch().count());
        std::unique_ptr<ISecureCredentialStore> store = createWindowsSecureCredentialStore();

        struct Cleanup final
        {
            ISecureCredentialStore& store;
            std::wstring target;
            ~Cleanup()
            {
                try
                {
                    store.remove(target);
                }
                catch (...)
                {
                }
            }
        } cleanup{*store, target};

        store->remove(target);
        EXPECT_FALSE(store->read(target).has_value());

        store->writeAtomic(target, "first-refresh-token");
        ASSERT_TRUE(store->read(target).has_value());
        EXPECT_EQ(*store->read(target), "first-refresh-token");

        store->writeAtomic(target, "rotated-refresh-token");
        ASSERT_TRUE(store->read(target).has_value());
        EXPECT_EQ(*store->read(target), "rotated-refresh-token");

        store->remove(target);
        EXPECT_FALSE(store->read(target).has_value());
#endif
    }
}
