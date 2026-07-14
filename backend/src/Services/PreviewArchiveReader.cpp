#include "PreviewArchiveReader.hpp"

#include <zlib.h>

#include <algorithm>
#include <array>
#include <cctype>
#include <chrono>
#include <cwctype>
#include <fstream>
#include <functional>
#include <iomanip>
#include <map>
#include <memory>
#include <mutex>
#include <iterator>
#include <limits>
#include <set>
#include <sstream>
#include <stdexcept>
#include <string_view>
#include <thread>
#include <unordered_map>
#include <variant>

namespace fluxora
{
    namespace
    {
        constexpr std::uint64_t maxPreviewArchiveAssetBytes = 64ULL * 1024ULL * 1024ULL;
        constexpr std::uint32_t bsaSizeMask = 0x3fffffffU;
        constexpr std::uint32_t bsaCompressedMask = 0xc0000000U;
        constexpr std::uint32_t bsaFilesCompressedFlag = 0x004U;
        constexpr std::uint32_t bsaFilesPrefixedFlag = 0x100U;

        std::uint32_t readU32FromBytes(const std::vector<std::uint8_t>& bytes, std::size_t offset)
        {
            if (offset > bytes.size() || bytes.size() - offset < 4)
            {
                throw std::invalid_argument("Archive payload is truncated.");
            }

            return static_cast<std::uint32_t>(bytes[offset]) |
                (static_cast<std::uint32_t>(bytes[offset + 1]) << 8) |
                (static_cast<std::uint32_t>(bytes[offset + 2]) << 16) |
                (static_cast<std::uint32_t>(bytes[offset + 3]) << 24);
        }

        void appendU16(std::vector<std::uint8_t>& out, std::uint16_t value)
        {
            out.push_back(static_cast<std::uint8_t>(value & 0xffU));
            out.push_back(static_cast<std::uint8_t>((value >> 8) & 0xffU));
        }

        void appendU32(std::vector<std::uint8_t>& out, std::uint32_t value)
        {
            out.push_back(static_cast<std::uint8_t>(value & 0xffU));
            out.push_back(static_cast<std::uint8_t>((value >> 8) & 0xffU));
            out.push_back(static_cast<std::uint8_t>((value >> 16) & 0xffU));
            out.push_back(static_cast<std::uint8_t>((value >> 24) & 0xffU));
        }

        void appendZeroU32s(std::vector<std::uint8_t>& out, std::size_t count)
        {
            for (std::size_t index = 0; index < count; ++index)
            {
                appendU32(out, 0);
            }
        }

        std::string pathKeyFromUtf8(std::string value)
        {
            std::replace(value.begin(), value.end(), '\\', '/');
            while (!value.empty() && (value.front() == '/' || value.front() == '\0'))
            {
                value.erase(value.begin());
            }
            while (!value.empty() && value.back() == '\0')
            {
                value.pop_back();
            }

            std::transform(value.begin(), value.end(), value.begin(), [](unsigned char character)
            {
                return static_cast<char>(std::tolower(character));
            });

            if (value.starts_with("data/"))
            {
                value.erase(0, 5);
            }

            return value;
        }

        std::string pathKeyFromWide(std::wstring_view value)
        {
            const std::filesystem::path path{std::wstring(value)};
            const auto utf8 = path.generic_u8string();
            return pathKeyFromUtf8(std::string(
                reinterpret_cast<const char*>(utf8.data()),
                utf8.size()));
        }

        std::wstring archiveDisplayName(const std::filesystem::path& archivePath)
        {
            return archivePath.filename().wstring();
        }

        bool isSupportedArchivePath(const std::filesystem::path& path)
        {
            std::wstring extension = path.extension().wstring();
            std::transform(extension.begin(), extension.end(), extension.begin(), [](wchar_t character)
            {
                return static_cast<wchar_t>(std::towlower(character));
            });
            return extension == L".bsa" || extension == L".ba2";
        }

        class BinaryFile final
        {
        public:
            explicit BinaryFile(const std::filesystem::path& path)
                : file_(path, std::ios::binary)
            {
                if (!file_)
                {
                    throw std::invalid_argument("Preview archive could not be opened.");
                }

                file_.seekg(0, std::ios::end);
                const std::streamoff size = file_.tellg();
                if (size < 0)
                {
                    throw std::invalid_argument("Preview archive size could not be read.");
                }
                size_ = static_cast<std::uint64_t>(size);
                file_.seekg(0, std::ios::beg);
            }

            [[nodiscard]] std::uint64_t size() const noexcept
            {
                return size_;
            }

            void seek(std::uint64_t offset)
            {
                if (offset > size_)
                {
                    throw std::invalid_argument("Preview archive metadata is truncated.");
                }
                file_.seekg(static_cast<std::streamoff>(offset), std::ios::beg);
                if (!file_)
                {
                    throw std::invalid_argument("Preview archive seek failed.");
                }
            }

            [[nodiscard]] std::uint8_t readU8()
            {
                char byte{};
                file_.read(&byte, 1);
                if (file_.gcount() != 1)
                {
                    throw std::invalid_argument("Preview archive metadata is truncated.");
                }
                return static_cast<std::uint8_t>(byte);
            }

            [[nodiscard]] std::uint16_t readU16()
            {
                const std::uint8_t a = readU8();
                const std::uint8_t b = readU8();
                return static_cast<std::uint16_t>(a | (static_cast<std::uint16_t>(b) << 8));
            }

            [[nodiscard]] std::uint32_t readU32()
            {
                const std::uint32_t a = readU8();
                const std::uint32_t b = readU8();
                const std::uint32_t c = readU8();
                const std::uint32_t d = readU8();
                return a | (b << 8) | (c << 16) | (d << 24);
            }

            [[nodiscard]] std::uint64_t readU64()
            {
                std::uint64_t value = 0;
                for (int index = 0; index < 8; ++index)
                {
                    value |= static_cast<std::uint64_t>(readU8()) << (index * 8);
                }
                return value;
            }

            [[nodiscard]] std::string readString(std::size_t size)
            {
                if (size > static_cast<std::size_t>(std::numeric_limits<std::streamsize>::max()))
                {
                    throw std::invalid_argument("Preview archive string is too large.");
                }

                std::string value(size, '\0');
                if (size > 0)
                {
                    file_.read(value.data(), static_cast<std::streamsize>(size));
                    if (static_cast<std::size_t>(file_.gcount()) != size)
                    {
                        throw std::invalid_argument("Preview archive metadata is truncated.");
                    }
                }
                return value;
            }

            [[nodiscard]] std::string readCString()
            {
                std::string value;
                while (true)
                {
                    const std::uint8_t byte = readU8();
                    if (byte == 0)
                    {
                        break;
                    }
                    value.push_back(static_cast<char>(byte));
                }
                return value;
            }

