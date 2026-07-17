#include "FluxoraCore/Services/FomodAutoSelectionService.hpp"

#include <algorithm>
#include <chrono>
#include <cwctype>
#include <deque>
#include <functional>
#include <iomanip>
#include <iterator>
#include <map>
#include <mutex>
#include <set>
#include <sstream>
#include <stdexcept>
#include <string_view>

namespace fluxora
{
    namespace
    {
        struct EffectiveOptionType
        {
            std::wstring type;
            bool unknown{false};
            bool profileExact{false};
            std::vector<FomodDecisionEvidence> evidence;
        };

        struct IterationResult
        {
            std::set<std::wstring> selected;
            std::vector<FomodUnresolvedGroup> unresolved;
            std::vector<FomodOptionDecision> decisions;
        };

        struct Tes4Assessment
        {
            bool patch{false};
            bool eligible{true};
            bool reviewRequired{false};
            std::vector<FomodDecisionEvidence> evidence;
        };

        struct ContextBinding
        {
            std::wstring contextId;
            std::wstring projectKey;
            std::wstring archiveFingerprint;
            std::wstring profileName;
            std::wstring profileFingerprint;
            std::wstring modRevision;
            std::wstring pluginRevision;
            std::chrono::steady_clock::time_point createdAt;
        };

        constexpr std::size_t maxContextBindings = 128;
        constexpr auto contextBindingLifetime = std::chrono::minutes(30);

        std::mutex& contextBindingsMutex()
        {
            static std::mutex mutex;
            return mutex;
        }

        std::deque<ContextBinding>& contextBindings()
        {
            static std::deque<ContextBinding> bindings;
            return bindings;
        }

        std::uint64_t& contextBindingSequence()
        {
            static std::uint64_t sequence = 0;
            return sequence;
        }

        [[nodiscard]] std::wstring trim(std::wstring_view value)
        {
            std::size_t first = 0;
            while (first < value.size() && std::iswspace(value[first]))
            {
                ++first;
            }
            std::size_t last = value.size();
            while (last > first && std::iswspace(value[last - 1]))
            {
                --last;
            }
            return std::wstring(value.substr(first, last - first));
        }

        [[nodiscard]] std::wstring lower(std::wstring_view value)
        {
            std::wstring output(value);
            std::transform(
                output.begin(),
                output.end(),
                output.begin(),
                [](wchar_t character)
                {
                    return static_cast<wchar_t>(std::towlower(character));
                });
            return output;
        }

        [[nodiscard]] std::wstring projectKey(const std::filesystem::path& projectDirectory)
        {
            std::error_code error;
            std::filesystem::path absolute = std::filesystem::absolute(projectDirectory, error);
            if (error)
            {
                absolute = projectDirectory;
            }
            return lower(absolute.lexically_normal().wstring());
        }

        [[nodiscard]] std::wstring bindingId(const ContextBinding& binding)
        {
            std::size_t hash = std::hash<std::wstring>{}(
                binding.projectKey + L"\x1f" + binding.archiveFingerprint + L"\x1f" +
                binding.profileName + L"\x1f" + binding.profileFingerprint + L"\x1f" +
                std::to_wstring(++contextBindingSequence()));
            std::wostringstream output;
            output << L"fomod-" << std::hex << std::setw(sizeof(std::size_t) * 2)
                   << std::setfill(L'0') << hash;
            return output.str();
        }

        void purgeExpiredBindings(std::chrono::steady_clock::time_point now)
        {
            auto& bindings = contextBindings();
            bindings.erase(
                std::remove_if(
                    bindings.begin(),
                    bindings.end(),
                    [now](const ContextBinding& binding)
                    {
                        return now - binding.createdAt > contextBindingLifetime;
                    }),
                bindings.end());
        }

        [[nodiscard]] bool equals(std::wstring_view left, std::wstring_view right)
        {
            return lower(trim(left)) == lower(trim(right));
        }

        [[nodiscard]] std::wstring pathKey(std::wstring_view value)
        {
            std::wstring key = lower(trim(value));
            std::replace(key.begin(), key.end(), L'/', L'\\');
            while (key.find(L"\\\\") != std::wstring::npos)
            {
                key.replace(key.find(L"\\\\"), 2, L"\\");
            }
            if (key.starts_with(L".\\"))
            {
                key.erase(0, 2);
            }
            return key;
        }

        [[nodiscard]] const FomodProfileFileState* fileState(
            const FomodProfileContext& context,
            std::wstring_view file)
        {
            const std::wstring key = pathKey(file);
            const auto match = std::find_if(
                context.fileStates.begin(),
                context.fileStates.end(),
                [&key](const FomodProfileFileState& state)
                {
                    return pathKey(state.file) == key;
                });
            return match == context.fileStates.end() ? nullptr : &*match;
        }

        [[nodiscard]] const FomodProfileFileState* pluginState(
            const FomodProfileContext& context,
            std::wstring_view pluginName)
        {
            const std::wstring key = lower(trim(pluginName));
            const auto match = std::find_if(
                context.fileStates.begin(),
                context.fileStates.end(),
                [&key](const FomodProfileFileState& state)
                {
                    return lower(std::filesystem::path(state.file).filename().wstring()) == key;
                });
            return match == context.fileStates.end() ? nullptr : &*match;
        }

