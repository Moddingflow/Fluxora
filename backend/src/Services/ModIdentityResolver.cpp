#include "FluxoraCore/Services/ModIdentityResolver.hpp"

#include "FluxoraCore/Services/Logger.hpp"
#include "FluxoraCore/Storage/InstanceMetadataStore.hpp"

#include <algorithm>
#include <chrono>
#include <cwctype>
#include <cmath>
#include <iomanip>
#include <regex>
#include <map>
#include <mutex>
#include <random>
#include <set>
#include <sstream>

#ifdef _WIN32
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#endif

namespace fluxora
{
    namespace
    {
        std::wstring trim(std::wstring value)
        {
            const auto isWhitespace = [](wchar_t character)
            {
                return std::iswspace(character) != 0;
            };
            value.erase(value.begin(), std::find_if_not(value.begin(), value.end(), isWhitespace));
            value.erase(std::find_if_not(value.rbegin(), value.rend(), isWhitespace).base(), value.end());
            return value;
        }

        std::string toUtf8(std::wstring_view value)
        {
#ifdef _WIN32
            if (value.empty())
            {
                return {};
            }
            const int required = WideCharToMultiByte(
                CP_UTF8,
                0,
                value.data(),
                static_cast<int>(value.size()),
                nullptr,
                0,
                nullptr,
                nullptr);
            if (required <= 0)
            {
                return {};
            }
            std::string result(static_cast<std::size_t>(required), '\0');
            WideCharToMultiByte(
                CP_UTF8,
                0,
                value.data(),
                static_cast<int>(value.size()),
                result.data(),
                required,
                nullptr,
                nullptr);
            return result;
#else
            return std::string(value.begin(), value.end());
#endif
        }

        std::string joinEvidenceCodes(const std::vector<std::wstring>& codes)
        {
            std::string result;
            for (const std::wstring& code : codes)
            {
                if (!result.empty())
                {
                    result += ',';
                }
                result += toUtf8(code);
            }
            return result;
        }

        std::wstring lower(std::wstring value)
        {
#ifdef _WIN32
            if (!value.empty())
            {
                std::wstring mapped(value.size(), L'\0');
                const int mappedLength = LCMapStringEx(
                    LOCALE_NAME_INVARIANT,
                    LCMAP_LOWERCASE,
                    value.data(),
                    static_cast<int>(value.size()),
                    mapped.data(),
                    static_cast<int>(mapped.size()),
                    nullptr,
                    nullptr,
                    0);
                if (mappedLength > 0)
                {
                    mapped.resize(static_cast<std::size_t>(mappedLength));
                    return mapped;
                }
            }
#endif
            std::transform(value.begin(), value.end(), value.begin(), [](wchar_t character)
            {
                return static_cast<wchar_t>(std::towlower(character));
            });
            return value;
        }

        std::wstring compatibilityNormalize(std::wstring_view value)
        {
#ifdef _WIN32
            if (!value.empty())
            {
                const int required = NormalizeString(
                    NormalizationKC,
                    value.data(),
                    static_cast<int>(value.size()),
                    nullptr,
                    0);
                if (required > 0)
                {
                    std::wstring normalized(static_cast<std::size_t>(required), L'\0');
                    const int written = NormalizeString(
                        NormalizationKC,
                        value.data(),
                        static_cast<int>(value.size()),
                        normalized.data(),
                        required);
                    if (written > 0)
                    {
                        normalized.resize(static_cast<std::size_t>(written));
                        return normalized;
                    }
                }
            }
#endif
            std::wstring normalized(value);
            for (wchar_t& character : normalized)
            {
                if (character == 0x3000)
                {
                    character = L' ';
                }
                else if (character >= 0xff01 && character <= 0xff5e)
                {
                    character = static_cast<wchar_t>(character - 0xfee0);
                }
            }
            return normalized;
        }

        std::wstring removeRecognizedTrailingVersion(std::wstring value)
        {
            static const std::wregex trailingVersion(
                LR"((?:[\s_-]+(?:v(?:ersion)?[\s_-]*)?\d+(?:[._-]\d+){1,4}(?:[\s_-]*(?:alpha|beta|rc)\d*)?)\s*$)",
                std::regex_constants::icase | std::regex_constants::optimize);
            return std::regex_replace(value, trailingVersion, L"");
        }

        bool identityWordCharacter(wchar_t character)
        {
            if (std::iswalnum(character) != 0)
            {
                return true;
            }
            return character >= 0x80 &&
                std::iswspace(character) == 0 &&
                character != 0x2013 &&
                character != 0x2014 &&
                character != 0x2022;
        }

