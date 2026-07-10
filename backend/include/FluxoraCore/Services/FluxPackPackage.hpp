#pragma once

#include <cstddef>
#include <cstdint>
#include <filesystem>
#include <functional>
#include <memory>
#include <string>
#include <string_view>
#include <vector>

namespace fluxora
{
    inline constexpr int fluxPackCurrentFormatVersion = 3;

    enum class FluxPackCompressionMode
    {
        Fast = 1,
        Optimal = 2,
        Smallest = 3
    };

    [[nodiscard]] std::wstring_view fluxPackCompressionModeId(FluxPackCompressionMode mode) noexcept;
    [[nodiscard]] bool tryParseFluxPackCompressionMode(
        std::wstring_view value,
        FluxPackCompressionMode& mode) noexcept;
    [[nodiscard]] int fluxPackCompressionLevel(FluxPackCompressionMode mode) noexcept;

    enum class FluxPackChunkCompression
    {
        None,
        Zstandard
    };

    struct FluxPackStoredChunk
    {
        std::wstring sha256;
        std::uintmax_t offset{0};
        std::uintmax_t storedSize{0};
        std::uintmax_t originalSize{0};
        FluxPackChunkCompression compression{FluxPackChunkCompression::None};
        int compressionLevel{0};
        std::wstring dictionarySha256;
        bool isDictionary{false};

        bool operator==(const FluxPackStoredChunk&) const = default;
    };

    struct FluxPackPayloadChunkReference
    {
        std::wstring sha256;
        std::uintmax_t offset{0};
        std::uintmax_t size{0};

        bool operator==(const FluxPackPayloadChunkReference&) const = default;
    };

    struct FluxPackPayloadReference
    {
        // FluxPack v2 compatibility fields. New v3 packages use chunks.
        std::uintmax_t offset{0};
        std::uintmax_t size{0};
        std::wstring sha256;
        std::vector<FluxPackPayloadChunkReference> chunks;
    };

    struct FluxPackContentStoreStatistics
    {
        FluxPackCompressionMode compressionMode{FluxPackCompressionMode::Optimal};
        std::uintmax_t logicalBytes{0};
        std::uintmax_t uniqueBytes{0};
        std::uintmax_t storedBytes{0};
        std::uintmax_t deduplicatedBytes{0};
        std::uintmax_t uniqueChunkCount{0};
        std::uintmax_t dictionaryCount{0};
    };

    [[nodiscard]] std::wstring computeFluxPackBytesSha256(const void* data, std::size_t size);
    [[nodiscard]] std::wstring computeFluxPackFileSha256(
        const std::filesystem::path& path,
        const std::function<void(std::uintmax_t)>& progress = {});

    class FluxPackPackageWriter final
    {
    public:
        explicit FluxPackPackageWriter(
            const std::filesystem::path& path,
            FluxPackCompressionMode compressionMode = FluxPackCompressionMode::Optimal);
        ~FluxPackPackageWriter();

        FluxPackPackageWriter(const FluxPackPackageWriter&) = delete;
        FluxPackPackageWriter& operator=(const FluxPackPackageWriter&) = delete;

        [[nodiscard]] FluxPackPayloadReference appendFile(
            const std::filesystem::path& sourcePath,
            const std::function<void(std::uintmax_t)>& progress = {});
        [[nodiscard]] std::vector<FluxPackPayloadReference> appendFiles(
            const std::vector<std::filesystem::path>& sourcePaths,
            const std::function<void(std::size_t, std::uintmax_t)>& progress = {});
        [[nodiscard]] const std::vector<FluxPackStoredChunk>& contentChunks() const noexcept;
        [[nodiscard]] FluxPackContentStoreStatistics contentStoreStatistics() const noexcept;
        void finish(std::string_view manifestUtf8);

    private:
        class Impl;
        std::unique_ptr<Impl> impl_;
    };

    class FluxPackPackageReader final
    {
    public:
        explicit FluxPackPackageReader(std::filesystem::path path);
        ~FluxPackPackageReader();

        FluxPackPackageReader(const FluxPackPackageReader&) = delete;
        FluxPackPackageReader& operator=(const FluxPackPackageReader&) = delete;
        FluxPackPackageReader(FluxPackPackageReader&&) noexcept;
        FluxPackPackageReader& operator=(FluxPackPackageReader&&) noexcept;

        [[nodiscard]] static bool isPackage(const std::filesystem::path& path) noexcept;
        [[nodiscard]] static bool isV2Package(const std::filesystem::path& path) noexcept;
        [[nodiscard]] static bool isV3Package(const std::filesystem::path& path) noexcept;
        [[nodiscard]] int containerVersion() const noexcept;
        [[nodiscard]] std::string readManifest() const;
        void setContentStore(const std::vector<FluxPackStoredChunk>& chunks);
        void extractPayload(
            const FluxPackPayloadReference& reference,
            const std::filesystem::path& targetPath,
            const std::function<void(std::uintmax_t)>& progress = {}) const;

    private:
        class Impl;
        std::unique_ptr<Impl> impl_;
    };
}