        [[nodiscard]] std::vector<unsigned long long> versionParts(std::wstring_view value)
        {
            std::vector<unsigned long long> parts;
            std::wstring digits;
            bool sawDigit = false;
            for (wchar_t character : trim(value))
            {
                if (character >= L'0' && character <= L'9')
                {
                    digits.push_back(character);
                    sawDigit = true;
                    continue;
                }
                if (character == L'.' || character == L',' || character == L'-' || character == L'_')
                {
                    if (!digits.empty())
                    {
                        parts.push_back(std::stoull(digits));
                        digits.clear();
                    }
                    if (character == L'-' && sawDigit)
                    {
                        break;
                    }
                    continue;
                }
                if (sawDigit)
                {
                    break;
                }
            }
            if (!digits.empty())
            {
                parts.push_back(std::stoull(digits));
            }
            return parts;
        }

        [[nodiscard]] FomodDependencyResult versionAtLeast(
            std::wstring_view actual,
            bool known,
            std::wstring_view required)
        {
            if (trim(required).empty())
            {
                return FomodDependencyResult::Satisfied;
            }
            if (!known || trim(actual).empty())
            {
                return FomodDependencyResult::Unknown;
            }
            std::vector<unsigned long long> actualParts;
            std::vector<unsigned long long> requiredParts;
            try
            {
                actualParts = versionParts(actual);
                requiredParts = versionParts(required);
            }
            catch (const std::exception&)
            {
                return FomodDependencyResult::Unknown;
            }
            if (actualParts.empty() || requiredParts.empty())
            {
                return FomodDependencyResult::Unknown;
            }
            const std::size_t count = std::max(actualParts.size(), requiredParts.size());
            actualParts.resize(count, 0);
            requiredParts.resize(count, 0);
            return std::lexicographical_compare(
                actualParts.begin(), actualParts.end(),
                requiredParts.begin(), requiredParts.end())
                ? FomodDependencyResult::Unsatisfied
                : FomodDependencyResult::Satisfied;
        }

        [[nodiscard]] const FomodDetectedVersion* detectedVersion(
            const FomodProfileContext& context,
            std::wstring_view kind)
        {
            if (equals(kind, L"game"))
            {
                return &context.gameVersion;
            }
            const auto match = std::find_if(
                context.extenderVersions.begin(),
                context.extenderVersions.end(),
                [kind](const FomodDetectedVersion& version)
                {
                    return equals(version.kind, kind);
                });
            return match == context.extenderVersions.end() ? nullptr : &*match;
        }

        [[nodiscard]] FomodDependencyResult evaluate(
            const FomodDependencyNode& dependency,
            const FomodProfileContext& context,
            const std::map<std::wstring, std::wstring>& flags)
        {
            const std::wstring kind = lower(trim(dependency.kind));
            if (kind == L"file")
            {
                const FomodProfileFileState* state = fileState(context, dependency.file);
                const FomodProfileFileStateKind actual = state == nullptr
                    ? FomodProfileFileStateKind::Missing
                    : state->state;
                const std::wstring expected = lower(trim(dependency.state));
                if (expected == L"active")
                {
                    return actual == FomodProfileFileStateKind::Active
                        ? FomodDependencyResult::Satisfied
                        : FomodDependencyResult::Unsatisfied;
                }
                if (expected == L"inactive")
                {
                    return actual == FomodProfileFileStateKind::Inactive
                        ? FomodDependencyResult::Satisfied
                        : FomodDependencyResult::Unsatisfied;
                }
                if (expected == L"missing")
                {
                    return actual == FomodProfileFileStateKind::Missing
                        ? FomodDependencyResult::Satisfied
                        : FomodDependencyResult::Unsatisfied;
                }
                return FomodDependencyResult::Unknown;
            }
            if (kind == L"flag")
            {
                const auto match = flags.find(dependency.flag);
                return match != flags.end() && match->second == dependency.value
                    ? FomodDependencyResult::Satisfied
                    : FomodDependencyResult::Unsatisfied;
            }
            if (kind == L"fomm")
            {
                return versionAtLeast(L"0.13.21", true, dependency.version);
            }
            if (kind == L"game" || kind == L"skse" || kind == L"fose" ||
                kind == L"nvse" || kind == L"f4se" || kind == L"scriptextender")
            {
                const FomodDetectedVersion* version = detectedVersion(context, kind);
                return version == nullptr
                    ? FomodDependencyResult::Unknown
                    : versionAtLeast(version->version, version->known, dependency.version);
            }

            const bool useOr = equals(dependency.op, L"Or");
            if (dependency.children.empty())
            {
                return FomodDependencyResult::Satisfied;
            }
            bool hasUnknown = false;
            for (const FomodDependencyNode& child : dependency.children)
            {
                const FomodDependencyResult result = evaluate(child, context, flags);
                if (useOr && result == FomodDependencyResult::Satisfied)
                {
                    return FomodDependencyResult::Satisfied;
                }
                if (!useOr && result == FomodDependencyResult::Unsatisfied)
                {
                    return FomodDependencyResult::Unsatisfied;
                }
                hasUnknown = hasUnknown || result == FomodDependencyResult::Unknown;
            }
            if (hasUnknown)
            {
                return FomodDependencyResult::Unknown;
            }
            return useOr ? FomodDependencyResult::Unsatisfied : FomodDependencyResult::Satisfied;
        }