        std::wstring normalizedIdentityText(std::wstring_view value, bool safeCleanup)
        {
            std::wstring normalized = compatibilityNormalize(value);
            if (safeCleanup)
            {
                normalized = ModIdentityResolver::canonicalSuggestedName(normalized);
                normalized = removeRecognizedTrailingVersion(std::move(normalized));
            }
            normalized = lower(std::move(normalized));

            std::wstring result;
            result.reserve(normalized.size());
            bool pendingSeparator = false;
            for (const wchar_t character : normalized)
            {
                if (identityWordCharacter(character))
                {
                    if (pendingSeparator && !result.empty())
                    {
                        result.push_back(L' ');
                    }
                    result.push_back(character);
                    pendingSeparator = false;
                }
                else
                {
                    pendingSeparator = true;
                }
            }
            return trim(std::move(result));
        }

        std::vector<std::wstring> tokensFromNormalizedName(std::wstring_view normalized)
        {
            static const std::set<std::wstring> stopWords{
                L"a", L"an", L"and", L"for", L"mod", L"of", L"the"
            };
            std::set<std::wstring> unique;
            std::size_t start = 0;
            while (start < normalized.size())
            {
                const std::size_t end = normalized.find(L' ', start);
                std::wstring token(normalized.substr(
                    start,
                    end == std::wstring_view::npos ? normalized.size() - start : end - start));
                const bool numeric = !token.empty() && std::all_of(token.begin(), token.end(), [](wchar_t character)
                {
                    return std::iswdigit(character) != 0;
                });
                if (token.size() >= 2 && !numeric && !stopWords.contains(token))
                {
                    unique.insert(std::move(token));
                }
                if (end == std::wstring_view::npos)
                {
                    break;
                }
                start = end + 1;
            }
            return {unique.begin(), unique.end()};
        }

        int tokenSimilarityScore(
            const std::vector<std::wstring>& inputTokens,
            const std::vector<std::wstring>& candidateTokens)
        {
            if (inputTokens.empty() || candidateTokens.empty())
            {
                return 0;
            }
            std::size_t intersection = 0;
            for (const std::wstring& token : inputTokens)
            {
                if (std::find(candidateTokens.begin(), candidateTokens.end(), token) != candidateTokens.end())
                {
                    ++intersection;
                }
            }
            if (intersection < 2)
            {
                return 0;
            }
            const double ratio = static_cast<double>(intersection) /
                static_cast<double>((std::max)(inputTokens.size(), candidateTokens.size()));
            return 50 + static_cast<int>(std::lround(35.0 * ratio));
        }

        bool sameText(std::wstring_view left, std::wstring_view right);

        bool sharesAnchor(
            const std::vector<std::wstring>& left,
            const std::vector<std::wstring>& right)
        {
            return std::any_of(left.begin(), left.end(), [&](const std::wstring& leftValue)
            {
                return std::any_of(right.begin(), right.end(), [&](const std::wstring& rightValue)
                {
                    return sameText(leftValue, rightValue);
                });
            });
        }

        bool sameText(std::wstring_view left, std::wstring_view right)
        {
            return lower(trim(std::wstring(left))) == lower(trim(std::wstring(right)));
        }

        bool hasStableSource(const ModIdentitySource& source)
        {
            return !trim(source.provider).empty() &&
                !trim(source.game).empty() &&
                !trim(source.remoteModId).empty();
        }

        bool sameStableSource(const ModIdentitySource& left, const ModIdentitySource& right)
        {
            return hasStableSource(left) &&
                hasStableSource(right) &&
                sameText(left.provider, right.provider) &&
                sameText(left.game, right.game) &&
                sameText(left.remoteModId, right.remoteModId);
        }

        bool isStrictMeaningfulNameExtension(
            std::wstring_view possibleExtension,
            std::wstring_view baseName)
        {
            if (possibleExtension.empty() || baseName.empty() ||
                possibleExtension.size() <= baseName.size() ||
                possibleExtension.substr(0, baseName.size()) != baseName ||
                possibleExtension[baseName.size()] != L' ')
            {
                return false;
            }

            return !tokensFromNormalizedName(
                possibleExtension.substr(baseName.size() + 1)).empty();
        }

