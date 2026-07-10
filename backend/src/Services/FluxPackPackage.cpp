#include "FluxoraCore/Services/FluxPackPackage.hpp"
#include "FluxoraCore/Support/FilesystemPath.hpp"

#include <zdict.h>
#include <zstd.h>

#include <algorithm>
#include <array>
#include <bit>
#include <cctype>
#include <cwctype>
#include <fstream>
#include <limits>
#include <map>
#include <span>
#include <stdexcept>
#include <system_error>
#include <unordered_map>
#include <unordered_set>
#include <utility>
#include <vector>

namespace fluxora
{
    namespace
    {
        constexpr std::array<char, 16> packageHeaderV2{
            'F', 'L', 'U', 'X', 'P', 'A', 'C', 'K', '2', '\r', '\n', '\x1a', '\n', '\0', '\0', '\0'};
        constexpr std::array<char, 16> packageHeaderV3{
            'F', 'L', 'U', 'X', 'P', 'A', 'C', 'K', '3', '\r', '\n', '\x1a', '\n', '\0', '\0', '\0'};
        constexpr std::array<char, 8> packageFooterMagicV2{
            'F', 'L', 'X', 'P', 'E', 'N', 'D', '2'};
        constexpr std::array<char, 8> packageFooterMagicV3{
            'F', 'L', 'X', 'P', 'E', 'N', 'D', '3'};
        constexpr std::uintmax_t packageFooterBytes = packageFooterMagicV3.size() + 16;
        constexpr std::uintmax_t maxManifestBytes = 256ULL * 1024ULL * 1024ULL;
        constexpr std::size_t copyBufferBytes = 1024 * 1024;
        constexpr std::size_t fastCdcMinimumBytes = 64 * 1024;
        constexpr std::size_t fastCdcAverageBytes = 256 * 1024;
        constexpr std::size_t fastCdcMaximumBytes = 1024 * 1024;
        constexpr std::size_t compressedProbeBytes = 256 * 1024;
        constexpr std::uintmax_t smallTextFileBytes = 64 * 1024;
        constexpr std::size_t textBundleBytes = 128 * 1024;
        constexpr std::uintmax_t maximumTextBatchBytes = 16ULL * 1024ULL * 1024ULL;
        constexpr std::size_t maximumTextBatchFiles = 2048;
        constexpr std::size_t maximumDictionaryBytes = 8 * 1024;
        constexpr std::uintmax_t maximumReadableChunkBytes = 4ULL * 1024ULL * 1024ULL;
        constexpr std::uintmax_t maximumReadableDictionaryBytes = 128ULL * 1024ULL;

        struct PackageLayout
        {
            int version{0};
            std::uintmax_t manifestOffset{0};
            std::uintmax_t manifestSize{0};
        };

        constexpr std::array<std::uint32_t, 64> sha256Constants{
            0x428a2f98U, 0x71374491U, 0xb5c0fbcfU, 0xe9b5dba5U,
            0x3956c25bU, 0x59f111f1U, 0x923f82a4U, 0xab1c5ed5U,
            0xd807aa98U, 0x12835b01U, 0x243185beU, 0x550c7dc3U,
            0x72be5d74U, 0x80deb1feU, 0x9bdc06a7U, 0xc19bf174U,
            0xe49b69c1U, 0xefbe4786U, 0x0fc19dc6U, 0x240ca1ccU,
            0x2de92c6fU, 0x4a7484aaU, 0x5cb0a9dcU, 0x76f988daU,
            0x983e5152U, 0xa831c66dU, 0xb00327c8U, 0xbf597fc7U,
            0xc6e00bf3U, 0xd5a79147U, 0x06ca6351U, 0x14292967U,
            0x27b70a85U, 0x2e1b2138U, 0x4d2c6dfcU, 0x53380d13U,
            0x650a7354U, 0x766a0abbU, 0x81c2c92eU, 0x92722c85U,
            0xa2bfe8a1U, 0xa81a664bU, 0xc24b8b70U, 0xc76c51a3U,
            0xd192e819U, 0xd6990624U, 0xf40e3585U, 0x106aa070U,
            0x19a4c116U, 0x1e376c08U, 0x2748774cU, 0x34b0bcb5U,
            0x391c0cb3U, 0x4ed8aa4aU, 0x5b9cca4fU, 0x682e6ff3U,
            0x748f82eeU, 0x78a5636fU, 0x84c87814U, 0x8cc70208U,
            0x90befffaU, 0xa4506cebU, 0xbef9a3f7U, 0xc67178f2U};

        std::wstring bytesToHex(const unsigned char* bytes, std::size_t size)
        {
            constexpr wchar_t digits[] = L"0123456789abcdef";
            std::wstring result(size * 2, L'0');
            for (std::size_t index = 0; index < size; ++index)
            {
                result[index * 2] = digits[(bytes[index] >> 4U) & 0x0fU];
                result[index * 2 + 1] = digits[bytes[index] & 0x0fU];
            }
            return result;
        }

        bool equalsIgnoreCase(std::wstring_view left, std::wstring_view right)
        {
            if (left.size() != right.size())
            {
                return false;
            }
            return std::equal(left.begin(), left.end(), right.begin(), [](wchar_t leftCharacter, wchar_t rightCharacter)
            {
                return std::towlower(leftCharacter) == std::towlower(rightCharacter);
            });
        }

        std::wstring lower(std::wstring value)
        {
            std::transform(value.begin(), value.end(), value.begin(), [](wchar_t character)
            {
                return static_cast<wchar_t>(std::towlower(character));
            });
            return value;
        }

        bool isSha256(std::wstring_view value)
        {
            return value.size() == 64 &&
                std::all_of(value.begin(), value.end(), [](wchar_t character)
                {
                    return (character >= L'0' && character <= L'9') ||
                        (character >= L'a' && character <= L'f') ||
                        (character >= L'A' && character <= L'F');
                });
        }

        class Sha256Hasher final
        {
        public:
            void update(const char* data, std::size_t size)
            {
                if (finished_)
                {
                    throw std::logic_error("FluxPack SHA-256 state has already been finalized.");
                }
                if (size > 0 && data == nullptr)
                {
                    throw std::invalid_argument("FluxPack SHA-256 input is null.");
                }
                if (size > std::numeric_limits<std::uint64_t>::max() - totalBytes_)
                {
                    throw std::overflow_error("FluxPack SHA-256 input is too large.");
                }

                totalBytes_ += static_cast<std::uint64_t>(size);
                while (size > 0)
                {
                    const std::size_t copied = std::min(size, block_.size() - blockSize_);
                    std::copy_n(
                        reinterpret_cast<const unsigned char*>(data),
                        copied,
                        block_.begin() + static_cast<std::ptrdiff_t>(blockSize_));
                    blockSize_ += copied;
                    data += copied;
                    size -= copied;
                    if (blockSize_ == block_.size())
                    {
                        transform(block_.data());
                        blockSize_ = 0;
                    }
                }
            }