        void appendEvidence(
            const FomodDependencyNode& dependency,
            const FomodProfileContext& context,
            const std::map<std::wstring, std::wstring>& flags,
            std::vector<FomodDecisionEvidence>& output,
            bool includeUnknown)
        {
            const FomodDependencyResult result = evaluate(dependency, context, flags);
            if (result == FomodDependencyResult::Unsatisfied ||
                (result == FomodDependencyResult::Unknown && !includeUnknown))
            {
                return;
            }
            const std::wstring kind = lower(trim(dependency.kind));
            if (kind == L"file")
            {
                const FomodProfileFileState* state = fileState(context, dependency.file);
                output.push_back(FomodDecisionEvidence{
                    result == FomodDependencyResult::Unknown ? L"dependency.unknown" : L"profile.file.match",
                    pathKey(dependency.file),
                    dependency.state,
                    state == nullptr ? L"Missing" : FomodProfileContextService::stateName(state->state),
                    state == nullptr ? std::wstring{} : state->sourceKind,
                    state == nullptr ? std::wstring{} : state->sourceName
                });
                return;
            }
            if (kind == L"flag")
            {
                const auto match = flags.find(dependency.flag);
                output.push_back(FomodDecisionEvidence{
                    L"fomod.flag.match",
                    dependency.flag,
                    dependency.value,
                    match == flags.end() ? std::wstring{} : match->second,
                    {},
                    {}
                });
                return;
            }
            if (kind == L"fomm" || kind == L"game" || kind == L"skse" || kind == L"fose" ||
                kind == L"nvse" || kind == L"f4se" || kind == L"scriptextender")
            {
                const FomodDetectedVersion* version = kind == L"fomm" ? nullptr : detectedVersion(context, kind);
                output.push_back(FomodDecisionEvidence{
                    result == FomodDependencyResult::Unknown ? L"dependency.version.unknown" : L"profile.version.match",
                    kind,
                    dependency.version,
                    kind == L"fomm" ? L"0.13.21" : (version == nullptr ? std::wstring{} : version->version),
                    L"executable",
                    version == nullptr ? std::wstring{} : version->displayName
                });
                return;
            }
            for (const FomodDependencyNode& child : dependency.children)
            {
                appendEvidence(child, context, flags, output, includeUnknown);
            }
        }

        [[nodiscard]] EffectiveOptionType effectiveType(
            const FomodOption& option,
            const FomodProfileContext& context,
            const std::map<std::wstring, std::wstring>& flags)
        {
            EffectiveOptionType output;
            output.type = option.defaultType.empty()
                ? (option.type.empty() ? L"Optional" : option.type)
                : option.defaultType;
            for (const FomodTypePattern& pattern : option.typePatterns)
            {
                const FomodDependencyResult result = evaluate(pattern.dependencies, context, flags);
                if (result == FomodDependencyResult::Satisfied)
                {
                    output.type = pattern.type.empty() ? L"Optional" : pattern.type;
                    appendEvidence(pattern.dependencies, context, flags, output.evidence, false);
                    output.profileExact = std::any_of(
                        output.evidence.begin(),
                        output.evidence.end(),
                        [](const FomodDecisionEvidence& evidence)
                        {
                            return evidence.code == L"profile.file.match" ||
                                evidence.code == L"profile.version.match";
                        });
                    return output;
                }
                if (result == FomodDependencyResult::Unknown)
                {
                    output.unknown = true;
                    appendEvidence(pattern.dependencies, context, flags, output.evidence, true);
                }
            }
            return output;
        }

        [[nodiscard]] std::map<std::wstring, std::wstring> flagsForSelection(
            const FomodInstallerDescriptor& descriptor,
            const std::set<std::wstring>& selected)
        {
            std::map<std::wstring, std::wstring> flags;
            for (const FomodStep& step : descriptor.steps)
            {
                for (const FomodGroup& group : step.groups)
                {
                    for (const FomodOption& option : group.options)
                    {
                        if (!selected.contains(option.id))
                        {
                            continue;
                        }
                        for (const FomodConditionFlag& flag : option.flags)
                        {
                            if (!flag.name.empty())
                            {
                                flags[flag.name] = flag.value;
                            }
                        }
                    }
                }
            }
            return flags;
        }

        [[nodiscard]] std::map<std::wstring, std::set<std::wstring>> pluginProviders(
            const FomodInstallerDescriptor& descriptor)
        {
            std::map<std::wstring, std::set<std::wstring>> output;
            for (const FomodStep& step : descriptor.steps)
            {
                for (const FomodGroup& group : step.groups)
                {
                    for (const FomodOption& option : group.options)
                    {
                        for (const FomodPluginHeader& header : option.pluginHeaders)
                        {
                            if (header.status == FomodPluginHeaderStatus::Parsed)
                            {
                                output[lower(std::filesystem::path(header.outputFile).filename().wstring())]
                                    .insert(option.id);
                            }
                        }
                    }
                }
            }
            return output;
        }