        bool isDistinctFileOnSameStableSource(
            const ModIdentityInput& input,
            const ModIdentityCandidate& candidate)
        {
            if (!sameStableSource(input.source, candidate.source) ||
                trim(input.source.remoteFileId).empty() ||
                trim(candidate.source.remoteFileId).empty() ||
                sameText(input.source.remoteFileId, candidate.source.remoteFileId))
            {
                return false;
            }

            const std::wstring inputName = normalizedIdentityText(input.displayName, true);
            const std::wstring candidateDisplayName =
                normalizedIdentityText(candidate.target.displayName, true);
            const std::wstring candidateFolderName =
                normalizedIdentityText(candidate.target.folderName, true);
            if (inputName.empty() ||
                inputName == candidateDisplayName ||
                inputName == candidateFolderName)
            {
                return false;
            }

            return isStrictMeaningfulNameExtension(inputName, candidateDisplayName) ||
                isStrictMeaningfulNameExtension(candidateDisplayName, inputName) ||
                isStrictMeaningfulNameExtension(inputName, candidateFolderName) ||
                isStrictMeaningfulNameExtension(candidateFolderName, inputName);
        }

        bool conflictsWithStableSource(const ModIdentitySource& left, const ModIdentitySource& right)
        {
            return hasStableSource(left) &&
                hasStableSource(right) &&
                sameText(left.provider, right.provider) &&
                sameText(left.game, right.game) &&
                !sameText(left.remoteModId, right.remoteModId);
        }

        bool hasSameSafeIdentityName(
            const ModIdentityInput& input,
            const ModIdentityCandidate& candidate)
        {
            const std::wstring inputDisplayName = normalizedIdentityText(input.displayName, true);
            const std::wstring inputFolderName = normalizedIdentityText(input.folderName, true);
            const std::wstring candidateDisplayName =
                normalizedIdentityText(candidate.target.displayName, true);
            const std::wstring candidateFolderName =
                normalizedIdentityText(candidate.target.folderName, true);
            return (!inputDisplayName.empty() &&
                    (inputDisplayName == candidateDisplayName ||
                     inputDisplayName == candidateFolderName)) ||
                (!inputFolderName.empty() &&
                    (inputFolderName == candidateDisplayName ||
                     inputFolderName == candidateFolderName));
        }

        std::size_t sharedContentAnchorKindCount(
            const ModIdentityInput& input,
            const ModIdentityCandidate& candidate)
        {
            std::size_t count = 0;
            count += sharesAnchor(input.content.pluginFiles, candidate.content.pluginFiles) ? 1 : 0;
            count += sharesAnchor(input.content.archiveFiles, candidate.content.archiveFiles) ? 1 : 0;
            count += sharesAnchor(
                input.content.scriptExtenderDlls,
                candidate.content.scriptExtenderDlls) ? 1 : 0;
            return count;
        }

        bool isCorroboratedCrossSourceMatch(
            const ModIdentityInput& input,
            const ModIdentityCandidate& candidate)
        {
            return conflictsWithStableSource(input.source, candidate.source) &&
                hasSameSafeIdentityName(input, candidate) &&
                sharedContentAnchorKindCount(input, candidate) >= 2;
        }

        struct StoredInstallPlan
        {
            std::wstring projectKey;
            std::wstring archiveFingerprint;
            std::uint64_t catalogRevision{0};
            ModIdentityInput input;
            FluxoraInstallPlan publicPlan;
            std::chrono::steady_clock::time_point createdAt;
        };

        std::mutex& installPlanMutex()
        {
            static std::mutex mutex;
            return mutex;
        }

        std::map<std::wstring, StoredInstallPlan>& installPlans()
        {
            static std::map<std::wstring, StoredInstallPlan> plans;
            return plans;
        }

        std::wstring normalizedProjectKey(const std::filesystem::path& projectDirectory)
        {
            return lower(std::filesystem::absolute(projectDirectory).lexically_normal().wstring());
        }

        std::wstring generateResolutionId()
        {
            static std::mutex randomMutex;
            static std::mt19937_64 random(std::random_device{}());
            std::lock_guard lock(randomMutex);
            std::wostringstream value;
            value << std::hex << std::setfill(L'0')
                  << std::setw(16) << random()
                  << std::setw(16) << random();
            return value.str();
        }

        void rememberInstallPlan(StoredInstallPlan plan)
        {
            constexpr std::size_t maxPlans = 128;
            constexpr auto maxAge = std::chrono::minutes(30);
            const auto now = std::chrono::steady_clock::now();
            std::lock_guard lock(installPlanMutex());
            auto& plans = installPlans();
            for (auto item = plans.begin(); item != plans.end();)
            {
                if (now - item->second.createdAt > maxAge)
                {
                    item = plans.erase(item);
                }
                else
                {
                    ++item;
                }
            }
            while (plans.size() >= maxPlans && !plans.empty())
            {
                const auto oldest = std::min_element(
                    plans.begin(),
                    plans.end(),
                    [](const auto& left, const auto& right)
                    {
                        return left.second.createdAt < right.second.createdAt;
                    });
                plans.erase(oldest);
            }
            plans[plan.publicPlan.resolutionId] = std::move(plan);
        }