            [[nodiscard]] std::uint64_t readVarInt()
            {
                std::uint64_t value = 0;
                int shift = 0;
                while (shift <= 63)
                {
                    const std::uint8_t byte = readU8();
                    value |= static_cast<std::uint64_t>(byte & 0x7fU) << shift;
                    if ((byte & 0x80U) == 0)
                    {
                        return value;
                    }
                    shift += 7;
                }
                throw std::invalid_argument("Preview archive variable integer is invalid.");
            }

            [[nodiscard]] std::vector<std::uint8_t> readAt(std::uint64_t offset, std::uint64_t count)
            {
                if (offset > size_ || count > size_ - offset)
                {
                    throw std::invalid_argument("Preview archive payload is truncated.");
                }
                if (count > maxPreviewArchiveAssetBytes)
                {
                    throw std::invalid_argument("Preview archive asset is too large.");
                }
                if (count > static_cast<std::uint64_t>(std::numeric_limits<std::streamsize>::max()))
                {
                    throw std::invalid_argument("Preview archive asset is too large.");
                }

                std::vector<std::uint8_t> bytes(static_cast<std::size_t>(count));
                if (!bytes.empty())
                {
                    seek(offset);
                    file_.read(
                        reinterpret_cast<char*>(bytes.data()),
                        static_cast<std::streamsize>(bytes.size()));
                    if (static_cast<std::size_t>(file_.gcount()) != bytes.size())
                    {
                        throw std::invalid_argument("Preview archive payload is truncated.");
                    }
                }
                return bytes;
            }

        private:
            std::ifstream file_;
            std::uint64_t size_{0};
        };

        std::vector<std::uint8_t> decompressZlib(
            const std::vector<std::uint8_t>& input,
            std::uint32_t expectedSize)
        {
            if (expectedSize > maxPreviewArchiveAssetBytes)
            {
                throw std::invalid_argument("Preview archive asset is too large.");
            }

            std::vector<std::uint8_t> output(expectedSize);
            uLongf outputSize = static_cast<uLongf>(output.size());
            const int result = uncompress(
                output.data(),
                &outputSize,
                input.data(),
                static_cast<uLong>(input.size()));
            if (result != Z_OK)
            {
                throw std::invalid_argument("Preview archive zlib payload could not be decompressed.");
            }

            output.resize(static_cast<std::size_t>(outputSize));
            return output;
        }

        std::uint64_t readLz4Length(const std::vector<std::uint8_t>& input, std::size_t& offset)
        {
            std::uint64_t length = 0;
            while (offset < input.size())
            {
                const std::uint8_t value = input[offset++];
                length += value;
                if (value != 255)
                {
                    return length;
                }
            }
            throw std::invalid_argument("Preview archive LZ4 payload is truncated.");
        }

        void appendLz4Block(
            const std::vector<std::uint8_t>& block,
            std::vector<std::uint8_t>& output,
            std::size_t historyStart)
        {
            std::size_t offset = 0;
            while (offset < block.size())
            {
                const std::uint8_t token = block[offset++];

                std::uint64_t literalLength = token >> 4;
                if (literalLength == 15)
                {
                    literalLength += readLz4Length(block, offset);
                }
                if (literalLength > block.size() - offset)
                {
                    throw std::invalid_argument("Preview archive LZ4 literals are truncated.");
                }
                if (output.size() + literalLength > maxPreviewArchiveAssetBytes)
                {
                    throw std::invalid_argument("Preview archive asset is too large.");
                }
                output.insert(output.end(), block.begin() + offset, block.begin() + offset + literalLength);
                offset += static_cast<std::size_t>(literalLength);

                if (offset == block.size())
                {
                    break;
                }
                if (block.size() - offset < 2)
                {
                    throw std::invalid_argument("Preview archive LZ4 match offset is truncated.");
                }

                const std::uint16_t matchOffset =
                    static_cast<std::uint16_t>(block[offset]) |
                    (static_cast<std::uint16_t>(block[offset + 1]) << 8);
                offset += 2;
                if (matchOffset == 0 || matchOffset > output.size() - historyStart)
                {
                    throw std::invalid_argument("Preview archive LZ4 match offset is invalid.");
                }

                std::uint64_t matchLength = (token & 0x0fU) + 4;
                if ((token & 0x0fU) == 15)
                {
                    matchLength += readLz4Length(block, offset);
                }
                if (output.size() + matchLength > maxPreviewArchiveAssetBytes)
                {
                    throw std::invalid_argument("Preview archive asset is too large.");
                }

                for (std::uint64_t index = 0; index < matchLength; ++index)
                {
                    output.push_back(output[output.size() - matchOffset]);
                }
            }
        }

        std::vector<std::uint8_t> decompressLz4Frame(
            const std::vector<std::uint8_t>& input,
            std::uint32_t expectedSize)
        {
            if (expectedSize > maxPreviewArchiveAssetBytes)
            {
                throw std::invalid_argument("Preview archive asset is too large.");
            }

            std::vector<std::uint8_t> output;
            output.reserve(expectedSize);
            if (input.size() < 4 ||
                input[0] != 0x04 ||
                input[1] != 0x22 ||
                input[2] != 0x4d ||
                input[3] != 0x18)
            {
                appendLz4Block(input, output, 0);
                return output;
            }

            std::size_t offset = 4;
            if (input.size() - offset < 3)
            {
                throw std::invalid_argument("Preview archive LZ4 frame is truncated.");
            }

            const std::uint8_t flags = input[offset++];
            offset += 1; // block descriptor
            if ((flags & 0x08U) != 0)
            {
                if (input.size() - offset < 8)
                {
                    throw std::invalid_argument("Preview archive LZ4 content size is truncated.");
                }
                offset += 8;
            }
            if ((flags & 0x01U) != 0)
            {
                if (input.size() - offset < 4)
                {
                    throw std::invalid_argument("Preview archive LZ4 dictionary id is truncated.");
                }
                offset += 4;
            }
            offset += 1; // header checksum
            const bool independentBlocks = (flags & 0x20U) != 0;
            const bool blockChecksum = (flags & 0x10U) != 0;

            while (true)
            {
                if (input.size() - offset < 4)
                {
                    throw std::invalid_argument("Preview archive LZ4 block header is truncated.");
                }
                const std::uint32_t blockSize = readU32FromBytes(input, offset);
                offset += 4;
                if (blockSize == 0)
                {
                    break;
                }

                const bool uncompressedBlock = (blockSize & 0x80000000U) != 0;
                const std::uint32_t payloadSize = blockSize & 0x7fffffffU;
                if (payloadSize > input.size() - offset)
                {
                    throw std::invalid_argument("Preview archive LZ4 block is truncated.");
                }
                if (uncompressedBlock)
                {
                    if (output.size() + payloadSize > maxPreviewArchiveAssetBytes)
                    {
                        throw std::invalid_argument("Preview archive asset is too large.");
                    }
                    output.insert(
                        output.end(),
                        input.begin() + offset,
                        input.begin() + offset + payloadSize);
                }
                else
                {
                    const std::vector<std::uint8_t> block(
                        input.begin() + offset,
                        input.begin() + offset + payloadSize);
                    appendLz4Block(block, output, independentBlocks ? output.size() : 0);
                }
                offset += payloadSize;
                if (blockChecksum)
                {
                    if (input.size() - offset < 4)
                    {
                        throw std::invalid_argument("Preview archive LZ4 block checksum is truncated.");
                    }
                    offset += 4;
                }
            }

            return output;
        }