        [[nodiscard]] Tes4Assessment assessTes4(
            const FomodOption& option,
            const FomodProfileContext& context,
            const std::set<std::wstring>& selected,
            const std::map<std::wstring, std::set<std::wstring>>& providers)
        {
            Tes4Assessment assessment;
            std::set<std::wstring> basePlugins;
            for (const std::wstring& plugin : context.basePluginNames)
            {
                basePlugins.insert(lower(plugin));
            }
            for (const FomodPluginHeader& header : option.pluginHeaders)
            {
                if (header.status != FomodPluginHeaderStatus::Parsed)
                {
                    assessment.reviewRequired = true;
                    assessment.eligible = false;
                    assessment.evidence.push_back(FomodDecisionEvidence{
                        header.issueCode.empty() ? L"tes4.reviewRequired" : header.issueCode,
                        header.outputFile,
                        L"readable TES4 header",
                        L"review required",
                        L"package",
                        {}
                    });
                    continue;
                }
                for (const std::wstring& master : header.masters)
                {
                    const std::wstring key = lower(master);
                    if (basePlugins.contains(key))
                    {
                        continue;
                    }
                    assessment.patch = true;
                    const auto provider = providers.find(key);
                    if (provider != providers.end())
                    {
                        const auto selectedProvider = std::find_if(
                            provider->second.begin(),
                            provider->second.end(),
                            [&selected, &option](const std::wstring& optionId)
                            {
                                return optionId == option.id || selected.contains(optionId);
                            });
                        if (selectedProvider != provider->second.end())
                        {
                            assessment.evidence.push_back(FomodDecisionEvidence{
                                L"tes4.master.provided",
                                master,
                                L"Active or selected in this installer",
                                *selectedProvider == option.id
                                    ? L"Provided by this option"
                                    : L"Provided by selected option",
                                L"fomod",
                                *selectedProvider
                            });
                            continue;
                        }
                        assessment.eligible = false;
                        assessment.evidence.push_back(FomodDecisionEvidence{
                            L"tes4.master.providerNotSelected",
                            master,
                            L"Selected in this installer",
                            L"Provider is not selected",
                            L"fomod",
                            provider->second.empty() ? std::wstring{} : *provider->second.begin()
                        });
                        continue;
                    }
                    const FomodProfileFileState* state = pluginState(context, master);
                    if (state != nullptr && state->state == FomodProfileFileStateKind::Active)
                    {
                        assessment.evidence.push_back(FomodDecisionEvidence{
                            L"tes4.master.active",
                            master,
                            L"Active",
                            L"Active",
                            state->sourceKind,
                            state->sourceName
                        });
                        continue;
                    }
                    assessment.eligible = false;
                    assessment.evidence.push_back(FomodDecisionEvidence{
                        state != nullptr && state->state == FomodProfileFileStateKind::Inactive
                            ? L"tes4.master.inactive"
                            : L"tes4.master.missing",
                        master,
                        L"Active",
                        state == nullptr ? L"Missing" : FomodProfileContextService::stateName(state->state),
                        state == nullptr ? std::wstring{} : state->sourceKind,
                        state == nullptr ? std::wstring{} : state->sourceName
                    });
                }
            }
            return assessment;
        }

        [[nodiscard]] bool groupRequiresSelection(std::wstring_view type)
        {
            return equals(type, L"SelectExactlyOne") || equals(type, L"SelectAtLeastOne");
        }

        [[nodiscard]] bool exclusiveGroup(std::wstring_view type)
        {
            return equals(type, L"SelectExactlyOne") || equals(type, L"SelectAtMostOne");
        }

        [[nodiscard]] std::wstring signature(const std::set<std::wstring>& selected)
        {
            std::wstring value;
            for (const std::wstring& id : selected)
            {
                value += id;
                value.push_back(L'\x1f');
            }
            return value;
        }

        [[nodiscard]] FomodUnresolvedGroup unresolvedGroup(
            const FomodStep& step,
            const FomodGroup& group,
            std::wstring reason)
        {
            FomodUnresolvedGroup unresolved;
            unresolved.stepId = step.id;
            unresolved.groupId = group.id;
            unresolved.groupName = group.name;
            unresolved.reasonCode = std::move(reason);
            for (const FomodOption& option : group.options)
            {
                unresolved.optionIds.push_back(option.id);
            }
            return unresolved;
        }