        StoredInstallPlan storedInstallPlan(std::wstring_view resolutionId)
        {
            std::lock_guard lock(installPlanMutex());
            const auto found = installPlans().find(std::wstring(resolutionId));
            if (found == installPlans().end() ||
                std::chrono::steady_clock::now() - found->second.createdAt > std::chrono::minutes(30))
            {
                throw InstallIdentityPlanStaleError();
            }
            return found->second;
        }
    }

    InstallIdentityPlanStaleError::InstallIdentityPlanStaleError()
        : std::runtime_error("install.identityPlanStale")
    {
    }

    std::wstring ModIdentityResolver::canonicalSuggestedName(std::wstring_view value)
    {
        std::wstring result = trim(std::wstring(value));
        constexpr std::wstring_view spidSuffix = L" (SPID)";
        if (result.size() >= spidSuffix.size() &&
            lower(result.substr(result.size() - spidSuffix.size())) == L" (spid)")
        {
            const std::wstring expanded = trim(result.substr(0, result.size() - spidSuffix.size()));
            if (lower(expanded) == L"spell perks item distributor")
            {
                return L"Spell Perks Item Distributor";
            }
        }

        if (lower(result) == L"spid")
        {
            return L"Spell Perks Item Distributor";
        }
        return result;
    }

    std::wstring ModIdentityResolver::normalizedName(std::wstring_view value)
    {
        return normalizedIdentityText(value, true);
    }

    std::vector<std::wstring> ModIdentityResolver::meaningfulTokens(std::wstring_view value)
    {
        return tokensFromNormalizedName(normalizedName(value));
    }