        std::vector<std::uint8_t> trimBsaEmbeddedNamePrefix(std::vector<std::uint8_t> bytes)
        {
            if (bytes.empty())
            {
                return bytes;
            }

            const std::size_t prefixLength = bytes.front();
            if (prefixLength + 1 <= bytes.size())
            {
                bytes.erase(bytes.begin(), bytes.begin() + static_cast<std::ptrdiff_t>(prefixLength + 1));
            }
            return bytes;
        }

        struct BsaDirectoryRecord
        {
            std::uint32_t fileCount{0};
        };

        struct BsaFileRecord
        {
            std::string directoryName;
            std::uint32_t size{0};
            std::uint32_t offset{0};
        };

        std::optional<std::vector<std::uint8_t>> readBsaAsset(
            const std::filesystem::path& archivePath,
            const std::string& wantedPath)
        {
            BinaryFile file(archivePath);
            const std::string magic = file.readString(4);
            if (magic != std::string("BSA", 3) + '\0')
            {
                return std::nullopt;
            }

            const std::uint32_t version = file.readU32();
            if (version != 103 && version != 104 && version != 105)
            {
                return std::nullopt;
            }

            (void)file.readU32(); // directory offset
            const std::uint32_t archiveFlags = file.readU32();
            const std::uint32_t directoryCount = file.readU32();
            const std::uint32_t fileCount = file.readU32();
            (void)file.readU32(); // directory names length
            (void)file.readU32(); // file names length
            (void)file.readU32(); // file flags

            std::vector<BsaDirectoryRecord> directories;
            directories.reserve(directoryCount);
            for (std::uint32_t index = 0; index < directoryCount; ++index)
            {
                (void)file.readU64(); // folder hash
                BsaDirectoryRecord record{};
                record.fileCount = file.readU32();
                if (version >= 105)
                {
                    (void)file.readU32();
                    (void)file.readU64();
                }
                else
                {
                    (void)file.readU32();
                }
                directories.push_back(record);
            }

            std::vector<BsaFileRecord> records;
            records.reserve(fileCount);
            for (const BsaDirectoryRecord& directory : directories)
            {
                std::string directoryName;
                if ((archiveFlags & 0x001U) != 0)
                {
                    const std::uint64_t length = file.readVarInt();
                    if (length > 4096)
                    {
                        throw std::invalid_argument("Preview archive directory name is too long.");
                    }
                    directoryName = pathKeyFromUtf8(file.readString(static_cast<std::size_t>(length)));
                }

                for (std::uint32_t index = 0; index < directory.fileCount; ++index)
                {
                    (void)file.readU64(); // file hash
                    BsaFileRecord record{};
                    record.directoryName = directoryName;
                    record.size = file.readU32();
                    record.offset = file.readU32();
                    records.push_back(std::move(record));
                }
            }

            std::vector<std::string> fileNames;
            fileNames.reserve(fileCount);
            if ((archiveFlags & 0x002U) != 0)
            {
                for (std::uint32_t index = 0; index < fileCount; ++index)
                {
                    fileNames.push_back(pathKeyFromUtf8(file.readCString()));
                }
            }

            for (std::size_t index = 0; index < records.size(); ++index)
            {
                const std::string fileName = index < fileNames.size() ? fileNames[index] : std::string{};
                const std::string entryPath = records[index].directoryName.empty()
                    ? fileName
                    : records[index].directoryName + "/" + fileName;
                if (entryPath != wantedPath)
                {
                    continue;
                }

                const bool sizeFlag = (records[index].size & bsaCompressedMask) != 0;
                const bool compressed = ((archiveFlags & bsaFilesCompressedFlag) != 0) != sizeFlag;
                const std::uint32_t storedSize = records[index].size & bsaSizeMask;
                std::vector<std::uint8_t> payload = file.readAt(records[index].offset, storedSize);

                if ((archiveFlags & bsaFilesPrefixedFlag) != 0)
                {
                    payload = trimBsaEmbeddedNamePrefix(std::move(payload));
                }

                if (compressed)
                {
                    if (payload.size() < 4)
                    {
                        throw std::invalid_argument("Preview archive compressed payload is truncated.");
                    }
                    const std::uint32_t expectedSize = readU32FromBytes(payload, 0);
                    const std::vector<std::uint8_t> compressedPayload(payload.begin() + 4, payload.end());
                    payload = version >= 105
                        ? decompressLz4Frame(compressedPayload, expectedSize)
                        : decompressZlib(compressedPayload, expectedSize);
                }

                if (payload.size() > maxPreviewArchiveAssetBytes)
                {
                    throw std::invalid_argument("Preview archive asset is too large.");
                }
                return payload;
            }

            return std::nullopt;
        }

        struct Ba2GeneralRecord
        {
            std::uint64_t offset{0};
            std::uint32_t packedSize{0};
            std::uint32_t unpackedSize{0};
        };

        struct Ba2TextureChunk
        {
            std::uint64_t offset{0};
            std::uint32_t packedSize{0};
            std::uint32_t unpackedSize{0};
        };

        struct Ba2TextureRecord
        {
            std::uint16_t height{0};
            std::uint16_t width{0};
            std::uint8_t mipCount{0};
            std::uint8_t format{0};
            std::uint16_t flags{0};
            std::vector<Ba2TextureChunk> chunks;
        };

        std::string readBa2Name(BinaryFile& file)
        {
            const std::uint16_t length = file.readU16();
            return pathKeyFromUtf8(file.readString(length));
        }

        std::vector<std::uint8_t> readBa2Payload(
            BinaryFile& file,
            std::uint64_t offset,
            std::uint32_t packedSize,
            std::uint32_t unpackedSize)
        {
            const std::uint32_t storedSize = packedSize == 0 ? unpackedSize : packedSize;
            std::vector<std::uint8_t> payload = file.readAt(offset, storedSize);
            if (packedSize > 0)
            {
                payload = decompressZlib(payload, unpackedSize);
            }
            return payload;
        }

        std::uint32_t makeFourCc(char a, char b, char c, char d)
        {
            return static_cast<std::uint32_t>(static_cast<unsigned char>(a)) |
                (static_cast<std::uint32_t>(static_cast<unsigned char>(b)) << 8) |
                (static_cast<std::uint32_t>(static_cast<unsigned char>(c)) << 16) |
                (static_cast<std::uint32_t>(static_cast<unsigned char>(d)) << 24);
        }