        [[nodiscard]] IterationResult calculate(
            const FomodInstallerDescriptor& descriptor,
            const FomodProfileContext& context,
            const std::set<std::wstring>& current,
            const std::map<std::wstring, bool>& manual,
            bool disableAutomaticSelection)
        {
            IterationResult output;
            const std::map<std::wstring, std::wstring> flags = flagsForSelection(descriptor, current);
            const std::map<std::wstring, std::set<std::wstring>> providers = pluginProviders(descriptor);
            const std::set<std::wstring> remembered(
                descriptor.previousSelectedOptionIds.begin(),
                descriptor.previousSelectedOptionIds.end());
            const std::set<std::wstring> rememberedDeselected(
                descriptor.previousDeselectedOptionIds.begin(),
                descriptor.previousDeselectedOptionIds.end());

            for (const FomodStep& step : descriptor.steps)
            {
                const FomodDependencyResult visibility = step.visible.has_value()
                    ? evaluate(step.visible.value(), context, flags)
                    : FomodDependencyResult::Satisfied;
                if (visibility == FomodDependencyResult::Unsatisfied)
                {
                    for (const FomodGroup& group : step.groups)
                    {
                        for (const FomodOption& option : group.options)
                        {
                            output.decisions.push_back(FomodOptionDecision{
                                option.id,
                                FomodOptionDecisionAction::Deselect,
                                FomodDecisionConfidence::Exact,
                                option.type,
                                {L"step.hidden"},
                                {}
                            });
                        }
                    }
                    continue;
                }

                for (const FomodGroup& group : step.groups)
                {
                    if (visibility == FomodDependencyResult::Unknown || !context.autoSelectionAvailable)
                    {
                        output.unresolved.push_back(unresolvedGroup(
                            step,
                            group,
                            visibility == FomodDependencyResult::Unknown
                                ? L"dependency.unknown"
                                : L"autoselect.unavailable"));
                    }

                    struct Candidate
                    {
                        const FomodOption* option{nullptr};
                        EffectiveOptionType effective;
                        bool manualSelected{false};
                        bool manualDeselected{false};
                        bool hardSelected{false};
                        bool lockedOut{false};
                        bool recommended{false};
                        bool remembered{false};
                        bool rememberedDeselected{false};
                        bool profileRecommended{false};
                        bool authorRecommended{false};
                        int automaticPriority{0};
                        bool ambiguousAutomatic{false};
                        Tes4Assessment tes4;
                    };
                    std::vector<Candidate> candidates;
                    candidates.reserve(group.options.size());
                    for (const FomodOption& option : group.options)
                    {
                        Candidate candidate;
                        candidate.option = &option;
                        candidate.effective = effectiveType(option, context, flags);
                        candidate.lockedOut = equals(candidate.effective.type, L"NotUsable");
                        candidate.tes4 = assessTes4(option, context, current, providers);
                        candidate.effective.evidence.insert(
                            candidate.effective.evidence.end(),
                            candidate.tes4.evidence.begin(),
                            candidate.tes4.evidence.end());
                        candidate.hardSelected = !candidate.lockedOut &&
                            (equals(candidate.effective.type, L"Required") || equals(group.type, L"SelectAll"));
                        const auto pin = manual.find(option.id);
                        candidate.manualSelected = pin != manual.end() && pin->second && !candidate.lockedOut;
                        candidate.manualDeselected = pin != manual.end() && !pin->second && !candidate.hardSelected;
                        candidate.remembered = !disableAutomaticSelection &&
                            !candidate.effective.unknown && !candidate.lockedOut &&
                            !equals(candidate.effective.type, L"CouldBeUsable") && remembered.contains(option.id);
                        candidate.rememberedDeselected = !disableAutomaticSelection &&
                            rememberedDeselected.contains(option.id);
                        candidate.profileRecommended = candidate.effective.profileExact &&
                            equals(candidate.effective.type, L"Recommended");
                        candidate.authorRecommended = equals(candidate.effective.type, L"Recommended") &&
                            !candidate.effective.profileExact;
                        candidate.recommended = !disableAutomaticSelection &&
                            context.autoSelectionAvailable && visibility == FomodDependencyResult::Satisfied &&
                            !candidate.effective.unknown && candidate.tes4.eligible &&
                            !equals(candidate.effective.type, L"CouldBeUsable") &&
                            (candidate.profileRecommended || candidate.remembered ||
                             (candidate.authorRecommended && !candidate.rememberedDeselected));
                        if (candidate.recommended)
                        {
                            candidate.automaticPriority = candidate.profileRecommended
                                ? 3
                                : (candidate.remembered ? 2 : 1);
                        }
                        candidates.push_back(std::move(candidate));
                    }

                    std::vector<Candidate*> automatic;
                    std::vector<Candidate*> manualSelected;
                    for (Candidate& candidate : candidates)
                    {
                        if (candidate.hardSelected || candidate.manualSelected)
                        {
                            output.selected.insert(candidate.option->id);
                        }
                        if (candidate.manualSelected)
                        {
                            manualSelected.push_back(&candidate);
                        }
                        if (!candidate.hardSelected && !candidate.manualSelected && !candidate.manualDeselected &&
                            !candidate.lockedOut && candidate.automaticPriority > 0)
                        {
                            automatic.push_back(&candidate);
                        }
                    }

                    if (exclusiveGroup(group.type))
                    {
                        if (!automatic.empty())
                        {
                            const int highestPriority = (*std::max_element(
                                automatic.begin(),
                                automatic.end(),
                                [](const Candidate* left, const Candidate* right)
                                {
                                    return left->automaticPriority < right->automaticPriority;
                                }))->automaticPriority;
                            std::erase_if(
                                automatic,
                                [highestPriority](const Candidate* candidate)
                                {
                                    return candidate->automaticPriority != highestPriority;
                                });
                        }
                        if (manualSelected.size() > 1)
                        {
                            for (std::size_t index = 0; index + 1 < manualSelected.size(); ++index)
                            {
                                output.selected.erase(manualSelected[index]->option->id);
                            }
                        }
                        if (manualSelected.empty() && automatic.size() == 1)
                        {
                            output.selected.insert(automatic.front()->option->id);
                        }
                        else if (manualSelected.empty() && automatic.size() > 1)
                        {
                            for (Candidate* candidate : automatic)
                            {
                                candidate->ambiguousAutomatic = true;
                            }
                            output.unresolved.push_back(unresolvedGroup(step, group, L"group.ambiguous"));
                        }
                    }
                    else
                    {
                        for (Candidate* candidate : automatic)
                        {
                            output.selected.insert(candidate->option->id);
                        }
                    }

                    const bool hasGroupSelection = std::any_of(
                        candidates.begin(),
                        candidates.end(),
                        [&output](const Candidate& candidate)
                        {
                            return output.selected.contains(candidate.option->id);
                        });
                    if (groupRequiresSelection(group.type) && !hasGroupSelection &&
                        std::none_of(
                            output.unresolved.begin(),
                            output.unresolved.end(),
                            [&group](const FomodUnresolvedGroup& unresolved)
                            {
                                return unresolved.groupId == group.id;
                            }))
                    {
                        output.unresolved.push_back(unresolvedGroup(step, group, L"group.selectionRequired"));
                    }
                    if (std::any_of(
                            candidates.begin(),
                            candidates.end(),
                            [](const Candidate& candidate)
                            {
                                return candidate.tes4.reviewRequired ||
                                    (candidate.tes4.patch && !candidate.tes4.eligible);
                            }) &&
                        std::none_of(
                            output.unresolved.begin(),
                            output.unresolved.end(),
                            [&group](const FomodUnresolvedGroup& unresolved)
                            {
                                return unresolved.groupId == group.id;
                            }))
                    {
                        output.unresolved.push_back(unresolvedGroup(step, group, L"tes4.masterUnavailable"));
                    }

                    for (const Candidate& candidate : candidates)
                    {
                        FomodOptionDecision decision;
                        decision.optionId = candidate.option->id;
                        decision.effectiveType = candidate.effective.type;
                        decision.evidence = candidate.effective.evidence;
                        if (candidate.lockedOut)
                        {
                            decision.action = FomodOptionDecisionAction::Locked;
                            decision.confidence = FomodDecisionConfidence::Exact;
                            decision.reasonCodes = {L"fomod.notUsable"};
                        }
                        else if (candidate.hardSelected)
                        {
                            decision.action = FomodOptionDecisionAction::Locked;
                            decision.confidence = FomodDecisionConfidence::Exact;
                            decision.reasonCodes = {equals(group.type, L"SelectAll") ? L"fomod.selectAll" : L"fomod.required"};
                        }
                        else if (candidate.manualSelected || candidate.manualDeselected)
                        {
                            decision.action = candidate.manualSelected
                                ? FomodOptionDecisionAction::Select
                                : FomodOptionDecisionAction::Deselect;
                            decision.confidence = FomodDecisionConfidence::Exact;
                            decision.reasonCodes = {L"manual.session"};
                        }
                        else if (candidate.effective.unknown || candidate.tes4.reviewRequired ||
                            (candidate.tes4.patch && !candidate.tes4.eligible) ||
                            visibility == FomodDependencyResult::Unknown ||
                            !context.autoSelectionAvailable || equals(candidate.effective.type, L"CouldBeUsable") ||
                            candidate.ambiguousAutomatic)
                        {
                            decision.action = FomodOptionDecisionAction::Manual;
                            decision.confidence = FomodDecisionConfidence::None;
                            if (candidate.effective.unknown || visibility == FomodDependencyResult::Unknown)
                            {
                                decision.reasonCodes = {L"dependency.unknown"};
                            }
                            else if (candidate.tes4.reviewRequired)
                            {
                                decision.reasonCodes = {L"tes4.reviewRequired"};
                            }
                            else if (candidate.tes4.patch && !candidate.tes4.eligible)
                            {
                                decision.reasonCodes = {L"tes4.masterUnavailable"};
                            }
                            else if (!context.autoSelectionAvailable)
                            {
                                decision.reasonCodes = {L"autoselect.unavailable"};
                            }
                            else if (equals(candidate.effective.type, L"CouldBeUsable"))
                            {
                                decision.reasonCodes = {L"fomod.couldBeUsable"};
                            }
                            else
                            {
                                decision.reasonCodes = {L"group.ambiguous"};
                            }
                        }
                        else if (output.selected.contains(candidate.option->id))
                        {
                            decision.action = FomodOptionDecisionAction::Select;
                            if (candidate.profileRecommended)
                            {
                                decision.confidence = FomodDecisionConfidence::Exact;
                                decision.reasonCodes = {L"profile.exactRecommendation"};
                            }
                            else if (candidate.remembered)
                            {
                                decision.confidence = descriptor.previousSelectionContextual
                                    ? FomodDecisionConfidence::Exact
                                    : FomodDecisionConfidence::Weak;
                                decision.reasonCodes = {
                                    descriptor.previousSelectionContextual
                                        ? L"memory.contextual"
                                        : descriptor.previousSelectionWeak
                                            ? L"memory.v1WeakHint"
                                            : L"memory.global"
                                };
                            }
                            else
                            {
                                decision.confidence = FomodDecisionConfidence::Strong;
                                decision.reasonCodes = {L"author.recommended"};
                            }
                        }
                        else if (candidate.rememberedDeselected && !candidate.profileRecommended)
                        {
                            decision.action = FomodOptionDecisionAction::Deselect;
                            decision.confidence = descriptor.previousSelectionContextual
                                ? FomodDecisionConfidence::Exact
                                : FomodDecisionConfidence::Weak;
                            decision.reasonCodes = {
                                descriptor.previousSelectionWeak
                                    ? L"memory.v1WeakHint"
                                    : L"memory.global"
                            };
                        }
                        else
                        {
                            decision.action = FomodOptionDecisionAction::Deselect;
                            decision.confidence = FomodDecisionConfidence::Strong;
                            decision.reasonCodes = {L"author.optional"};
                        }
                        output.decisions.push_back(std::move(decision));
                    }
                }
            }
            return output;
        }