    ModIdentityResolution ModIdentityResolver::resolve(
        const ModIdentityInput& input,
        const std::vector<ModIdentityCandidate>& candidates)
    {
        ModIdentityResolution resolution;
        resolution.suggestedModName = canonicalSuggestedName(input.displayName);

        const ModIdentityCandidate* stableMatch = nullptr;
        std::size_t stableMatchCount = 0;
        for (const ModIdentityCandidate& candidate : candidates)
        {
            if (!sameStableSource(input.source, candidate.source))
            {
                continue;
            }
            ++stableMatchCount;
            if (!candidate.excluded && !isDistinctFileOnSameStableSource(input, candidate))
            {
                stableMatch = &candidate;
            }
        }
        if (stableMatchCount == 1 && stableMatch != nullptr)
        {
            resolution.kind = ModIdentityResolutionKind::Exact;
            resolution.suggestedModName = stableMatch->target.displayName;
            resolution.matchedTarget = stableMatch->target;
            resolution.score = 100;
            resolution.evidenceCodes = {L"source.stable-mod-id"};
            return resolution;
        }

        const ModIdentityCandidate* crossSourceMatch = nullptr;
        std::size_t crossSourceMatchCount = 0;
        for (const ModIdentityCandidate& candidate : candidates)
        {
            if (candidate.excluded || !isCorroboratedCrossSourceMatch(input, candidate))
            {
                continue;
            }
            crossSourceMatch = &candidate;
            ++crossSourceMatchCount;
        }
        if (crossSourceMatchCount == 1 && crossSourceMatch != nullptr)
        {
            resolution.kind = ModIdentityResolutionKind::Probable;
            resolution.suggestedModName = crossSourceMatch->target.displayName;
            resolution.matchedTarget = crossSourceMatch->target;
            resolution.score = 94;
            resolution.evidenceCodes = {
                L"source.cross-page-update",
                L"name.safe-normalized"
            };
            if (sharesAnchor(input.content.pluginFiles, crossSourceMatch->content.pluginFiles))
            {
                resolution.evidenceCodes.push_back(L"content.plugin");
            }
            if (sharesAnchor(input.content.archiveFiles, crossSourceMatch->content.archiveFiles))
            {
                resolution.evidenceCodes.push_back(L"content.archive");
            }
            if (sharesAnchor(
                    input.content.scriptExtenderDlls,
                    crossSourceMatch->content.scriptExtenderDlls))
            {
                resolution.evidenceCodes.push_back(L"content.skse-dll");
            }
            return resolution;
        }

        const ModIdentityCandidate* aliasMatch = nullptr;
        std::size_t aliasMatchCount = 0;
        for (const ModIdentityCandidate& candidate : candidates)
        {
            if (candidate.excluded ||
                conflictsWithStableSource(input.source, candidate.source) ||
                isDistinctFileOnSameStableSource(input, candidate))
            {
                continue;
            }
            if (std::none_of(candidate.aliases.begin(), candidate.aliases.end(), [&](const std::wstring& alias)
            {
                return normalizedName(input.displayName) == normalizedName(alias);
            }))
            {
                continue;
            }

            aliasMatch = &candidate;
            ++aliasMatchCount;
        }
        if (aliasMatchCount == 1 && aliasMatch != nullptr)
        {
            resolution.kind = ModIdentityResolutionKind::Exact;
            resolution.suggestedModName = aliasMatch->target.displayName;
            resolution.matchedTarget = aliasMatch->target;
            resolution.score = 98;
            resolution.evidenceCodes = {L"alias.confirmed"};
            return resolution;
        }

        if (!trim(input.fomodModuleId).empty())
        {
            const ModIdentityCandidate* moduleMatch = nullptr;
            std::size_t moduleMatchCount = 0;
            for (const ModIdentityCandidate& candidate : candidates)
            {
                if (candidate.excluded ||
                    conflictsWithStableSource(input.source, candidate.source) ||
                    isDistinctFileOnSameStableSource(input, candidate) ||
                    !sameText(input.fomodModuleId, candidate.fomodModuleId))
                {
                    continue;
                }
                moduleMatch = &candidate;
                ++moduleMatchCount;
            }

            if (moduleMatchCount == 1 && moduleMatch != nullptr)
            {
                resolution.kind = ModIdentityResolutionKind::Exact;
                resolution.suggestedModName = moduleMatch->target.displayName;
                resolution.matchedTarget = moduleMatch->target;
                resolution.score = 96;
                resolution.evidenceCodes = {L"fomod.module-id"};
                return resolution;
            }
        }

        const std::wstring inputName = normalizedIdentityText(input.displayName, false);
        const std::wstring inputFolderName = normalizedIdentityText(input.folderName, false);
        if (!inputName.empty() || !inputFolderName.empty())
        {
            const ModIdentityCandidate* exactNameMatch = nullptr;
            std::size_t exactNameMatchCount = 0;
            for (const ModIdentityCandidate& candidate : candidates)
            {
                if (candidate.excluded || isDistinctFileOnSameStableSource(input, candidate))
                {
                    continue;
                }
                const std::wstring candidateDisplayName = normalizedIdentityText(candidate.target.displayName, false);
                const std::wstring candidateFolderName = normalizedIdentityText(candidate.target.folderName, false);
                const bool matches =
                    (!inputName.empty() &&
                        (inputName == candidateDisplayName || inputName == candidateFolderName)) ||
                    (!inputFolderName.empty() &&
                        (inputFolderName == candidateDisplayName || inputFolderName == candidateFolderName));
                if (!matches)
                {
                    continue;
                }
                exactNameMatch = &candidate;
                ++exactNameMatchCount;
            }

            if (exactNameMatchCount == 1 && exactNameMatch != nullptr)
            {
                const bool stableSourceConflict =
                    conflictsWithStableSource(input.source, exactNameMatch->source);
                resolution.kind = stableSourceConflict
                    ? ModIdentityResolutionKind::Probable
                    : ModIdentityResolutionKind::Exact;
                resolution.suggestedModName = exactNameMatch->target.displayName;
                resolution.matchedTarget = exactNameMatch->target;
                resolution.score = stableSourceConflict ? 90 : 94;
                resolution.evidenceCodes = {L"name.normalized-exact"};
                if (stableSourceConflict)
                {
                    resolution.evidenceCodes.push_back(L"source.stable-mod-id-conflict");
                }
                return resolution;
            }
        }

        if (stableMatchCount > 1)
        {
            const ModIdentityCandidate* contentMatch = nullptr;
            std::size_t bestSharedAnchorKindCount = 0;
            bool contentMatchIsAmbiguous = false;
            for (const ModIdentityCandidate& candidate : candidates)
            {
                if (candidate.excluded || !sameStableSource(input.source, candidate.source))
                {
                    continue;
                }

                const std::size_t sharedAnchorKindCount =
                    sharedContentAnchorKindCount(input, candidate);
                if (sharedAnchorKindCount > bestSharedAnchorKindCount)
                {
                    contentMatch = &candidate;
                    bestSharedAnchorKindCount = sharedAnchorKindCount;
                    contentMatchIsAmbiguous = false;
                }
                else if (sharedAnchorKindCount != 0 &&
                    sharedAnchorKindCount == bestSharedAnchorKindCount)
                {
                    contentMatchIsAmbiguous = true;
                }
            }

            if (contentMatch != nullptr &&
                bestSharedAnchorKindCount != 0 &&
                !contentMatchIsAmbiguous)
            {
                resolution.kind = ModIdentityResolutionKind::Probable;
                resolution.suggestedModName = contentMatch->target.displayName;
                resolution.matchedTarget = contentMatch->target;
                resolution.score = 92 + static_cast<int>(
                    (std::min<std::size_t>)(bestSharedAnchorKindCount, 3));
                resolution.evidenceCodes = {L"source.stable-mod-id-ambiguous"};
                if (sharesAnchor(input.content.pluginFiles, contentMatch->content.pluginFiles))
                {
                    resolution.evidenceCodes.push_back(L"content.plugin");
                }
                if (sharesAnchor(input.content.archiveFiles, contentMatch->content.archiveFiles))
                {
                    resolution.evidenceCodes.push_back(L"content.archive");
                }
                if (sharesAnchor(
                        input.content.scriptExtenderDlls,
                        contentMatch->content.scriptExtenderDlls))
                {
                    resolution.evidenceCodes.push_back(L"content.skse-dll");
                }
                return resolution;
            }
        }

        struct ScoredCandidate
        {
            const ModIdentityCandidate* candidate{nullptr};
            int score{0};
            std::vector<std::wstring> evidence;
        };
        std::vector<ScoredCandidate> scored;
        scored.reserve(candidates.size());
        const std::wstring safeInputName = normalizedName(input.displayName);
        const std::wstring safeInputFolder = normalizedName(input.folderName);
        const std::vector<std::wstring> inputTokens = meaningfulTokens(
            safeInputName.empty() ? safeInputFolder : safeInputName);
        for (const ModIdentityCandidate& candidate : candidates)
        {
            if (candidate.excluded ||
                conflictsWithStableSource(input.source, candidate.source) ||
                isDistinctFileOnSameStableSource(input, candidate))
            {
                continue;
            }

            ScoredCandidate item;
            item.candidate = &candidate;
            const std::wstring candidateDisplayName = normalizedName(candidate.target.displayName);
            const std::wstring candidateFolderName = normalizedName(candidate.target.folderName);
            const bool safeNameMatch =
                (!safeInputName.empty() &&
                    (safeInputName == candidateDisplayName || safeInputName == candidateFolderName)) ||
                (!safeInputFolder.empty() &&
                    (safeInputFolder == candidateDisplayName || safeInputFolder == candidateFolderName));
            if (safeNameMatch)
            {
                item.score = 90;
                item.evidence.push_back(L"name.safe-normalized");
            }
            else
            {
                std::vector<std::wstring> candidateTokens = meaningfulTokens(candidate.target.displayName);
                const std::vector<std::wstring> folderTokens = meaningfulTokens(candidate.target.folderName);
                candidateTokens.insert(candidateTokens.end(), folderTokens.begin(), folderTokens.end());
                std::sort(candidateTokens.begin(), candidateTokens.end());
                candidateTokens.erase(std::unique(candidateTokens.begin(), candidateTokens.end()), candidateTokens.end());
                item.score = tokenSimilarityScore(inputTokens, candidateTokens);
                if (item.score > 0)
                {
                    item.evidence.push_back(L"name.meaningful-tokens");
                }
            }

            int anchorScore = 0;
            if (sharesAnchor(input.content.pluginFiles, candidate.content.pluginFiles))
            {
                anchorScore += 12;
                item.evidence.push_back(L"content.plugin");
            }
            if (sharesAnchor(input.content.archiveFiles, candidate.content.archiveFiles))
            {
                anchorScore += 8;
                item.evidence.push_back(L"content.archive");
            }
            if (sharesAnchor(input.content.scriptExtenderDlls, candidate.content.scriptExtenderDlls))
            {
                anchorScore += 12;
                item.evidence.push_back(L"content.skse-dll");
            }
            item.score += (std::min)(anchorScore, 20);
            if (stableMatchCount > 1 && sameStableSource(input.source, candidate.source) && item.score > 0)
            {
                item.score += 5;
                item.evidence.push_back(L"source.stable-mod-id-ambiguous");
            }
            item.score = (std::min)(item.score, 100);
            scored.push_back(std::move(item));
        }

        std::sort(scored.begin(), scored.end(), [](const ScoredCandidate& left, const ScoredCandidate& right)
        {
            return left.score > right.score;
        });
        if (!scored.empty())
        {
            const int secondScore = scored.size() > 1 ? scored[1].score : 0;
            if (scored[0].score >= 86 && scored[0].score - secondScore >= 12)
            {
                resolution.kind = ModIdentityResolutionKind::Probable;
                resolution.suggestedModName = scored[0].candidate->target.displayName;
                resolution.matchedTarget = scored[0].candidate->target;
                resolution.score = scored[0].score;
                resolution.evidenceCodes = std::move(scored[0].evidence);
                return resolution;
            }
        }

        return resolution;
    }