            [[nodiscard]] std::wstring finish()
            {
                if (finished_)
                {
                    throw std::logic_error("FluxPack SHA-256 state has already been finalized.");
                }
                finished_ = true;

                block_[blockSize_++] = 0x80U;
                if (blockSize_ > 56)
                {
                    std::fill(
                        block_.begin() + static_cast<std::ptrdiff_t>(blockSize_),
                        block_.end(),
                        static_cast<unsigned char>(0));
                    transform(block_.data());
                    blockSize_ = 0;
                }
                std::fill(
                    block_.begin() + static_cast<std::ptrdiff_t>(blockSize_),
                    block_.begin() + 56,
                    static_cast<unsigned char>(0));

                const std::uint64_t bitLength = totalBytes_ * 8U;
                for (std::size_t index = 0; index < 8; ++index)
                {
                    block_[63 - index] = static_cast<unsigned char>((bitLength >> (index * 8U)) & 0xffU);
                }
                transform(block_.data());

                std::array<unsigned char, 32> digest{};
                for (std::size_t index = 0; index < state_.size(); ++index)
                {
                    digest[index * 4] = static_cast<unsigned char>((state_[index] >> 24U) & 0xffU);
                    digest[index * 4 + 1] = static_cast<unsigned char>((state_[index] >> 16U) & 0xffU);
                    digest[index * 4 + 2] = static_cast<unsigned char>((state_[index] >> 8U) & 0xffU);
                    digest[index * 4 + 3] = static_cast<unsigned char>(state_[index] & 0xffU);
                }
                return bytesToHex(digest.data(), digest.size());
            }

        private:
            void transform(const unsigned char* block)
            {
                std::array<std::uint32_t, 64> words{};
                for (std::size_t index = 0; index < 16; ++index)
                {
                    const std::size_t offset = index * 4;
                    words[index] =
                        (static_cast<std::uint32_t>(block[offset]) << 24U) |
                        (static_cast<std::uint32_t>(block[offset + 1]) << 16U) |
                        (static_cast<std::uint32_t>(block[offset + 2]) << 8U) |
                        static_cast<std::uint32_t>(block[offset + 3]);
                }
                for (std::size_t index = 16; index < words.size(); ++index)
                {
                    const std::uint32_t s0 =
                        std::rotr(words[index - 15], 7) ^
                        std::rotr(words[index - 15], 18) ^
                        (words[index - 15] >> 3U);
                    const std::uint32_t s1 =
                        std::rotr(words[index - 2], 17) ^
                        std::rotr(words[index - 2], 19) ^
                        (words[index - 2] >> 10U);
                    words[index] = words[index - 16] + s0 + words[index - 7] + s1;
                }

                std::uint32_t a = state_[0];
                std::uint32_t b = state_[1];
                std::uint32_t c = state_[2];
                std::uint32_t d = state_[3];
                std::uint32_t e = state_[4];
                std::uint32_t f = state_[5];
                std::uint32_t g = state_[6];
                std::uint32_t h = state_[7];

                for (std::size_t index = 0; index < words.size(); ++index)
                {
                    const std::uint32_t sum1 =
                        std::rotr(e, 6) ^ std::rotr(e, 11) ^ std::rotr(e, 25);
                    const std::uint32_t choose = (e & f) ^ ((~e) & g);
                    const std::uint32_t temporary1 =
                        h + sum1 + choose + sha256Constants[index] + words[index];
                    const std::uint32_t sum0 =
                        std::rotr(a, 2) ^ std::rotr(a, 13) ^ std::rotr(a, 22);
                    const std::uint32_t majority = (a & b) ^ (a & c) ^ (b & c);
                    const std::uint32_t temporary2 = sum0 + majority;

                    h = g;
                    g = f;
                    f = e;
                    e = d + temporary1;
                    d = c;
                    c = b;
                    b = a;
                    a = temporary1 + temporary2;
                }

                state_[0] += a;
                state_[1] += b;
                state_[2] += c;
                state_[3] += d;
                state_[4] += e;
                state_[5] += f;
                state_[6] += g;
                state_[7] += h;
            }

            std::array<std::uint32_t, 8> state_{
                0x6a09e667U,
                0xbb67ae85U,
                0x3c6ef372U,
                0xa54ff53aU,
                0x510e527fU,
                0x9b05688cU,
                0x1f83d9abU,
                0x5be0cd19U};
            std::array<unsigned char, 64> block_{};
            std::size_t blockSize_{0};
            std::uint64_t totalBytes_{0};
            bool finished_{false};
        };

        constexpr std::array<std::uint64_t, 256> makeFastCdcGearTable()
        {
            std::array<std::uint64_t, 256> table{};
            std::uint64_t state = 0x243f6a8885a308d3ULL;
            for (std::uint64_t& value : table)
            {
                state += 0x9e3779b97f4a7c15ULL;
                std::uint64_t mixed = state;
                mixed = (mixed ^ (mixed >> 30U)) * 0xbf58476d1ce4e5b9ULL;
                mixed = (mixed ^ (mixed >> 27U)) * 0x94d049bb133111ebULL;
                value = mixed ^ (mixed >> 31U);
            }
            return table;
        }

        constexpr auto fastCdcGearTable = makeFastCdcGearTable();

        std::size_t fastCdcBoundary(std::span<const char> bytes)
        {
            if (bytes.size() <= fastCdcMinimumBytes)
            {
                return bytes.size();
            }

            const std::size_t normalEnd = std::min(bytes.size(), fastCdcAverageBytes);
            const std::size_t maximumEnd = std::min(bytes.size(), fastCdcMaximumBytes);
            constexpr std::uint64_t strictMask = (1ULL << 19U) - 1ULL;
            constexpr std::uint64_t relaxedMask = (1ULL << 17U) - 1ULL;
            std::uint64_t fingerprint = 0;

            for (std::size_t index = fastCdcMinimumBytes; index < normalEnd; ++index)
            {
                fingerprint = (fingerprint << 1U) +
                    fastCdcGearTable[static_cast<unsigned char>(bytes[index])];
                if ((fingerprint & strictMask) == 0)
                {
                    return index + 1;
                }
            }
            for (std::size_t index = normalEnd; index < maximumEnd; ++index)
            {
                fingerprint = (fingerprint << 1U) +
                    fastCdcGearTable[static_cast<unsigned char>(bytes[index])];
                if ((fingerprint & relaxedMask) == 0)
                {
                    return index + 1;
                }
            }
            return maximumEnd;
        }

        void writeUint64(std::ostream& output, std::uint64_t value)
        {
            std::array<char, 8> bytes{};
            for (std::size_t index = 0; index < bytes.size(); ++index)
            {
                bytes[index] = static_cast<char>((value >> (index * 8U)) & 0xffU);
            }
            output.write(bytes.data(), static_cast<std::streamsize>(bytes.size()));
        }

        std::uint64_t readUint64(const char* bytes)
        {
            std::uint64_t value = 0;
            for (std::size_t index = 0; index < 8; ++index)
            {
                value |= static_cast<std::uint64_t>(static_cast<unsigned char>(bytes[index])) << (index * 8U);
            }
            return value;
        }