        std::uint32_t ba2LinearSize(std::uint16_t width, std::uint16_t height, std::uint8_t format)
        {
            switch (format)
            {
            case 71:
            case 72:
                return std::max<std::uint32_t>(1, width) * std::max<std::uint32_t>(1, height) / 2;
            case 74:
            case 75:
            case 77:
            case 78:
            case 83:
            case 84:
            case 98:
            case 99:
                return std::max<std::uint32_t>(1, width) * std::max<std::uint32_t>(1, height);
            case 87:
            case 91:
                return std::max<std::uint32_t>(1, width) * std::max<std::uint32_t>(1, height) * 4;
            case 61:
                return std::max<std::uint32_t>(1, width) * std::max<std::uint32_t>(1, height);
            default:
                return std::max<std::uint32_t>(1, width) * std::max<std::uint32_t>(1, height);
            }
        }

        std::vector<std::uint8_t> buildDdsHeader(const Ba2TextureRecord& texture)
        {
            constexpr std::uint32_t ddsdCaps = 0x00000001U;
            constexpr std::uint32_t ddsdHeight = 0x00000002U;
            constexpr std::uint32_t ddsdWidth = 0x00000004U;
            constexpr std::uint32_t ddsdPitch = 0x00000008U;
            constexpr std::uint32_t ddsdPixelFormat = 0x00001000U;
            constexpr std::uint32_t ddsdMipMapCount = 0x00020000U;
            constexpr std::uint32_t ddsdLinearSize = 0x00080000U;
            constexpr std::uint32_t ddpfAlphaPixels = 0x00000001U;
            constexpr std::uint32_t ddpfFourCc = 0x00000004U;
            constexpr std::uint32_t ddpfRgb = 0x00000040U;
            constexpr std::uint32_t ddsCapsComplex = 0x00000008U;
            constexpr std::uint32_t ddsCapsTexture = 0x00001000U;
            constexpr std::uint32_t ddsCapsMipMap = 0x00400000U;
            constexpr std::uint32_t ddsCaps2CubeMap = 0x00000200U;
            constexpr std::uint32_t ddsCaps2CubeMapAllFaces =
                0x00000400U | 0x00000800U | 0x00001000U | 0x00002000U | 0x00004000U | 0x00008000U;

            std::uint32_t pixelFlags = 0;
            std::uint32_t fourCc = 0;
            std::uint32_t rgbBitCount = 0;
            std::uint32_t rMask = 0;
            std::uint32_t gMask = 0;
            std::uint32_t bMask = 0;
            std::uint32_t aMask = 0;
            bool dx10 = false;

            switch (texture.format)
            {
            case 71:
            case 72:
                pixelFlags = ddpfFourCc;
                fourCc = makeFourCc('D', 'X', 'T', '1');
                break;
            case 74:
            case 75:
                pixelFlags = ddpfFourCc;
                fourCc = makeFourCc('D', 'X', 'T', '3');
                break;
            case 77:
            case 78:
                pixelFlags = ddpfFourCc;
                fourCc = makeFourCc('D', 'X', 'T', '5');
                break;
            case 83:
            case 84:
                pixelFlags = ddpfFourCc;
                fourCc = makeFourCc('A', 'T', 'I', '2');
                break;
            case 98:
            case 99:
                pixelFlags = ddpfFourCc;
                fourCc = makeFourCc('D', 'X', '1', '0');
                dx10 = true;
                break;
            case 87:
            case 91:
                pixelFlags = ddpfRgb | ddpfAlphaPixels;
                rgbBitCount = 32;
                rMask = 0x00ff0000U;
                gMask = 0x0000ff00U;
                bMask = 0x000000ffU;
                aMask = 0xff000000U;
                break;
            case 61:
                pixelFlags = ddpfRgb;
                rgbBitCount = 8;
                rMask = 0x000000ffU;
                break;
            default:
                pixelFlags = ddpfFourCc;
                fourCc = makeFourCc('D', 'X', '1', '0');
                dx10 = true;
                break;
            }

            std::vector<std::uint8_t> header;
            header.reserve(dx10 ? 148 : 128);
            header.insert(header.end(), {'D', 'D', 'S', ' '});
            appendU32(header, 124);
            const bool hasMips = texture.mipCount > 1;
            const bool usesPitch = (pixelFlags & ddpfRgb) != 0 && (pixelFlags & ddpfFourCc) == 0;
            appendU32(
                header,
                ddsdCaps |
                    ddsdHeight |
                    ddsdWidth |
                    ddsdPixelFormat |
                    (hasMips ? ddsdMipMapCount : 0) |
                    (usesPitch ? ddsdPitch : ddsdLinearSize));
            appendU32(header, texture.height);
            appendU32(header, texture.width);
            appendU32(header, ba2LinearSize(texture.width, texture.height, texture.format));
            appendU32(header, 0);
            appendU32(header, texture.mipCount);
            appendZeroU32s(header, 11);

            appendU32(header, 32);
            appendU32(header, pixelFlags);
            appendU32(header, fourCc);
            appendU32(header, rgbBitCount);
            appendU32(header, rMask);
            appendU32(header, gMask);
            appendU32(header, bMask);
            appendU32(header, aMask);

            appendU32(header, ddsCapsTexture | (hasMips ? (ddsCapsComplex | ddsCapsMipMap) : 0));
            appendU32(header, texture.flags == 2049 ? (ddsCaps2CubeMap | ddsCaps2CubeMapAllFaces) : 0);
            appendU32(header, 0);
            appendU32(header, 0);
            appendU32(header, 0);

            if (dx10)
            {
                appendU32(header, texture.format);
                appendU32(header, 3);
                appendU32(header, texture.flags == 2049 ? 0x00000004U : 0);
                appendU32(header, texture.flags == 2049 ? 6 : 1);
                appendU32(header, 0);
            }

            return header;
        }