    ModIdentityContentAnchors ModIdentityResolver::collectContentAnchors(
        const std::filesystem::path& rootDirectory)
    {
        ModIdentityContentAnchors anchors;
        std::error_code statusError;
        if (rootDirectory.empty() ||
            !std::filesystem::is_directory(rootDirectory, statusError) ||
            statusError)
        {
            return anchors;
        }

        std::set<std::wstring> plugins;
        std::set<std::wstring> archives;
        std::set<std::wstring> dlls;
        std::error_code iteratorError;
        std::filesystem::recursive_directory_iterator iterator(
            rootDirectory,
            std::filesystem::directory_options::skip_permission_denied,
            iteratorError);
        const std::filesystem::recursive_directory_iterator end;
        for (; iterator != end; iterator.increment(iteratorError))
        {
            if (iteratorError)
            {
                iteratorError.clear();
                continue;
            }
            std::error_code fileError;
            if (!iterator->is_regular_file(fileError) || fileError)
            {
                continue;
            }
            const std::wstring extension = lower(iterator->path().extension().wstring());
            const std::wstring fileName = lower(iterator->path().filename().wstring());
            if (extension == L".esp" || extension == L".esm" || extension == L".esl")
            {
                plugins.insert(fileName);
            }
            else if (extension == L".bsa" || extension == L".ba2")
            {
                archives.insert(fileName);
            }
            else if (extension == L".dll")
            {
                std::error_code relativeError;
                const std::wstring relative = lower(
                    std::filesystem::relative(iterator->path(), rootDirectory, relativeError)
                        .generic_wstring());
                if (!relativeError &&
                    (relative.find(L"skse/plugins/") != std::wstring::npos ||
                        relative.find(L"skse\\plugins\\") != std::wstring::npos))
                {
                    dlls.insert(fileName);
                }
            }
        }
        anchors.pluginFiles.assign(plugins.begin(), plugins.end());
        anchors.archiveFiles.assign(archives.begin(), archives.end());
        anchors.scriptExtenderDlls.assign(dlls.begin(), dlls.end());
        return anchors;
    }