        std::streamoff checkedStreamOffset(std::uintmax_t value)
        {
            if (value > static_cast<std::uintmax_t>(std::numeric_limits<std::streamoff>::max()))
            {
                throw std::invalid_argument("FluxPack offset is too large for this platform.");
            }
            return static_cast<std::streamoff>(value);
        }

        std::uintmax_t outputOffset(std::ofstream& output)
        {
            const std::streampos position = output.tellp();
            if (position == std::streampos(-1))
            {
                throw std::runtime_error("FluxPack output position could not be read.");
            }
            return static_cast<std::uintmax_t>(static_cast<std::streamoff>(position));
        }

        void readExact(std::istream& input, char* output, std::size_t size, std::string_view context)
        {
            input.read(output, static_cast<std::streamsize>(size));
            if (input.gcount() != static_cast<std::streamsize>(size))
            {
                throw std::invalid_argument("FluxPack is truncated while reading " + std::string(context) + ".");
            }
        }

        int headerVersion(const std::array<char, packageHeaderV3.size()>& header) noexcept
        {
            if (header == packageHeaderV3)
            {
                return 3;
            }
            if (header == packageHeaderV2)
            {
                return 2;
            }
            return 0;
        }

        PackageLayout readLayout(const std::filesystem::path& path)
        {
            std::error_code sizeError;
            const std::uintmax_t fileSize = std::filesystem::file_size(path, sizeError);
            if (sizeError || fileSize < packageHeaderV3.size() + packageFooterBytes)
            {
                throw std::invalid_argument("FluxPack package is missing or truncated.");
            }

            std::ifstream input(pathForFilesystemIo(path), std::ios::in | std::ios::binary);
            if (!input)
            {
                throw std::runtime_error("FluxPack could not be opened.");
            }

            std::array<char, packageHeaderV3.size()> header{};
            readExact(input, header.data(), header.size(), "the header");
            const int version = headerVersion(header);
            if (version == 0)
            {
                throw std::invalid_argument("Selected file is not a supported FluxPack container.");
            }

            input.seekg(checkedStreamOffset(fileSize - packageFooterBytes), std::ios::beg);
            if (!input)
            {
                throw std::invalid_argument("FluxPack footer could not be located.");
            }

            std::array<char, packageFooterBytes> footer{};
            readExact(input, footer.data(), footer.size(), "the footer");
            const auto& expectedFooter = version == 3 ? packageFooterMagicV3 : packageFooterMagicV2;
            if (!std::equal(expectedFooter.begin(), expectedFooter.end(), footer.begin()))
            {
                throw std::invalid_argument("FluxPack footer is invalid.");
            }

            const std::uintmax_t manifestOffset = readUint64(footer.data() + expectedFooter.size());
            const std::uintmax_t manifestSize = readUint64(footer.data() + expectedFooter.size() + 8);
            const std::uintmax_t footerOffset = fileSize - packageFooterBytes;
            if (manifestSize == 0 || manifestSize > maxManifestBytes ||
                manifestOffset < packageHeaderV3.size() ||
                manifestOffset > footerOffset ||
                manifestSize > footerOffset - manifestOffset ||
                manifestOffset + manifestSize != footerOffset)
            {
                throw std::invalid_argument("FluxPack manifest location is invalid.");
            }

            return PackageLayout{version, manifestOffset, manifestSize};
        }

        void addChecked(std::uintmax_t& total, std::uintmax_t value, std::string_view context)
        {
            if (value > std::numeric_limits<std::uintmax_t>::max() - total)
            {
                throw std::overflow_error("FluxPack size overflow while processing " + std::string(context) + ".");
            }
            total += value;
        }

        bool compressionWorthwhile(std::size_t compressedSize, std::size_t originalSize)
        {
            if (compressedSize >= originalSize || originalSize < 64)
            {
                return false;
            }
            const std::size_t requiredSaving = std::max<std::size_t>(16, originalSize / 200);
            return originalSize - compressedSize >= requiredSaving;
        }

        bool compressedProbeWorthwhile(std::size_t compressedSize, std::size_t originalSize)
        {
            if (compressedSize >= originalSize || originalSize < 64)
            {
                return false;
            }
            const std::size_t requiredSaving = std::max<std::size_t>(64, originalSize / 100);
            return originalSize - compressedSize >= requiredSaving;
        }

        bool isAlreadyCompressedExtension(const std::filesystem::path& path)
        {
            static const std::unordered_set<std::wstring> extensions{
                L".dds", L".bsa", L".ba2", L".zip", L".7z", L".rar",
                L".ogg", L".mp3", L".aac", L".flac",
                L".mp4", L".m4v", L".mkv", L".webm", L".avi", L".mov", L".wmv"};
            return extensions.contains(lower(path.extension().wstring()));
        }

        bool isSmallTextExtension(const std::filesystem::path& path)
        {
            const std::wstring extension = lower(path.extension().wstring());
            return extension == L".ini" || extension == L".json" || extension == L".xml";
        }

        std::vector<char> readSmallFile(const std::filesystem::path& path, std::uintmax_t expectedSize)
        {
            if (expectedSize > smallTextFileBytes ||
                expectedSize > static_cast<std::uintmax_t>(std::numeric_limits<std::size_t>::max()))
            {
                throw std::invalid_argument("FluxPack small text input exceeds the supported size.");
            }
            std::ifstream input(pathForFilesystemIo(path), std::ios::in | std::ios::binary);
            if (!input)
            {
                throw std::runtime_error("FluxPack payload file could not be opened.");
            }
            std::vector<char> bytes(static_cast<std::size_t>(expectedSize));
            if (!bytes.empty())
            {
                readExact(input, bytes.data(), bytes.size(), "a small text payload");
            }
            char extra = 0;
            input.read(&extra, 1);
            if (input.gcount() != 0)
            {
                throw std::runtime_error("FluxPack small text payload changed while it was being read.");
            }
            return bytes;
        }

        std::vector<char> trainTextDictionary(
            const std::vector<std::vector<char>>& samples,
            const std::vector<std::size_t>& sampleSizes)
        {
            if (sampleSizes.size() < 8)
            {
                return {};
            }
            std::size_t totalSize = 0;
            for (std::size_t size : sampleSizes)
            {
                totalSize += size;
            }
            if (totalSize < 8 * 1024)
            {
                return {};
            }

            std::vector<char> training;
            training.reserve(totalSize);
            for (const std::vector<char>& sample : samples)
            {
                training.insert(training.end(), sample.begin(), sample.end());
            }

            const std::size_t dictionaryCapacity = std::min(
                maximumDictionaryBytes,
                std::max<std::size_t>(1024, totalSize / 8));
            std::vector<char> dictionary(dictionaryCapacity);
            const std::size_t trained = ZDICT_trainFromBuffer(
                dictionary.data(),
                dictionary.size(),
                training.data(),
                sampleSizes.data(),
                static_cast<unsigned>(sampleSizes.size()));
            if (!ZDICT_isError(trained) && trained >= 256)
            {
                dictionary.resize(trained);
                return dictionary;
            }

            const std::size_t fallbackSize = std::min(
                maximumDictionaryBytes,
                std::max<std::size_t>(256, totalSize / 32));
            if (fallbackSize >= training.size())
            {
                return {};
            }
            dictionary.assign(training.begin(), training.begin() + static_cast<std::ptrdiff_t>(fallbackSize));
            return dictionary;
        }
    }