        std::optional<std::vector<std::uint8_t>> readBa2Asset(
            const std::filesystem::path& archivePath,
            const std::string& wantedPath)
        {
            BinaryFile file(archivePath);
            const std::string magic = file.readString(4);
            if (magic != "BTDX")
            {
                return std::nullopt;
            }

            (void)file.readU32(); // version
            const std::string type = file.readString(4);
            const std::uint32_t fileCount = file.readU32();
            const std::uint64_t namesOffset = file.readU64();

            if (type == "GNRL")
            {
                std::vector<Ba2GeneralRecord> records;
                records.reserve(fileCount);
                for (std::uint32_t index = 0; index < fileCount; ++index)
                {
                    (void)file.readU32();
                    (void)file.readString(4);
                    (void)file.readU32();
                    (void)file.readU32();
                    Ba2GeneralRecord record{};
                    record.offset = file.readU64();
                    record.packedSize = file.readU32();
                    record.unpackedSize = file.readU32();
                    (void)file.readU32();
                    records.push_back(record);
                }

                file.seek(namesOffset);
                for (std::uint32_t index = 0; index < fileCount; ++index)
                {
                    const std::string name = readBa2Name(file);
                    if (name == wantedPath)
                    {
                        return readBa2Payload(
                            file,
                            records[index].offset,
                            records[index].packedSize,
                            records[index].unpackedSize);
                    }
                }
                return std::nullopt;
            }

            if (type != "DX10")
            {
                return std::nullopt;
            }

            std::vector<Ba2TextureRecord> records;
            records.reserve(fileCount);
            for (std::uint32_t index = 0; index < fileCount; ++index)
            {
                (void)file.readU32();
                (void)file.readString(4);
                (void)file.readU32();
                (void)file.readU8();
                const std::uint8_t chunkCount = file.readU8();
                const std::uint16_t chunkHeaderSize = file.readU16();

                Ba2TextureRecord record{};
                record.height = file.readU16();
                record.width = file.readU16();
                record.mipCount = file.readU8();
                record.format = file.readU8();
                record.flags = file.readU16();
                record.chunks.reserve(chunkCount);

                for (std::uint8_t chunk = 0; chunk < chunkCount; ++chunk)
                {
                    Ba2TextureChunk item{};
                    item.offset = file.readU64();
                    item.packedSize = file.readU32();
                    item.unpackedSize = file.readU32();
                    (void)file.readU16();
                    (void)file.readU16();
                    (void)file.readU32();
                    if (chunkHeaderSize > 24)
                    {
                        (void)file.readString(chunkHeaderSize - 24);
                    }
                    record.chunks.push_back(item);
                }

                records.push_back(std::move(record));
            }

            file.seek(namesOffset);
            for (std::uint32_t index = 0; index < fileCount; ++index)
            {
                const std::string name = readBa2Name(file);
                if (name != wantedPath)
                {
                    continue;
                }

                std::vector<std::uint8_t> dds = buildDdsHeader(records[index]);
                for (const Ba2TextureChunk& chunk : records[index].chunks)
                {
                    std::vector<std::uint8_t> payload =
                        readBa2Payload(file, chunk.offset, chunk.packedSize, chunk.unpackedSize);
                    if (dds.size() + payload.size() > maxPreviewArchiveAssetBytes)
                    {
                        throw std::invalid_argument("Preview archive asset is too large.");
                    }
                    dds.insert(dds.end(), payload.begin(), payload.end());
                }
                return dds;
            }

            return std::nullopt;
        }

        std::optional<std::vector<std::uint8_t>> readArchiveAsset(
            const std::filesystem::path& archivePath,
            const std::string& wantedPath)
        {
            std::wstring extension = archivePath.extension().wstring();
            std::transform(extension.begin(), extension.end(), extension.begin(), [](wchar_t character)
            {
                return static_cast<wchar_t>(std::towlower(character));
            });

            if (extension == L".bsa")
            {
                return readBsaAsset(archivePath, wantedPath);
            }
            if (extension == L".ba2")
            {
                return readBa2Asset(archivePath, wantedPath);
            }
            return std::nullopt;
        }

        struct IndexedBsaEntry
        {
            std::uint32_t version{0};
            std::uint32_t archiveFlags{0};
            std::uint32_t storedSize{0};
            std::uint32_t offset{0};
            bool compressed{false};
        };

        struct IndexedBa2GeneralEntry
        {
            Ba2GeneralRecord record;
        };

        struct IndexedBa2TextureEntry
        {
            Ba2TextureRecord record;
        };

        using IndexedArchiveEntry = std::variant<
            IndexedBsaEntry,
            IndexedBa2GeneralEntry,
            IndexedBa2TextureEntry>;

        struct ArchiveFingerprint
        {
            std::string canonicalKey;
            std::string value;
            std::string sourceHash;
            std::string fingerprintHash;
        };

        struct CachedArchiveIndex
        {
            std::filesystem::path archivePath;
            ArchiveFingerprint fingerprint;
            std::unordered_map<std::string, IndexedArchiveEntry> entries;
        };

        constexpr std::size_t maxPreviewArchiveEntries = 1'000'000;
        constexpr std::uintmax_t maxPreviewArchiveCacheBytes = 512ULL * 1024ULL * 1024ULL;
        std::mutex archiveIndexMutex;
        std::unordered_map<std::string, std::shared_ptr<CachedArchiveIndex>> archiveIndexes;

        std::string pathUtf8(const std::filesystem::path& path)
        {
            const auto utf8 = path.generic_u8string();
            return std::string(reinterpret_cast<const char*>(utf8.data()), utf8.size());
        }

        std::string hashHex(std::string_view value)
        {
            std::uint64_t hash = 1469598103934665603ULL;
            for (unsigned char character : value)
            {
                hash ^= character;
                hash *= 1099511628211ULL;
            }
            std::ostringstream stream;
            stream << std::hex << std::setw(16) << std::setfill('0') << hash;
            return stream.str();
        }

        ArchiveFingerprint fingerprintForArchive(const std::filesystem::path& archivePath)
        {
            std::error_code canonicalError;
            std::filesystem::path canonical = std::filesystem::weakly_canonical(archivePath, canonicalError);
            if (canonicalError)
            {
                canonical = archivePath.lexically_normal();
            }
            std::string canonicalKey = pathUtf8(canonical);
#ifdef _WIN32
            std::transform(canonicalKey.begin(), canonicalKey.end(), canonicalKey.begin(), [](unsigned char value)
            {
                return static_cast<char>(std::tolower(value));
            });
#endif
            std::error_code sizeError;
            const std::uintmax_t size = std::filesystem::file_size(archivePath, sizeError);
            if (sizeError)
            {
                throw std::invalid_argument("Preview archive size could not be read.");
            }
            std::error_code timeError;
            const auto modified = std::filesystem::last_write_time(archivePath, timeError);
            if (timeError)
            {
                throw std::invalid_argument("Preview archive timestamp could not be read.");
            }
            const std::string value = canonicalKey + ':' + std::to_string(size) + ':' +
                std::to_string(modified.time_since_epoch().count());
            return ArchiveFingerprint{
                canonicalKey,
                value,
                hashHex(canonicalKey),
                hashHex(value)
            };
        }