    FluxoraInstallPlan ModIdentityResolver::createInstallPlan(
        ModIdentityPlanRequest request,
        Logger* logger)
    {
        if (request.projectDirectory.empty() || request.archiveFingerprint.empty())
        {
            throw std::invalid_argument("Project directory and archive fingerprint are required.");
        }

        if (request.input.displayName.empty() && request.fomodInstaller.isFomod)
        {
            request.input.displayName = request.fomodInstaller.moduleName;
        }
        if (request.input.fomodModuleId.empty())
        {
            request.input.fomodModuleId = request.fomodInstaller.moduleId;
        }

        const auto indexedStartedAt = std::chrono::steady_clock::now();
        ModIdentityCatalogQuery query;
        query.provider = request.input.source.provider;
        query.gameDomain = request.input.source.game;
        query.remoteModId = request.input.source.remoteModId;
        query.fomodModuleId = request.input.fomodModuleId;
        query.normalizedName = normalizedName(request.input.displayName);
        query.tokens = meaningfulTokens(request.input.displayName);
        query.limit = 5;
        const ModIdentityCatalogSnapshot snapshot =
            InstanceMetadataStore::queryModIdentityCandidates(request.projectDirectory, query);
        const auto indexedDuration = std::chrono::duration_cast<std::chrono::milliseconds>(
            std::chrono::steady_clock::now() - indexedStartedAt).count();

        std::vector<ModIdentityCandidate> candidates;
        candidates.reserve(snapshot.candidates.size());
        for (const ModIdentityCatalogCandidate& stored : snapshot.candidates)
        {
            ModIdentityCandidate candidate;
            candidate.target = {
                stored.mod.uuid,
                stored.mod.displayName,
                stored.mod.folderName
            };
            candidate.source = {
                stored.mod.source.provider,
                stored.mod.source.gameDomain,
                stored.mod.source.remoteModId,
                stored.mod.source.remoteFileId
            };
            candidate.fomodModuleId = stored.fomodModuleId;
            candidate.aliases = stored.aliases;
            candidate.excluded = stored.excluded;
            candidates.push_back(std::move(candidate));
        }

        ModIdentityResolution resolution = resolve(request.input, candidates);
        if (!resolution.matchedTarget.has_value() &&
            !candidates.empty() &&
            request.loadIncomingContent)
        {
            if (const std::optional<ModIdentityContentCacheRecord> cached =
                    InstanceMetadataStore::modIdentityContentCache(
                        request.projectDirectory,
                        request.archiveFingerprint);
                cached.has_value())
            {
                request.input.content = ModIdentityContentAnchors{
                    cached->pluginFiles,
                    cached->archiveFiles,
                    cached->scriptExtenderDlls
                };
            }
            else
            {
                request.input.content = request.loadIncomingContent();
                InstanceMetadataStore::recordModIdentityContentCache(
                    request.projectDirectory,
                    request.archiveFingerprint,
                    ModIdentityContentCacheRecord{
                        request.input.content.pluginFiles,
                        request.input.content.archiveFiles,
                        request.input.content.scriptExtenderDlls
                    });
            }
            for (std::size_t index = 0; index < candidates.size(); ++index)
            {
                candidates[index].content = collectContentAnchors(snapshot.candidates[index].mod.path);
            }
            resolution = resolve(request.input, candidates);
        }

        FluxoraInstallPlan plan;
        plan.suggestedModName = resolution.suggestedModName.empty()
            ? canonicalSuggestedName(request.input.displayName)
            : resolution.suggestedModName;
        plan.resolutionKind = resolution.kind;
        plan.matchedTarget = resolution.matchedTarget;
        plan.resolutionId = generateResolutionId();
        plan.fomodInstaller = std::move(request.fomodInstaller);
        plan.evidenceCodes = std::move(resolution.evidenceCodes);
        if (plan.evidenceCodes.empty())
        {
            plan.evidenceCodes.push_back(L"result.none");
        }
        plan.score = resolution.score;

        if (logger != nullptr)
        {
            logger->writeOperation(
                LogLevel::Info,
                "ModIdentity",
                "Identity plan completed. result=" +
                    std::to_string(static_cast<int>(plan.resolutionKind)) +
                    ", candidateCount=" + std::to_string(candidates.size()) +
                    ", score=" + std::to_string(plan.score) +
                    ", evidenceCodes=\"" + joinEvidenceCodes(plan.evidenceCodes) +
                    "\", targetModUuid=\"" +
                    (plan.matchedTarget.has_value()
                        ? toUtf8(plan.matchedTarget->modUuid)
                        : std::string{}) +
                    "\"" +
                    ", indexedDurationMs=" + std::to_string(indexedDuration) + ".");
        }

        rememberInstallPlan(StoredInstallPlan{
            normalizedProjectKey(request.projectDirectory),
            request.archiveFingerprint,
            snapshot.catalogRevision,
            request.input,
            plan,
            std::chrono::steady_clock::now()
        });
        return plan;
    }