    std::wstring_view fluxPackCompressionModeId(FluxPackCompressionMode mode) noexcept
    {
        switch (mode)
        {
        case FluxPackCompressionMode::Fast:
            return L"fast";
        case FluxPackCompressionMode::Smallest:
            return L"smallest";
        case FluxPackCompressionMode::Optimal:
        default:
            return L"optimal";
        }
    }

    bool tryParseFluxPackCompressionMode(
        std::wstring_view value,
        FluxPackCompressionMode& mode) noexcept
    {
        if (equalsIgnoreCase(value, L"fast"))
        {
            mode = FluxPackCompressionMode::Fast;
            return true;
        }
        if (equalsIgnoreCase(value, L"optimal"))
        {
            mode = FluxPackCompressionMode::Optimal;
            return true;
        }
        if (equalsIgnoreCase(value, L"smallest"))
        {
            mode = FluxPackCompressionMode::Smallest;
            return true;
        }
        return false;
    }

    int fluxPackCompressionLevel(FluxPackCompressionMode mode) noexcept
    {
        switch (mode)
        {
        case FluxPackCompressionMode::Fast:
            return 1;
        case FluxPackCompressionMode::Smallest:
            return 19;
        case FluxPackCompressionMode::Optimal:
        default:
            return 6;
        }
    }

    std::wstring computeFluxPackBytesSha256(const void* data, std::size_t size)
    {
        Sha256Hasher hasher;
        hasher.update(static_cast<const char*>(data), size);
        return hasher.finish();
    }

    std::wstring computeFluxPackFileSha256(
        const std::filesystem::path& path,
        const std::function<void(std::uintmax_t)>& progress)
    {
        std::ifstream input(pathForFilesystemIo(path), std::ios::in | std::ios::binary);
        if (!input)
        {
            throw std::runtime_error("FluxPack file could not be opened for SHA-256 hashing.");
        }

        thread_local std::vector<char> buffer(copyBufferBytes);
        Sha256Hasher hasher;
        std::uintmax_t processedBytes = 0;
        while (input)
        {
            input.read(buffer.data(), static_cast<std::streamsize>(buffer.size()));
            const std::streamsize read = input.gcount();
            if (read <= 0)
            {
                break;
            }
            hasher.update(buffer.data(), static_cast<std::size_t>(read));
            processedBytes += static_cast<std::uintmax_t>(read);
            if (progress)
            {
                progress(processedBytes);
            }
        }
        if (input.bad())
        {
            throw std::runtime_error("FluxPack file could not be hashed completely.");
        }
        return hasher.finish();
    }

    class FluxPackPackageWriter::Impl final
    {
    public:
        Impl(const std::filesystem::path& path, FluxPackCompressionMode compressionMode)
            : output_(pathForFilesystemIo(path), std::ios::out | std::ios::trunc | std::ios::binary),
              compressionMode_(compressionMode),
              compressionLevel_(fluxPackCompressionLevel(compressionMode)),
              cctx_(ZSTD_createCCtx())
        {
            if (!output_)
            {
                throw std::runtime_error("FluxPack temporary output could not be created.");
            }
            if (cctx_ == nullptr)
            {
                throw std::bad_alloc();
            }
            output_.write(packageHeaderV3.data(), static_cast<std::streamsize>(packageHeaderV3.size()));
            if (!output_)
            {
                throw std::runtime_error("FluxPack header could not be written.");
            }
        }

        ~Impl()
        {
            if (cctx_ != nullptr)
            {
                ZSTD_freeCCtx(cctx_);
            }
            if (output_.is_open())
            {
                output_.close();
            }
        }

        std::vector<char> compress(
            std::span<const char> bytes,
            std::span<const char> dictionary = {})
        {
            std::vector<char> compressed(ZSTD_compressBound(bytes.size()));
            const std::size_t result = dictionary.empty()
                ? ZSTD_compressCCtx(
                    cctx_,
                    compressed.data(),
                    compressed.size(),
                    bytes.data(),
                    bytes.size(),
                    compressionLevel_)
                : ZSTD_compress_usingDict(
                    cctx_,
                    compressed.data(),
                    compressed.size(),
                    bytes.data(),
                    bytes.size(),
                    dictionary.data(),
                    dictionary.size(),
                    compressionLevel_);
            if (ZSTD_isError(result))
            {
                throw std::runtime_error(
                    std::string("FluxPack Zstandard compression failed: ") + ZSTD_getErrorName(result));
            }
            compressed.resize(result);
            return compressed;
        }

        bool shouldCompressPath(const std::filesystem::path& path)
        {
            if (!isAlreadyCompressedExtension(path))
            {
                return true;
            }

            std::ifstream input(pathForFilesystemIo(path), std::ios::in | std::ios::binary);
            if (!input)
            {
                throw std::runtime_error("FluxPack payload file could not be opened for compression probing.");
            }
            std::vector<char> sample(compressedProbeBytes);
            input.read(sample.data(), static_cast<std::streamsize>(sample.size()));
            const std::streamsize read = input.gcount();
            if (read <= 0)
            {
                return false;
            }
            sample.resize(static_cast<std::size_t>(read));
            const std::vector<char> compressed = compress(sample);
            return compressedProbeWorthwhile(compressed.size(), sample.size());
        }

        std::wstring storeChunk(
            std::span<const char> bytes,
            bool allowCompression,
            std::wstring_view dictionarySha256 = {},
            std::span<const char> dictionary = {},
            bool isDictionary = false)
        {
            if (bytes.empty())
            {
                throw std::invalid_argument("FluxPack cannot store an empty content chunk.");
            }

            const std::wstring hash = computeFluxPackBytesSha256(bytes.data(), bytes.size());
            const auto existing = chunkIndexByHash_.find(hash);
            if (existing != chunkIndexByHash_.end())
            {
                FluxPackStoredChunk& chunk = chunks_[existing->second];
                chunk.isDictionary = chunk.isDictionary || isDictionary;
                if (isDictionary)
                {
                    dictionaryHashes_.insert(hash);
                }
                else if (payloadChunkHashes_.insert(hash).second)
                {
                    addChecked(uniqueBytes_, chunk.originalSize, "unique content bytes");
                }
                return hash;
            }

            std::span<const char> stored = bytes;
            std::vector<char> compressed;
            FluxPackChunkCompression compression = FluxPackChunkCompression::None;
            std::wstring appliedDictionary;
            int appliedLevel = 0;
            if (allowCompression && bytes.size() >= 64)
            {
                compressed = compress(bytes, dictionary);
                if (compressionWorthwhile(compressed.size(), bytes.size()))
                {
                    stored = compressed;
                    compression = FluxPackChunkCompression::Zstandard;
                    appliedLevel = compressionLevel_;
                    if (!dictionary.empty())
                    {
                        appliedDictionary = std::wstring(dictionarySha256);
                    }
                }
            }

            FluxPackStoredChunk chunk;
            chunk.sha256 = hash;
            chunk.offset = outputOffset(output_);
            chunk.storedSize = stored.size();
            chunk.originalSize = bytes.size();
            chunk.compression = compression;
            chunk.compressionLevel = appliedLevel;
            chunk.dictionarySha256 = std::move(appliedDictionary);
            chunk.isDictionary = isDictionary;
            output_.write(stored.data(), static_cast<std::streamsize>(stored.size()));
            if (!output_)
            {
                throw std::runtime_error("FluxPack content chunk could not be written. Check free disk space and retry.");
            }

            chunkIndexByHash_.emplace(hash, chunks_.size());
            chunks_.push_back(chunk);
            addChecked(storedBytes_, chunk.storedSize, "stored content bytes");
            if (isDictionary)
            {
                dictionaryHashes_.insert(hash);
            }
            else if (payloadChunkHashes_.insert(hash).second)
            {
                addChecked(uniqueBytes_, chunk.originalSize, "unique content bytes");
            }
            return hash;
        }