        [[nodiscard]] std::map<std::wstring, bool> manualMap(
            const std::vector<FomodManualDecision>& manualDecisions)
        {
            std::map<std::wstring, bool> output;
            for (const FomodManualDecision& decision : manualDecisions)
            {
                if (!decision.optionId.empty())
                {
                    output[decision.optionId] = decision.selected;
                }
            }
            return output;
        }

        [[nodiscard]] std::vector<std::wstring> descriptorOrder(
            const FomodInstallerDescriptor& descriptor,
            const std::set<std::wstring>& selected)
        {
            std::vector<std::wstring> output;
            for (const FomodStep& step : descriptor.steps)
            {
                for (const FomodGroup& group : step.groups)
                {
                    for (const FomodOption& option : group.options)
                    {
                        if (selected.contains(option.id))
                        {
                            output.push_back(option.id);
                        }
                    }
                }
            }
            return output;
        }
    }

    FomodAutoSelection FomodAutoSelectionService::analyze(
        const FomodInstallerDescriptor& descriptor,
        const FomodProfileContext& context,
        const std::vector<FomodManualDecision>& manualDecisions)
    {
        FomodAutoSelection output;
        output.contextId = context.contextId;
        if (descriptor.moduleDependencies.has_value())
        {
            output.moduleDependencyResult = evaluate(
                descriptor.moduleDependencies.value(),
                context,
                {});
            output.installBlocked = output.moduleDependencyResult == FomodDependencyResult::Unsatisfied;
            if (output.moduleDependencyResult == FomodDependencyResult::Unknown)
            {
                output.warnings.push_back(L"moduleDependencies.unknown");
            }
            else if (output.installBlocked)
            {
                output.warnings.push_back(L"moduleDependencies.unsatisfied");
            }
        }
        if (!context.autoSelectionAvailable && !context.unavailableReason.empty())
        {
            output.warnings.push_back(L"autoselect.unavailable");
        }

        const std::map<std::wstring, bool> manual = manualMap(manualDecisions);
        const bool moduleDependencyUnknown =
            output.moduleDependencyResult == FomodDependencyResult::Unknown;
        std::map<std::wstring, std::wstring> groupIdByOptionId;
        for (const FomodStep& step : descriptor.steps)
        {
            for (const FomodGroup& group : step.groups)
            {
                for (const FomodOption& option : group.options)
                {
                    groupIdByOptionId[option.id] = group.id;
                }
            }
        }
        std::set<std::wstring> selected;
        std::map<std::wstring, std::size_t> seen{{signature(selected), 0}};
        const std::size_t optionCount = [&descriptor]()
        {
            std::size_t count = 0;
            for (const FomodStep& step : descriptor.steps)
            {
                for (const FomodGroup& group : step.groups)
                {
                    count += group.options.size();
                }
            }
            return count;
        }();
        const std::size_t limit = std::max<std::size_t>(8, optionCount * 2 + 4);
        IterationResult final;
        for (std::size_t iteration = 0; iteration < limit; ++iteration)
        {
            IterationResult next = calculate(
                descriptor,
                context,
                selected,
                manual,
                moduleDependencyUnknown);
            if (next.selected == selected)
            {
                final = std::move(next);
                break;
            }
            const std::wstring nextSignature = signature(next.selected);
            if (seen.contains(nextSignature))
            {
                output.cycleDetected = true;
                std::set<std::wstring> changedOptionIds;
                std::set_symmetric_difference(
                    selected.begin(),
                    selected.end(),
                    next.selected.begin(),
                    next.selected.end(),
                    std::inserter(changedOptionIds, changedOptionIds.end()));
                for (const FomodOptionDecision& decision : next.decisions)
                {
                    const auto previous = std::find_if(
                        final.decisions.begin(),
                        final.decisions.end(),
                        [&decision](const FomodOptionDecision& candidate)
                        {
                            return candidate.optionId == decision.optionId;
                        });
                    if (previous != final.decisions.end() &&
                        (previous->action != decision.action ||
                         previous->effectiveType != decision.effectiveType ||
                         previous->reasonCodes != decision.reasonCodes))
                    {
                        changedOptionIds.insert(decision.optionId);
                    }
                }

                std::set<std::wstring> affectedGroupIds;
                for (const std::wstring& optionId : changedOptionIds)
                {
                    if (const auto group = groupIdByOptionId.find(optionId);
                        group != groupIdByOptionId.end())
                    {
                        affectedGroupIds.insert(group->second);
                    }
                }
                if (affectedGroupIds.empty())
                {
                    for (const auto& [_, groupId] : groupIdByOptionId)
                    {
                        affectedGroupIds.insert(groupId);
                    }
                }
                final = std::move(next);
                std::erase_if(
                    final.unresolved,
                    [&affectedGroupIds](const FomodUnresolvedGroup& unresolved)
                    {
                        return affectedGroupIds.contains(unresolved.groupId);
                    });
                for (const FomodStep& step : descriptor.steps)
                {
                    for (const FomodGroup& group : step.groups)
                    {
                        if (affectedGroupIds.contains(group.id))
                        {
                            final.unresolved.push_back(unresolvedGroup(step, group, L"dependency.cycle"));
                        }
                    }
                }
                for (FomodOptionDecision& decision : final.decisions)
                {
                    const auto group = groupIdByOptionId.find(decision.optionId);
                    const bool affected = group != groupIdByOptionId.end() &&
                        affectedGroupIds.contains(group->second);
                    if (affected &&
                        decision.reasonCodes != std::vector<std::wstring>{L"fomod.required"} &&
                        decision.reasonCodes != std::vector<std::wstring>{L"fomod.selectAll"} &&
                        decision.reasonCodes != std::vector<std::wstring>{L"fomod.notUsable"} &&
                        decision.reasonCodes != std::vector<std::wstring>{L"manual.session"})
                    {
                        final.selected.erase(decision.optionId);
                        decision.action = FomodOptionDecisionAction::Manual;
                        decision.confidence = FomodDecisionConfidence::None;
                        decision.reasonCodes = {L"dependency.cycle"};
                    }
                }
                break;
            }
            seen[nextSignature] = iteration + 1;
            selected = std::move(next.selected);
            final = std::move(next);
        }
        if (final.decisions.empty() && !descriptor.steps.empty())
        {
            output.cycleDetected = true;
            final = calculate(descriptor, context, {}, manual, true);
        }
        if (moduleDependencyUnknown)
        {
            for (const FomodStep& step : descriptor.steps)
            {
                for (const FomodGroup& group : step.groups)
                {
                    const bool hidden = std::all_of(
                        group.options.begin(),
                        group.options.end(),
                        [&final](const FomodOption& option)
                        {
                            const auto decision = std::find_if(
                                final.decisions.begin(),
                                final.decisions.end(),
                                [&option](const FomodOptionDecision& candidate)
                                {
                                    return candidate.optionId == option.id;
                                });
                            return decision != final.decisions.end() &&
                                decision->reasonCodes == std::vector<std::wstring>{L"step.hidden"};
                        });
                    if (!hidden && std::none_of(
                            final.unresolved.begin(),
                            final.unresolved.end(),
                            [&group](const FomodUnresolvedGroup& unresolved)
                            {
                                return unresolved.groupId == group.id;
                            }))
                    {
                        final.unresolved.push_back(unresolvedGroup(step, group, L"dependency.unknown"));
                    }
                }
            }
            for (FomodOptionDecision& decision : final.decisions)
            {
                if (decision.reasonCodes != std::vector<std::wstring>{L"fomod.required"} &&
                    decision.reasonCodes != std::vector<std::wstring>{L"fomod.selectAll"} &&
                    decision.reasonCodes != std::vector<std::wstring>{L"fomod.notUsable"} &&
                    decision.reasonCodes != std::vector<std::wstring>{L"manual.session"} &&
                    decision.reasonCodes != std::vector<std::wstring>{L"step.hidden"})
                {
                    final.selected.erase(decision.optionId);
                    decision.action = FomodOptionDecisionAction::Manual;
                    decision.confidence = FomodDecisionConfidence::None;
                    decision.reasonCodes = {L"dependency.unknown"};
                }
            }
        }
        output.initialSelectedOptionIds = descriptorOrder(descriptor, final.selected);
        output.unresolvedGroups = std::move(final.unresolved);
        output.decisions = std::move(final.decisions);
        return output;
    }