    ValidatedModIdentityInstall ModIdentityResolver::validateInstallPlan(
        const std::filesystem::path& projectDirectory,
        std::wstring_view archiveFingerprint,
        const ModIdentityInstallSelection& selection)
    {
        if (selection.resolutionId.empty())
        {
            throw InstallIdentityPlanStaleError();
        }
        const StoredInstallPlan stored = storedInstallPlan(selection.resolutionId);
        if (stored.projectKey != normalizedProjectKey(projectDirectory) ||
            stored.archiveFingerprint != archiveFingerprint ||
            stored.catalogRevision != InstanceMetadataStore::modCatalogRevision(projectDirectory))
        {
            throw InstallIdentityPlanStaleError();
        }

        ValidatedModIdentityInstall validated;
        validated.decision = selection.decision;
        validated.incomingSource = stored.input.source;
        validated.incomingName = stored.input.displayName;
        validated.fomodModuleId = stored.input.fomodModuleId;
        validated.resolutionId = selection.resolutionId;

        if (selection.decision == InstallIdentityDecision::UseMatch)
        {
            if (!stored.publicPlan.matchedTarget.has_value() ||
                selection.targetModUuid.empty() ||
                !sameText(selection.targetModUuid, stored.publicPlan.matchedTarget->modUuid))
            {
                throw InstallIdentityPlanStaleError();
            }
            const std::optional<InstalledModRecord> current = InstanceMetadataStore::installedModByUuid(
                projectDirectory,
                stored.publicPlan.matchedTarget->modUuid);
            if (!current.has_value() ||
                !sameText(current->folderName, stored.publicPlan.matchedTarget->folderName) ||
                current->displayName != stored.publicPlan.matchedTarget->displayName ||
                !std::filesystem::is_directory(current->path))
            {
                throw InstallIdentityPlanStaleError();
            }
            validated.matchedTarget = ModIdentityTarget{
                current->uuid,
                current->displayName,
                current->folderName
            };
        }
        else if (stored.publicPlan.matchedTarget.has_value())
        {
            validated.rejectedTarget = stored.publicPlan.matchedTarget;
        }
        return validated;
    }
}