        FluxPackPayloadReference appendFile(
            const std::filesystem::path& sourcePath,
            const std::function<void(std::uintmax_t)>& progress,
            bool countLogicalBytes = true)
        {
            if (finished_)
            {
                throw std::logic_error("FluxPack package has already been finalized.");
            }

            std::ifstream input(pathForFilesystemIo(sourcePath), std::ios::in | std::ios::binary);
            if (!input)
            {
                throw std::runtime_error("FluxPack payload file could not be opened.");
            }

            const bool allowCompression = shouldCompressPath(sourcePath);
            std::vector<char> buffer(fastCdcMaximumBytes);
            FluxPackPayloadReference reference;
            Sha256Hasher fileHasher;
            while (input)
            {
                input.read(buffer.data(), static_cast<std::streamsize>(buffer.size()));
                const std::streamsize read = input.gcount();
                if (read <= 0)
                {
                    break;
                }

                const std::size_t available = static_cast<std::size_t>(read);
                const std::size_t boundary = fastCdcBoundary(
                    std::span<const char>(buffer.data(), available));
                if (boundary < available)
                {
                    const std::streamoff rewind = static_cast<std::streamoff>(available - boundary);
                    input.clear();
                    input.seekg(-rewind, std::ios::cur);
                    if (!input)
                    {
                        throw std::runtime_error("FluxPack payload stream could not preserve a FastCDC boundary.");
                    }
                }

                const std::span<const char> chunkBytes(buffer.data(), boundary);
                fileHasher.update(chunkBytes.data(), chunkBytes.size());
                const std::wstring chunkHash = storeChunk(chunkBytes, allowCompression);
                reference.chunks.push_back(FluxPackPayloadChunkReference{
                    chunkHash,
                    0,
                    static_cast<std::uintmax_t>(chunkBytes.size())});
                addChecked(reference.size, chunkBytes.size(), "payload bytes");
                if (progress)
                {
                    progress(reference.size);
                }
            }

            if (input.bad())
            {
                throw std::runtime_error("FluxPack payload file could not be read completely.");
            }
            reference.sha256 = fileHasher.finish();
            if (countLogicalBytes)
            {
                addChecked(logicalBytes_, reference.size, "logical payload bytes");
            }
            return reference;
        }