        std::shared_ptr<CachedArchiveIndex> buildBsaIndex(
            const std::filesystem::path& archivePath,
            ArchiveFingerprint fingerprint)
        {
            BinaryFile file(archivePath);
            if (file.readString(4) != std::string("BSA", 3) + '\0')
            {
                return std::make_shared<CachedArchiveIndex>(CachedArchiveIndex{
                    archivePath,
                    std::move(fingerprint),
                    {}});
            }
            const std::uint32_t version = file.readU32();
            if (version != 103 && version != 104 && version != 105)
            {
                return std::make_shared<CachedArchiveIndex>(CachedArchiveIndex{
                    archivePath,
                    std::move(fingerprint),
                    {}});
            }
            (void)file.readU32();
            const std::uint32_t archiveFlags = file.readU32();
            const std::uint32_t directoryCount = file.readU32();
            const std::uint32_t fileCount = file.readU32();
            (void)file.readU32();
            (void)file.readU32();
            (void)file.readU32();
            if (directoryCount > maxPreviewArchiveEntries || fileCount > maxPreviewArchiveEntries)
            {
                throw std::invalid_argument("Preview archive index is too large.");
            }

            std::vector<BsaDirectoryRecord> directories;
            directories.reserve(directoryCount);
            for (std::uint32_t index = 0; index < directoryCount; ++index)
            {
                (void)file.readU64();
                BsaDirectoryRecord record{};
                record.fileCount = file.readU32();
                if (version >= 105)
                {
                    (void)file.readU32();
                    (void)file.readU64();
                }
                else
                {
                    (void)file.readU32();
                }
                directories.push_back(record);
            }

            std::vector<BsaFileRecord> records;
            records.reserve(fileCount);
            for (const BsaDirectoryRecord& directory : directories)
            {
                std::string directoryName;
                if ((archiveFlags & 0x001U) != 0)
                {
                    const std::uint64_t length = file.readVarInt();
                    if (length > 4096)
                    {
                        throw std::invalid_argument("Preview archive directory name is too long.");
                    }
                    directoryName = pathKeyFromUtf8(file.readString(static_cast<std::size_t>(length)));
                }
                for (std::uint32_t index = 0; index < directory.fileCount; ++index)
                {
                    (void)file.readU64();
                    BsaFileRecord record{};
                    record.directoryName = directoryName;
                    record.size = file.readU32();
                    record.offset = file.readU32();
                    records.push_back(std::move(record));
                }
            }

            std::vector<std::string> fileNames;
            fileNames.reserve(fileCount);
            if ((archiveFlags & 0x002U) != 0)
            {
                for (std::uint32_t index = 0; index < fileCount; ++index)
                {
                    fileNames.push_back(pathKeyFromUtf8(file.readCString()));
                }
            }

            auto result = std::make_shared<CachedArchiveIndex>();
            result->archivePath = archivePath;
            result->fingerprint = std::move(fingerprint);
            result->entries.reserve(records.size());
            for (std::size_t index = 0; index < records.size(); ++index)
            {
                const std::string fileName = index < fileNames.size() ? fileNames[index] : std::string{};
                const std::string entryPath = records[index].directoryName.empty()
                    ? fileName
                    : records[index].directoryName + '/' + fileName;
                if (entryPath.empty())
                {
                    continue;
                }
                const bool sizeFlag = (records[index].size & bsaCompressedMask) != 0;
                result->entries.emplace(
                    entryPath,
                    IndexedBsaEntry{
                        version,
                        archiveFlags,
                        records[index].size & bsaSizeMask,
                        records[index].offset,
                        ((archiveFlags & bsaFilesCompressedFlag) != 0) != sizeFlag
                    });
            }
            return result;
        }

        std::shared_ptr<CachedArchiveIndex> buildBa2Index(
            const std::filesystem::path& archivePath,
            ArchiveFingerprint fingerprint)
        {
            BinaryFile file(archivePath);
            if (file.readString(4) != "BTDX")
            {
                return std::make_shared<CachedArchiveIndex>(CachedArchiveIndex{
                    archivePath,
                    std::move(fingerprint),
                    {}});
            }
            (void)file.readU32();
            const std::string type = file.readString(4);
            const std::uint32_t fileCount = file.readU32();
            const std::uint64_t namesOffset = file.readU64();
            if (fileCount > maxPreviewArchiveEntries)
            {
                throw std::invalid_argument("Preview archive index is too large.");
            }

            auto result = std::make_shared<CachedArchiveIndex>();
            result->archivePath = archivePath;
            result->fingerprint = std::move(fingerprint);
            result->entries.reserve(fileCount);
            if (type == "GNRL")
            {
                std::vector<Ba2GeneralRecord> records;
                records.reserve(fileCount);
                for (std::uint32_t index = 0; index < fileCount; ++index)
                {
                    (void)file.readU32();
                    (void)file.readString(4);
                    (void)file.readU32();
                    (void)file.readU32();
                    Ba2GeneralRecord record{};
                    record.offset = file.readU64();
                    record.packedSize = file.readU32();
                    record.unpackedSize = file.readU32();
                    (void)file.readU32();
                    records.push_back(record);
                }
                file.seek(namesOffset);
                for (std::uint32_t index = 0; index < fileCount; ++index)
                {
                    result->entries.emplace(readBa2Name(file), IndexedBa2GeneralEntry{records[index]});
                }
                return result;
            }
            if (type != "DX10")
            {
                return result;
            }

            std::vector<Ba2TextureRecord> records;
            records.reserve(fileCount);
            for (std::uint32_t index = 0; index < fileCount; ++index)
            {
                (void)file.readU32();
                (void)file.readString(4);
                (void)file.readU32();
                (void)file.readU8();
                const std::uint8_t chunkCount = file.readU8();
                const std::uint16_t chunkHeaderSize = file.readU16();
                Ba2TextureRecord record{};
                record.height = file.readU16();
                record.width = file.readU16();
                record.mipCount = file.readU8();
                record.format = file.readU8();
                record.flags = file.readU16();
                record.chunks.reserve(chunkCount);
                for (std::uint8_t chunk = 0; chunk < chunkCount; ++chunk)
                {
                    Ba2TextureChunk item{};
                    item.offset = file.readU64();
                    item.packedSize = file.readU32();
                    item.unpackedSize = file.readU32();
                    (void)file.readU16();
                    (void)file.readU16();
                    (void)file.readU32();
                    if (chunkHeaderSize > 24)
                    {
                        (void)file.readString(chunkHeaderSize - 24);
                    }
                    record.chunks.push_back(item);
                }
                records.push_back(std::move(record));
            }
            file.seek(namesOffset);
            for (std::uint32_t index = 0; index < fileCount; ++index)
            {
                result->entries.emplace(readBa2Name(file), IndexedBa2TextureEntry{std::move(records[index])});
            }
            return result;
        }

        std::shared_ptr<CachedArchiveIndex> buildArchiveIndex(
            const std::filesystem::path& archivePath,
            ArchiveFingerprint fingerprint)
        {
            std::wstring extension = archivePath.extension().wstring();
            std::transform(extension.begin(), extension.end(), extension.begin(), [](wchar_t character)
            {
                return static_cast<wchar_t>(std::towlower(character));
            });
            if (extension == L".bsa")
            {
                return buildBsaIndex(archivePath, std::move(fingerprint));
            }
            return buildBa2Index(archivePath, std::move(fingerprint));
        }

        void invalidateArchiveAssetCache(
            const std::filesystem::path& cacheDirectory,
            const ArchiveFingerprint& fingerprint)
        {
            std::error_code directoryError;
            if (!std::filesystem::is_directory(cacheDirectory, directoryError) || directoryError)
            {
                return;
            }
            const std::string sourcePrefix = fingerprint.sourceHash + '-';
            const std::string currentPrefix = sourcePrefix + fingerprint.fingerprintHash + '-';
            std::error_code iterateError;
            for (const auto& entry : std::filesystem::directory_iterator(cacheDirectory, iterateError))
            {
                if (iterateError)
                {
                    break;
                }
                const std::string name = pathUtf8(entry.path().filename());
                if (name.starts_with(sourcePrefix) && !name.starts_with(currentPrefix))
                {
                    std::error_code removeError;
                    std::filesystem::remove(entry.path(), removeError);
                }
            }
        }