    FomodProfileContext FomodAutoSelectionService::bindContext(
        const std::filesystem::path& projectDirectory,
        std::wstring_view archiveFingerprint,
        FomodProfileContext context)
    {
        const std::chrono::steady_clock::time_point now = std::chrono::steady_clock::now();
        ContextBinding requested;
        requested.projectKey = projectKey(projectDirectory);
        requested.archiveFingerprint = std::wstring(archiveFingerprint);
        requested.profileName = context.profileName;
        requested.profileFingerprint = context.fingerprint;
        requested.modRevision = context.modRevision;
        requested.pluginRevision = context.pluginRevision;
        requested.createdAt = now;

        const std::lock_guard lock(contextBindingsMutex());
        purgeExpiredBindings(now);
        const auto existing = std::find_if(
            contextBindings().begin(),
            contextBindings().end(),
            [&requested](const ContextBinding& binding)
            {
                return binding.projectKey == requested.projectKey &&
                    binding.archiveFingerprint == requested.archiveFingerprint &&
                    equals(binding.profileName, requested.profileName) &&
                    binding.profileFingerprint == requested.profileFingerprint &&
                    binding.modRevision == requested.modRevision &&
                    binding.pluginRevision == requested.pluginRevision;
            });
        if (existing != contextBindings().end())
        {
            context.contextId = existing->contextId;
            return context;
        }
        requested.contextId = bindingId(requested);
        while (contextBindings().size() >= maxContextBindings)
        {
            contextBindings().pop_front();
        }
        context.contextId = requested.contextId;
        contextBindings().push_back(std::move(requested));
        return context;
    }