        std::vector<FluxPackPayloadReference> appendFiles(
            const std::vector<std::filesystem::path>& sourcePaths,
            const std::function<void(std::size_t, std::uintmax_t)>& progress)
        {
            if (finished_)
            {
                throw std::logic_error("FluxPack package has already been finalized.");
            }

            struct SmallFile
            {
                std::size_t inputIndex{0};
                std::vector<char> bytes;
                std::wstring sha256;
            };
            struct SmallFileCandidate
            {
                std::size_t inputIndex{0};
                std::uintmax_t size{0};
            };

            std::vector<FluxPackPayloadReference> references(sourcePaths.size());
            std::vector<bool> grouped(sourcePaths.size(), false);
            std::map<std::wstring, std::vector<SmallFileCandidate>> groups;
            std::unordered_map<std::wstring, FluxPackPayloadChunkReference> smallFilePlacementByHash;
            for (std::size_t index = 0; index < sourcePaths.size(); ++index)
            {
                std::error_code sizeError;
                const std::uintmax_t fileSize = std::filesystem::file_size(
                    pathForFilesystemIo(sourcePaths[index]),
                    sizeError);
                if (sizeError || fileSize > smallTextFileBytes || !isSmallTextExtension(sourcePaths[index]))
                {
                    continue;
                }

                grouped[index] = true;
                groups[lower(sourcePaths[index].extension().wstring())].push_back(
                    SmallFileCandidate{index, fileSize});
            }

            const auto processSmallFileBatch = [&](std::vector<SmallFile>& files)
            {
                struct UniqueFile
                {
                    std::vector<char> bytes;
                    std::wstring sha256;
                    std::vector<std::size_t> inputIndices;
                };
                struct Placement
                {
                    std::size_t bundleIndex{0};
                    std::uintmax_t offset{0};
                    std::uintmax_t size{0};
                };

                std::vector<UniqueFile> uniqueFiles;
                std::unordered_map<std::wstring, std::size_t> uniqueByHash;
                for (SmallFile& file : files)
                {
                    const auto storedPlacement = smallFilePlacementByHash.find(file.sha256);
                    if (storedPlacement != smallFilePlacementByHash.end())
                    {
                        references[file.inputIndex].chunks = {storedPlacement->second};
                        continue;
                    }
                    const auto existing = uniqueByHash.find(file.sha256);
                    if (existing != uniqueByHash.end())
                    {
                        if (uniqueFiles[existing->second].bytes != file.bytes)
                        {
                            throw std::runtime_error("FluxPack detected a SHA-256 collision in small text inputs.");
                        }
                        uniqueFiles[existing->second].inputIndices.push_back(file.inputIndex);
                        continue;
                    }
                    uniqueByHash.emplace(file.sha256, uniqueFiles.size());
                    uniqueFiles.push_back(UniqueFile{
                        std::move(file.bytes),
                        std::move(file.sha256),
                        {file.inputIndex}});
                }

                std::vector<std::vector<char>> bundles;
                std::vector<Placement> placements(uniqueFiles.size());
                std::vector<std::vector<char>> dictionarySamples;
                std::vector<std::size_t> dictionarySampleSizes;
                for (std::size_t index = 0; index < uniqueFiles.size(); ++index)
                {
                    const UniqueFile& file = uniqueFiles[index];
                    if (file.bytes.empty())
                    {
                        continue;
                    }
                    if (bundles.empty() || bundles.back().size() + file.bytes.size() > textBundleBytes)
                    {
                        bundles.emplace_back();
                        bundles.back().reserve(textBundleBytes);
                    }
                    std::vector<char>& bundle = bundles.back();
                    placements[index] = Placement{
                        bundles.size() - 1,
                        bundle.size(),
                        file.bytes.size()};
                    bundle.insert(bundle.end(), file.bytes.begin(), file.bytes.end());
                    dictionarySamples.push_back(file.bytes);
                    dictionarySampleSizes.push_back(file.bytes.size());
                }

                std::vector<char> dictionary = trainTextDictionary(
                    dictionarySamples,
                    dictionarySampleSizes);
                bool useDictionary = false;
                if (!dictionary.empty() && !bundles.empty())
                {
                    std::uintmax_t withoutDictionary = 0;
                    std::uintmax_t withDictionary = dictionary.size();
                    for (const std::vector<char>& bundle : bundles)
                    {
                        const std::vector<char> plainCompressed = compress(bundle);
                        const std::vector<char> dictionaryCompressed = compress(bundle, dictionary);
                        addChecked(
                            withoutDictionary,
                            compressionWorthwhile(plainCompressed.size(), bundle.size())
                                ? plainCompressed.size()
                                : bundle.size(),
                            "plain text bundle bytes");
                        addChecked(
                            withDictionary,
                            compressionWorthwhile(dictionaryCompressed.size(), bundle.size())
                                ? dictionaryCompressed.size()
                                : bundle.size(),
                            "dictionary text bundle bytes");
                    }
                    useDictionary = withDictionary + 64 < withoutDictionary;
                }

                std::wstring dictionaryHash;
                if (useDictionary)
                {
                    dictionaryHash = storeChunk(dictionary, false, {}, {}, true);
                }

                std::vector<std::wstring> bundleHashes;
                bundleHashes.reserve(bundles.size());
                for (const std::vector<char>& bundle : bundles)
                {
                    bundleHashes.push_back(storeChunk(
                        bundle,
                        true,
                        dictionaryHash,
                        useDictionary ? std::span<const char>(dictionary) : std::span<const char>{}));
                }

                for (std::size_t index = 0; index < uniqueFiles.size(); ++index)
                {
                    const UniqueFile& file = uniqueFiles[index];
                    if (file.bytes.empty())
                    {
                        continue;
                    }
                    const Placement& placement = placements[index];
                    const FluxPackPayloadChunkReference piece{
                        bundleHashes[placement.bundleIndex],
                        placement.offset,
                        placement.size};
                    for (std::size_t inputIndex : file.inputIndices)
                    {
                        references[inputIndex].chunks = {piece};
                    }
                    smallFilePlacementByHash.emplace(file.sha256, piece);
                }
            };

            for (auto& [extension, candidates] : groups)
            {
                static_cast<void>(extension);
                std::size_t nextCandidate = 0;
                while (nextCandidate < candidates.size())
                {
                    std::vector<SmallFile> files;
                    files.reserve((std::min)(maximumTextBatchFiles, candidates.size() - nextCandidate));
                    std::uintmax_t batchBytes = 0;
                    while (nextCandidate < candidates.size() && files.size() < maximumTextBatchFiles)
                    {
                        const SmallFileCandidate& candidate = candidates[nextCandidate];
                        if (!files.empty() && candidate.size > maximumTextBatchBytes - batchBytes)
                        {
                            break;
                        }

                        SmallFile file;
                        file.inputIndex = candidate.inputIndex;
                        file.bytes = readSmallFile(sourcePaths[candidate.inputIndex], candidate.size);
                        file.sha256 = computeFluxPackBytesSha256(file.bytes.data(), file.bytes.size());
                        references[file.inputIndex].size = file.bytes.size();
                        references[file.inputIndex].sha256 = file.sha256;
                        addChecked(logicalBytes_, file.bytes.size(), "logical small text bytes");
                        batchBytes += candidate.size;
                        if (progress)
                        {
                            progress(file.inputIndex, file.bytes.size());
                        }
                        files.push_back(std::move(file));
                        ++nextCandidate;
                    }
                    if (files.empty())
                    {
                        throw std::logic_error("FluxPack small text batch could not make progress.");
                    }
                    processSmallFileBatch(files);
                }
            }

            for (std::size_t index = 0; index < sourcePaths.size(); ++index)
            {
                if (grouped[index])
                {
                    continue;
                }
                references[index] = appendFile(
                    sourcePaths[index],
                    progress
                        ? std::function<void(std::uintmax_t)>([&progress, index](std::uintmax_t bytes)
                            {
                                progress(index, bytes);
                            })
                        : std::function<void(std::uintmax_t)>{});
            }
            return references;
        }

        FluxPackContentStoreStatistics statistics() const noexcept
        {
            return FluxPackContentStoreStatistics{
                compressionMode_,
                logicalBytes_,
                uniqueBytes_,
                storedBytes_,
                logicalBytes_ > uniqueBytes_ ? logicalBytes_ - uniqueBytes_ : 0,
                chunks_.size(),
                dictionaryHashes_.size()};
        }

        void finish(std::string_view manifestUtf8)
        {
            if (finished_)
            {
                throw std::logic_error("FluxPack package has already been finalized.");
            }
            if (manifestUtf8.empty() || manifestUtf8.size() > maxManifestBytes)
            {
                throw std::invalid_argument("FluxPack manifest is empty or exceeds the supported size.");
            }

            const std::uintmax_t manifestOffset = outputOffset(output_);
            output_.write(manifestUtf8.data(), static_cast<std::streamsize>(manifestUtf8.size()));
            output_.write(
                packageFooterMagicV3.data(),
                static_cast<std::streamsize>(packageFooterMagicV3.size()));
            writeUint64(output_, static_cast<std::uint64_t>(manifestOffset));
            writeUint64(output_, static_cast<std::uint64_t>(manifestUtf8.size()));
            output_.flush();
            if (!output_)
            {
                throw std::runtime_error("FluxPack manifest could not be finalized. Check free disk space and retry.");
            }
            output_.close();
            if (!output_)
            {
                throw std::runtime_error("FluxPack output could not be closed safely.");
            }
            finished_ = true;
        }

        const std::vector<FluxPackStoredChunk>& chunks() const noexcept
        {
            return chunks_;
        }

    private:
        std::ofstream output_;
        FluxPackCompressionMode compressionMode_;
        int compressionLevel_{0};
        ZSTD_CCtx* cctx_{nullptr};
        std::vector<FluxPackStoredChunk> chunks_;
        std::unordered_map<std::wstring, std::size_t> chunkIndexByHash_;
        std::unordered_set<std::wstring> payloadChunkHashes_;
        std::unordered_set<std::wstring> dictionaryHashes_;
        std::uintmax_t logicalBytes_{0};
        std::uintmax_t uniqueBytes_{0};
        std::uintmax_t storedBytes_{0};
        bool finished_{false};
    };

    FluxPackPackageWriter::FluxPackPackageWriter(
        const std::filesystem::path& path,
        FluxPackCompressionMode compressionMode)
        : impl_(std::make_unique<Impl>(path, compressionMode))
    {
    }

    FluxPackPackageWriter::~FluxPackPackageWriter() = default;