        std::shared_ptr<CachedArchiveIndex> cachedArchiveIndex(
            const std::filesystem::path& archivePath,
            const std::filesystem::path& cacheDirectory,
            PreviewArchiveBatchResult& stats)
        {
            ArchiveFingerprint fingerprint = fingerprintForArchive(archivePath);
            std::scoped_lock lock(archiveIndexMutex);
            const auto found = archiveIndexes.find(fingerprint.canonicalKey);
            if (found != archiveIndexes.end() && found->second->fingerprint.value == fingerprint.value)
            {
                ++stats.indexHits;
                return found->second;
            }

            ++stats.indexMisses;
            invalidateArchiveAssetCache(cacheDirectory, fingerprint);
            std::shared_ptr<CachedArchiveIndex> built = buildArchiveIndex(archivePath, std::move(fingerprint));
            archiveIndexes[built->fingerprint.canonicalKey] = built;
            return built;
        }

        std::vector<std::uint8_t> extractIndexedArchiveEntry(
            const CachedArchiveIndex& index,
            const IndexedArchiveEntry& entry)
        {
            BinaryFile file(index.archivePath);
            if (const auto* bsa = std::get_if<IndexedBsaEntry>(&entry))
            {
                std::vector<std::uint8_t> payload = file.readAt(bsa->offset, bsa->storedSize);
                if ((bsa->archiveFlags & bsaFilesPrefixedFlag) != 0)
                {
                    payload = trimBsaEmbeddedNamePrefix(std::move(payload));
                }
                if (bsa->compressed)
                {
                    if (payload.size() < 4)
                    {
                        throw std::invalid_argument("Preview archive compressed payload is truncated.");
                    }
                    const std::uint32_t expectedSize = readU32FromBytes(payload, 0);
                    const std::vector<std::uint8_t> compressed(payload.begin() + 4, payload.end());
                    payload = bsa->version >= 105
                        ? decompressLz4Frame(compressed, expectedSize)
                        : decompressZlib(compressed, expectedSize);
                }
                return payload;
            }
            if (const auto* general = std::get_if<IndexedBa2GeneralEntry>(&entry))
            {
                return readBa2Payload(
                    file,
                    general->record.offset,
                    general->record.packedSize,
                    general->record.unpackedSize);
            }

            const auto& texture = std::get<IndexedBa2TextureEntry>(entry).record;
            std::vector<std::uint8_t> dds = buildDdsHeader(texture);
            for (const Ba2TextureChunk& chunk : texture.chunks)
            {
                std::vector<std::uint8_t> payload = readBa2Payload(
                    file,
                    chunk.offset,
                    chunk.packedSize,
                    chunk.unpackedSize);
                if (dds.size() + payload.size() > maxPreviewArchiveAssetBytes)
                {
                    throw std::invalid_argument("Preview archive asset is too large.");
                }
                dds.insert(dds.end(), payload.begin(), payload.end());
            }
            return dds;
        }

        std::filesystem::path archiveAssetCachePath(
            const std::filesystem::path& cacheDirectory,
            const CachedArchiveIndex& index,
            const std::filesystem::path& relativePath)
        {
            std::wstring extension = relativePath.extension().wstring();
            std::transform(extension.begin(), extension.end(), extension.begin(), [](wchar_t character)
            {
                return static_cast<wchar_t>(std::towlower(character));
            });
            return cacheDirectory /
                std::filesystem::path(
                    index.fingerprint.sourceHash + '-' +
                    index.fingerprint.fingerprintHash + '-' +
                    hashHex(pathKeyFromWide(relativePath.generic_wstring())) +
                    pathUtf8(std::filesystem::path(extension)));
        }

        void pruneArchiveAssetCache(
            const std::filesystem::path& cacheDirectory,
            std::uintmax_t maxBytes)
        {
            struct CacheFile
            {
                std::filesystem::path path;
                std::uintmax_t size{0};
                std::filesystem::file_time_type modified{};
            };
            std::vector<CacheFile> files;
            std::uintmax_t total = 0;
            std::error_code iterateError;
            for (const auto& entry : std::filesystem::directory_iterator(cacheDirectory, iterateError))
            {
                if (iterateError)
                {
                    break;
                }
                std::error_code typeError;
                if (!entry.is_regular_file(typeError) || typeError)
                {
                    continue;
                }
                const std::string name = pathUtf8(entry.path().filename());
                if (name.find(".tmp-") != std::string::npos)
                {
                    std::error_code removeError;
                    std::filesystem::remove(entry.path(), removeError);
                    continue;
                }
                std::error_code sizeError;
                std::error_code timeError;
                const std::uintmax_t size = entry.file_size(sizeError);
                const auto modified = entry.last_write_time(timeError);
                if (sizeError || timeError)
                {
                    continue;
                }
                total += size;
                files.push_back(CacheFile{entry.path(), size, modified});
            }
            std::sort(files.begin(), files.end(), [](const CacheFile& left, const CacheFile& right)
            {
                return left.modified < right.modified;
            });
            for (const CacheFile& file : files)
            {
                if (total <= maxBytes)
                {
                    break;
                }
                std::error_code removeError;
                if (std::filesystem::remove(file.path, removeError) && !removeError)
                {
                    total -= file.size;
                }
            }
        }

        void writeArchiveCacheFileAtomically(
            const std::filesystem::path& target,
            const std::vector<std::uint8_t>& bytes)
        {
            if (bytes.size() > maxPreviewArchiveAssetBytes)
            {
                throw std::invalid_argument("Preview archive asset is too large.");
            }
            std::filesystem::create_directories(target.parent_path());
            const std::string nonce = hashHex(
                std::to_string(std::chrono::steady_clock::now().time_since_epoch().count()) + ':' +
                std::to_string(std::hash<std::thread::id>{}(std::this_thread::get_id())));
            std::filesystem::path temporary = target;
            temporary += std::filesystem::path(".tmp-" + nonce);
            {
                std::ofstream file(temporary, std::ios::binary | std::ios::trunc);
                if (!file)
                {
                    throw std::runtime_error("Preview archive cache file could not be created.");
                }
                if (!bytes.empty())
                {
                    file.write(
                        reinterpret_cast<const char*>(bytes.data()),
                        static_cast<std::streamsize>(bytes.size()));
                }
                file.flush();
                if (!file)
                {
                    throw std::runtime_error("Preview archive cache file could not be written.");
                }
            }
            std::error_code renameError;
            std::filesystem::rename(temporary, target, renameError);
            if (renameError)
            {
                std::error_code existsError;
                if (!std::filesystem::is_regular_file(target, existsError) || existsError)
                {
                    std::error_code removeError;
                    std::filesystem::remove(temporary, removeError);
                    throw std::runtime_error("Preview archive cache file could not be finalized.");
                }
                std::error_code removeError;
                std::filesystem::remove(temporary, removeError);
            }
            pruneArchiveAssetCache(target.parent_path(), maxPreviewArchiveCacheBytes);
        }