    void FomodAutoSelectionService::validateContext(
        const std::filesystem::path& projectDirectory,
        std::wstring_view archiveFingerprint,
        std::wstring_view contextId,
        const FomodProfileContext& currentContext)
    {
        if (trim(contextId).empty())
        {
            return;
        }
        const std::chrono::steady_clock::time_point now = std::chrono::steady_clock::now();
        const std::wstring currentProjectKey = projectKey(projectDirectory);
        const std::lock_guard lock(contextBindingsMutex());
        purgeExpiredBindings(now);
        const auto binding = std::find_if(
            contextBindings().begin(),
            contextBindings().end(),
            [contextId](const ContextBinding& candidate)
            {
                return candidate.contextId == contextId;
            });
        const bool valid = binding != contextBindings().end() &&
            binding->projectKey == currentProjectKey &&
            binding->archiveFingerprint == archiveFingerprint &&
            equals(binding->profileName, currentContext.profileName) &&
            binding->modRevision == currentContext.modRevision &&
            binding->pluginRevision == currentContext.pluginRevision;
        if (!valid)
        {
            throw std::runtime_error("install.fomodContextChanged");
        }
    }

    FomodDependencyResult FomodAutoSelectionService::evaluateDependency(
        const FomodDependencyNode& dependency,
        const FomodProfileContext& context,
        const std::map<std::wstring, std::wstring>& flags)
    {
        return evaluate(dependency, context, flags);
    }

    std::wstring FomodAutoSelectionService::dependencyResultName(FomodDependencyResult result)
    {
        switch (result)
        {
        case FomodDependencyResult::Satisfied:
            return L"satisfied";
        case FomodDependencyResult::Unsatisfied:
            return L"unsatisfied";
        case FomodDependencyResult::Unknown:
        default:
            return L"unknown";
        }
    }

    std::wstring FomodAutoSelectionService::actionName(FomodOptionDecisionAction action)
    {
        switch (action)
        {
        case FomodOptionDecisionAction::Select:
            return L"select";
        case FomodOptionDecisionAction::Deselect:
            return L"deselect";
        case FomodOptionDecisionAction::Locked:
            return L"locked";
        case FomodOptionDecisionAction::Manual:
        default:
            return L"manual";
        }
    }

    std::wstring FomodAutoSelectionService::confidenceName(FomodDecisionConfidence confidence)
    {
        switch (confidence)
        {
        case FomodDecisionConfidence::Weak:
            return L"weak";
        case FomodDecisionConfidence::Strong:
            return L"strong";
        case FomodDecisionConfidence::Exact:
            return L"exact";
        case FomodDecisionConfidence::None:
        default:
            return L"none";
        }
    }
}