    FluxPackPayloadReference FluxPackPackageWriter::appendFile(
        const std::filesystem::path& sourcePath,
        const std::function<void(std::uintmax_t)>& progress)
    {
        return impl_->appendFile(sourcePath, progress);
    }

    std::vector<FluxPackPayloadReference> FluxPackPackageWriter::appendFiles(
        const std::vector<std::filesystem::path>& sourcePaths,
        const std::function<void(std::size_t, std::uintmax_t)>& progress)
    {
        return impl_->appendFiles(sourcePaths, progress);
    }

    const std::vector<FluxPackStoredChunk>& FluxPackPackageWriter::contentChunks() const noexcept
    {
        return impl_->chunks();
    }

    FluxPackContentStoreStatistics FluxPackPackageWriter::contentStoreStatistics() const noexcept
    {
        return impl_->statistics();
    }

    void FluxPackPackageWriter::finish(std::string_view manifestUtf8)
    {
        impl_->finish(manifestUtf8);
    }

    class FluxPackPackageReader::Impl final
    {
    public:
        explicit Impl(std::filesystem::path path)
            : path_(std::move(path)),
              input_(pathForFilesystemIo(path_), std::ios::in | std::ios::binary),
              dctx_(ZSTD_createDCtx())
        {
            const PackageLayout layout = readLayout(path_);
            version_ = layout.version;
            manifestOffset_ = layout.manifestOffset;
            manifestSize_ = layout.manifestSize;
            if (!input_)
            {
                throw std::runtime_error("FluxPack could not be opened.");
            }
            if (dctx_ == nullptr)
            {
                throw std::bad_alloc();
            }
        }

        ~Impl()
        {
            if (dctx_ != nullptr)
            {
                ZSTD_freeDCtx(dctx_);
            }
        }

        std::string readManifest() const
        {
            input_.clear();
            input_.seekg(checkedStreamOffset(manifestOffset_), std::ios::beg);
            if (!input_)
            {
                throw std::invalid_argument("FluxPack manifest could not be located.");
            }

            std::string manifest(static_cast<std::size_t>(manifestSize_), '\0');
            readExact(input_, manifest.data(), manifest.size(), "the manifest");
            return manifest;
        }

        void setContentStore(const std::vector<FluxPackStoredChunk>& chunks)
        {
            chunksByHash_.clear();
            for (const FluxPackStoredChunk& source : chunks)
            {
                FluxPackStoredChunk chunk = source;
                chunk.sha256 = lower(std::move(chunk.sha256));
                chunk.dictionarySha256 = lower(std::move(chunk.dictionarySha256));
                if (!isSha256(chunk.sha256))
                {
                    throw std::invalid_argument("FluxPack content chunk hash is invalid.");
                }
                const std::uintmax_t maximumOriginal = chunk.isDictionary
                    ? maximumReadableDictionaryBytes
                    : maximumReadableChunkBytes;
                if (chunk.originalSize == 0 || chunk.originalSize > maximumOriginal ||
                    chunk.storedSize == 0 ||
                    chunk.offset < packageHeaderV3.size() ||
                    chunk.offset > manifestOffset_ ||
                    chunk.storedSize > manifestOffset_ - chunk.offset)
                {
                    throw std::invalid_argument("FluxPack content chunk location or size is invalid.");
                }
                if (chunk.compression == FluxPackChunkCompression::None &&
                    chunk.storedSize != chunk.originalSize)
                {
                    throw std::invalid_argument("FluxPack uncompressed chunk sizes do not match.");
                }
                if (chunk.compression == FluxPackChunkCompression::Zstandard &&
                    (chunk.compressionLevel < 1 || chunk.compressionLevel > 22 ||
                     chunk.storedSize >= chunk.originalSize))
                {
                    throw std::invalid_argument("FluxPack Zstandard chunk metadata is invalid.");
                }
                if (!chunk.dictionarySha256.empty() && !isSha256(chunk.dictionarySha256))
                {
                    throw std::invalid_argument("FluxPack dictionary hash is invalid.");
                }
                if (!chunksByHash_.emplace(chunk.sha256, std::move(chunk)).second)
                {
                    throw std::invalid_argument("FluxPack content store contains a duplicate chunk hash.");
                }
            }

            for (const auto& [hash, chunk] : chunksByHash_)
            {
                static_cast<void>(hash);
                if (chunk.dictionarySha256.empty())
                {
                    continue;
                }
                const auto dictionary = chunksByHash_.find(chunk.dictionarySha256);
                if (dictionary == chunksByHash_.end() ||
                    !dictionary->second.isDictionary ||
                    dictionary->second.compression != FluxPackChunkCompression::None)
                {
                    throw std::invalid_argument("FluxPack content chunk references a missing or invalid dictionary.");
                }
            }
            contentStoreConfigured_ = true;
        }

        std::vector<char> readPhysicalChunk(const FluxPackStoredChunk& chunk) const
        {
            if (chunk.storedSize > static_cast<std::uintmax_t>(std::numeric_limits<std::size_t>::max()) ||
                chunk.originalSize > static_cast<std::uintmax_t>(std::numeric_limits<std::size_t>::max()))
            {
                throw std::invalid_argument("FluxPack content chunk is too large for this platform.");
            }

            input_.clear();
            input_.seekg(checkedStreamOffset(chunk.offset), std::ios::beg);
            if (!input_)
            {
                throw std::invalid_argument("FluxPack content chunk could not be located.");
            }
            std::vector<char> stored(static_cast<std::size_t>(chunk.storedSize));
            readExact(input_, stored.data(), stored.size(), "a content chunk");
            if (chunk.compression == FluxPackChunkCompression::None)
            {
                return stored;
            }

            std::vector<char> dictionary;
            if (!chunk.dictionarySha256.empty())
            {
                const auto dictionaryEntry = chunksByHash_.find(chunk.dictionarySha256);
                if (dictionaryEntry == chunksByHash_.end())
                {
                    throw std::invalid_argument("FluxPack content dictionary is missing.");
                }
                dictionary = readPhysicalChunk(dictionaryEntry->second);
                const std::wstring dictionaryHash = computeFluxPackBytesSha256(
                    dictionary.data(),
                    dictionary.size());
                if (!equalsIgnoreCase(dictionaryHash, dictionaryEntry->second.sha256))
                {
                    throw std::runtime_error("FluxPack content dictionary hash does not match the manifest.");
                }
            }

            std::vector<char> original(static_cast<std::size_t>(chunk.originalSize));
            const std::size_t decompressed = dictionary.empty()
                ? ZSTD_decompressDCtx(
                    dctx_,
                    original.data(),
                    original.size(),
                    stored.data(),
                    stored.size())
                : ZSTD_decompress_usingDict(
                    dctx_,
                    original.data(),
                    original.size(),
                    stored.data(),
                    stored.size(),
                    dictionary.data(),
                    dictionary.size());
            if (ZSTD_isError(decompressed))
            {
                throw std::runtime_error(
                    std::string("FluxPack Zstandard decompression failed: ") + ZSTD_getErrorName(decompressed));
            }
            if (decompressed != original.size())
            {
                throw std::runtime_error("FluxPack decompressed chunk size does not match the manifest.");
            }
            return original;
        }