        std::vector<std::filesystem::path> sortedPreviewArchives(
            const std::filesystem::path& rootDirectory)
        {
            std::vector<std::filesystem::path> archives;
            std::error_code iterateError;
            for (const auto& entry : std::filesystem::directory_iterator(rootDirectory, iterateError))
            {
                if (iterateError)
                {
                    break;
                }
                std::error_code typeError;
                if (entry.is_regular_file(typeError) && !typeError && isSupportedArchivePath(entry.path()))
                {
                    archives.push_back(entry.path());
                }
            }
            std::sort(archives.begin(), archives.end(), [](const auto& left, const auto& right)
            {
                std::wstring leftName = left.filename().wstring();
                std::wstring rightName = right.filename().wstring();
                std::transform(leftName.begin(), leftName.end(), leftName.begin(), [](wchar_t character)
                {
                    return static_cast<wchar_t>(std::towlower(character));
                });
                std::transform(rightName.begin(), rightName.end(), rightName.begin(), [](wchar_t character)
                {
                    return static_cast<wchar_t>(std::towlower(character));
                });
                return leftName < rightName;
            });
            return archives;
        }
    }

    std::optional<PreviewArchiveAsset> readPreviewAssetFromBethesdaArchives(
        const std::filesystem::path& rootDirectory,
        std::wstring_view relativePath)
    {
        if (rootDirectory.empty())
        {
            return std::nullopt;
        }

        std::error_code rootError;
        if (!std::filesystem::is_directory(rootDirectory, rootError) || rootError)
        {
            return std::nullopt;
        }

        std::vector<std::filesystem::path> archives;
        std::error_code iterateError;
        for (const auto& entry : std::filesystem::directory_iterator(rootDirectory, iterateError))
        {
            if (iterateError)
            {
                break;
            }

            std::error_code typeError;
            if (entry.is_regular_file(typeError) && !typeError && isSupportedArchivePath(entry.path()))
            {
                archives.push_back(entry.path());
            }
        }

        std::sort(archives.begin(), archives.end(), [](const auto& left, const auto& right)
        {
            std::wstring leftName = left.filename().wstring();
            std::wstring rightName = right.filename().wstring();
            std::transform(leftName.begin(), leftName.end(), leftName.begin(), [](wchar_t character)
            {
                return static_cast<wchar_t>(std::towlower(character));
            });
            std::transform(rightName.begin(), rightName.end(), rightName.begin(), [](wchar_t character)
            {
                return static_cast<wchar_t>(std::towlower(character));
            });
            return leftName < rightName;
        });

        const std::string wantedPath = pathKeyFromWide(relativePath);
        for (const std::filesystem::path& archive : archives)
        {
            try
            {
                std::optional<std::vector<std::uint8_t>> bytes = readArchiveAsset(archive, wantedPath);
                if (bytes.has_value())
                {
                    return PreviewArchiveAsset{
                        archive,
                        archiveDisplayName(archive),
                        std::move(*bytes)
                    };
                }
            }
            catch (const std::exception&)
            {
                continue;
            }
        }

        return std::nullopt;
    }

    PreviewArchiveBatchResult preparePreviewAssetsFromBethesdaArchives(
        const std::filesystem::path& rootDirectory,
        const std::vector<std::wstring>& relativePaths,
        const std::filesystem::path& cacheDirectory)
    {
        PreviewArchiveBatchResult result;
        if (rootDirectory.empty() || relativePaths.empty() || cacheDirectory.empty())
        {
            return result;
        }
        std::error_code rootError;
        if (!std::filesystem::is_directory(rootDirectory, rootError) || rootError)
        {
            return result;
        }

        std::map<std::string, std::filesystem::path> unresolved;
        for (const std::wstring& relativePath : relativePaths)
        {
            const std::filesystem::path path(relativePath);
            unresolved.try_emplace(pathKeyFromWide(relativePath), path);
        }

        for (const std::filesystem::path& archive : sortedPreviewArchives(rootDirectory))
        {
            if (unresolved.empty())
            {
                break;
            }
            try
            {
                const std::shared_ptr<CachedArchiveIndex> index =
                    cachedArchiveIndex(archive, cacheDirectory, result);
                for (auto item = unresolved.begin(); item != unresolved.end();)
                {
                    const auto found = index->entries.find(item->first);
                    if (found == index->entries.end())
                    {
                        ++item;
                        continue;
                    }

                    const std::filesystem::path target =
                        archiveAssetCachePath(cacheDirectory, *index, item->second);
                    std::error_code targetError;
                    bool cacheHit = std::filesystem::is_regular_file(target, targetError) && !targetError;
                    if (cacheHit)
                    {
                        std::error_code sizeError;
                        const std::uintmax_t cachedSize = std::filesystem::file_size(target, sizeError);
                        cacheHit = !sizeError && cachedSize <= maxPreviewArchiveAssetBytes;
                    }
                    if (cacheHit)
                    {
                        ++result.assetCacheHits;
                        std::error_code touchError;
                        std::filesystem::last_write_time(
                            target,
                            std::filesystem::file_time_type::clock::now(),
                            touchError);
                    }
                    else
                    {
                        ++result.assetCacheMisses;
                        const std::vector<std::uint8_t> bytes =
                            extractIndexedArchiveEntry(*index, found->second);
                        writeArchiveCacheFileAtomically(target, bytes);
                    }
                    std::error_code sizeError;
                    const std::uintmax_t size = std::filesystem::file_size(target, sizeError);
                    if (sizeError || size > maxPreviewArchiveAssetBytes)
                    {
                        throw std::runtime_error("Prepared preview archive asset is invalid.");
                    }
                    const std::string assetHash = hashHex(item->first);
                    result.assets.push_back(PreparedPreviewArchiveAsset{
                        target,
                        archive,
                        archiveDisplayName(archive),
                        item->second.generic_wstring(),
                        L"preview-archive-v1-" +
                            std::wstring(
                                index->fingerprint.fingerprintHash.begin(),
                                index->fingerprint.fingerprintHash.end()) +
                            L"-" +
                            std::wstring(assetHash.begin(), assetHash.end()),
                        size
                    });
                    item = unresolved.erase(item);
                }
            }
            catch (const std::exception&)
            {
                continue;
            }
        }
        return result;
    }

    void enforcePreviewArchiveCacheLimit(
        const std::filesystem::path& cacheDirectory,
        std::uintmax_t maxBytes)
    {
        if (cacheDirectory.empty())
        {
            return;
        }
        std::error_code directoryError;
        if (!std::filesystem::is_directory(cacheDirectory, directoryError) || directoryError)
        {
            return;
        }
        pruneArchiveAssetCache(cacheDirectory, maxBytes);
    }
}