        std::vector<char> readVerifiedChunk(const std::wstring& hash) const
        {
            const auto entry = chunksByHash_.find(lower(hash));
            if (entry == chunksByHash_.end())
            {
                throw std::invalid_argument("FluxPack payload references a missing content chunk.");
            }
            std::vector<char> original = readPhysicalChunk(entry->second);
            const std::wstring actualHash = computeFluxPackBytesSha256(
                original.data(),
                original.size());
            if (!equalsIgnoreCase(entry->second.sha256, actualHash))
            {
                throw std::runtime_error("FluxPack content chunk hash does not match the manifest.");
            }
            return original;
        }

        void extractPayload(
            const FluxPackPayloadReference& reference,
            const std::filesystem::path& targetPath,
            const std::function<void(std::uintmax_t)>& progress) const
        {
            std::ofstream output(
                pathForFilesystemIo(targetPath),
                std::ios::out | std::ios::trunc | std::ios::binary);
            if (!output)
            {
                throw std::runtime_error("FluxPack payload target could not be created.");
            }

            try
            {
                Sha256Hasher fileHasher;
                std::uintmax_t copied = 0;
                if (contentStoreConfigured_ || !reference.chunks.empty())
                {
                    if (!contentStoreConfigured_)
                    {
                        throw std::invalid_argument("FluxPack content store metadata was not configured.");
                    }
                    for (const FluxPackPayloadChunkReference& piece : reference.chunks)
                    {
                        std::vector<char> chunk = readVerifiedChunk(piece.sha256);
                        if (piece.size == 0 ||
                            piece.offset > chunk.size() ||
                            piece.size > chunk.size() - piece.offset)
                        {
                            throw std::invalid_argument("FluxPack payload chunk slice is invalid.");
                        }
                        if (piece.size > reference.size - copied)
                        {
                            throw std::invalid_argument("FluxPack payload chunks exceed the declared file size.");
                        }
                        const char* data = chunk.data() + static_cast<std::ptrdiff_t>(piece.offset);
                        output.write(data, static_cast<std::streamsize>(piece.size));
                        if (!output)
                        {
                            throw std::runtime_error("FluxPack payload could not be restored. Check free disk space and retry.");
                        }
                        fileHasher.update(data, static_cast<std::size_t>(piece.size));
                        copied += piece.size;
                        if (progress)
                        {
                            progress(copied);
                        }
                    }
                    if (copied != reference.size)
                    {
                        throw std::invalid_argument("FluxPack payload chunks do not match the declared file size.");
                    }
                }
                else
                {
                    if (reference.offset < packageHeaderV2.size() ||
                        reference.offset > manifestOffset_ ||
                        reference.size > manifestOffset_ - reference.offset)
                    {
                        throw std::invalid_argument("FluxPack payload location is outside the package data region.");
                    }

                    input_.clear();
                    input_.seekg(checkedStreamOffset(reference.offset), std::ios::beg);
                    if (!input_)
                    {
                        throw std::invalid_argument("FluxPack payload could not be located.");
                    }
                    std::vector<char> buffer(copyBufferBytes);
                    while (copied < reference.size)
                    {
                        const std::uintmax_t remaining = reference.size - copied;
                        const std::size_t chunkSize = static_cast<std::size_t>(
                            std::min<std::uintmax_t>(remaining, buffer.size()));
                        readExact(input_, buffer.data(), chunkSize, "an embedded payload");
                        output.write(buffer.data(), static_cast<std::streamsize>(chunkSize));
                        if (!output)
                        {
                            throw std::runtime_error("FluxPack payload could not be restored. Check free disk space and retry.");
                        }
                        fileHasher.update(buffer.data(), chunkSize);
                        copied += chunkSize;
                        if (progress)
                        {
                            progress(copied);
                        }
                    }
                }

                output.flush();
                output.close();
                if (!output)
                {
                    throw std::runtime_error("FluxPack payload target could not be closed safely.");
                }

                const std::wstring actualHash = fileHasher.finish();
                if (!reference.sha256.empty() && !equalsIgnoreCase(reference.sha256, actualHash))
                {
                    throw std::runtime_error("FluxPack payload hash does not match the manifest.");
                }
            }
            catch (...)
            {
                output.close();
                std::error_code cleanupError;
                std::filesystem::remove(pathForFilesystemIo(targetPath), cleanupError);
                throw;
            }
        }

        int version() const noexcept
        {
            return version_;
        }

    private:
        std::filesystem::path path_;
        int version_{0};
        std::uintmax_t manifestOffset_{0};
        std::uintmax_t manifestSize_{0};
        mutable std::ifstream input_;
        ZSTD_DCtx* dctx_{nullptr};
        std::unordered_map<std::wstring, FluxPackStoredChunk> chunksByHash_;
        bool contentStoreConfigured_{false};
    };

    FluxPackPackageReader::FluxPackPackageReader(std::filesystem::path path)
        : impl_(std::make_unique<Impl>(std::move(path)))
    {
    }

    FluxPackPackageReader::~FluxPackPackageReader() = default;
    FluxPackPackageReader::FluxPackPackageReader(FluxPackPackageReader&&) noexcept = default;
    FluxPackPackageReader& FluxPackPackageReader::operator=(FluxPackPackageReader&&) noexcept = default;

    bool FluxPackPackageReader::isPackage(const std::filesystem::path& path) noexcept
    {
        return isV2Package(path) || isV3Package(path);
    }

    bool FluxPackPackageReader::isV2Package(const std::filesystem::path& path) noexcept
    {
        try
        {
            std::ifstream input(pathForFilesystemIo(path), std::ios::in | std::ios::binary);
            std::array<char, packageHeaderV2.size()> header{};
            input.read(header.data(), static_cast<std::streamsize>(header.size()));
            return input.gcount() == static_cast<std::streamsize>(header.size()) && header == packageHeaderV2;
        }
        catch (...)
        {
            return false;
        }
    }

    bool FluxPackPackageReader::isV3Package(const std::filesystem::path& path) noexcept
    {
        try
        {
            std::ifstream input(pathForFilesystemIo(path), std::ios::in | std::ios::binary);
            std::array<char, packageHeaderV3.size()> header{};
            input.read(header.data(), static_cast<std::streamsize>(header.size()));
            return input.gcount() == static_cast<std::streamsize>(header.size()) && header == packageHeaderV3;
        }
        catch (...)
        {
            return false;
        }
    }

    int FluxPackPackageReader::containerVersion() const noexcept
    {
        return impl_->version();
    }

    std::string FluxPackPackageReader::readManifest() const
    {
        return impl_->readManifest();
    }

    void FluxPackPackageReader::setContentStore(const std::vector<FluxPackStoredChunk>& chunks)
    {
        impl_->setContentStore(chunks);
    }

    void FluxPackPackageReader::extractPayload(
        const FluxPackPayloadReference& reference,
        const std::filesystem::path& targetPath,
        const std::function<void(std::uintmax_t)>& progress) const
    {
        impl_->extractPayload(reference, targetPath, progress);
    }
}
