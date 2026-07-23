use regex::{Captures, Regex};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::io::{self, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::time::Instant;
use whisper_rs::{
    FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters, WhisperVadContext,
    WhisperVadContextParams, WhisperVadParams,
};

const FRAME_MAGIC: &[u8; 4] = b"FLXS";
const FRAME_VERSION: u16 = 1;
const MAX_HEADER_BYTES: usize = 64 * 1024;
const SPEECH_HOST_STACK_BYTES: usize = 32 * 1024 * 1024;
const MAX_PCM_BYTES: usize = 16_000 * 5 * 60 * 4;
const MODEL_VERSION: &str = "small-q5_1";
const WHISPER_TRANSLATE: bool = false;
#[cfg(feature = "speech-vulkan")]
const SPEECH_BACKEND: &str = "vulkan";
#[cfg(not(feature = "speech-vulkan"))]
const SPEECH_BACKEND: &str = "cpu";
const GLOSSARY_JSON: &str = include_str!("../../../speech/glossary.v1.json");
const SAMPLE_RATE_HZ: usize = 16_000;
const SINGLE_SEGMENT_MAX_SAMPLES: usize = SAMPLE_RATE_HZ * 30;
const SAMPLES_PER_AUDIO_CONTEXT_TOKEN: usize = 320;
const AUDIO_CONTEXT_PADDING_TOKENS: usize = 64;
const AUDIO_CONTEXT_QUANTUM_TOKENS: usize = 64;
const MIN_AUDIO_CONTEXT_TOKENS: usize = 128;
const MAX_AUDIO_CONTEXT_TOKENS: usize = 1_500;
const ADAPTIVE_CONTEXT_MATCH_THRESHOLD: f32 = 0.72;
const ADAPTIVE_CONTEXT_REPAIR_THRESHOLD: f32 = 0.64;
const MAX_ADAPTIVE_CONTEXT_HINTS: usize = 4;
const MAX_CONTEXT_HINTS: usize = 96;
const MAX_CONTEXT_HINT_CHARS: usize = 96;
const MAX_CONTEXT_HINT_TOTAL_CHARS: usize = 4_096;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DecoderSampling {
    Greedy,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct DecoderPlan {
    sampling: DecoderSampling,
    best_of: i32,
    single_segment: bool,
    max_tokens: i32,
    audio_context_tokens: i32,
}

fn decoder_plan(sample_count: usize) -> DecoderPlan {
    let single_segment = sample_count <= SINGLE_SEGMENT_MAX_SAMPLES;
    let max_tokens = if single_segment {
        let seconds = sample_count.saturating_add(SAMPLE_RATE_HZ - 1) / SAMPLE_RATE_HZ;
        (seconds.saturating_mul(4).saturating_add(8)).clamp(16, 128) as i32
    } else {
        128
    };
    let audio_context_tokens = if single_segment {
        let required = sample_count.saturating_add(SAMPLES_PER_AUDIO_CONTEXT_TOKEN - 1)
            / SAMPLES_PER_AUDIO_CONTEXT_TOKEN;
        let padded = required.saturating_add(AUDIO_CONTEXT_PADDING_TOKENS);
        let rounded = padded.saturating_add(AUDIO_CONTEXT_QUANTUM_TOKENS - 1)
            / AUDIO_CONTEXT_QUANTUM_TOKENS
            * AUDIO_CONTEXT_QUANTUM_TOKENS;
        rounded.clamp(MIN_AUDIO_CONTEXT_TOKENS, MAX_AUDIO_CONTEXT_TOKENS) as i32
    } else {
        0
    };
    DecoderPlan {
        sampling: DecoderSampling::Greedy,
        best_of: 1,
        single_segment,
        max_tokens,
        audio_context_tokens,
    }
}

fn vad_speech_window(
    sample_count: usize,
    start_centiseconds: f32,
    end_centiseconds: f32,
) -> std::ops::Range<usize> {
    if !start_centiseconds.is_finite()
        || !end_centiseconds.is_finite()
        || end_centiseconds <= start_centiseconds
    {
        return 0..sample_count;
    }
    let samples_per_centisecond = SAMPLE_RATE_HZ as f32 / 100.0;
    let start = (start_centiseconds.max(0.0) * samples_per_centisecond).floor() as usize;
    let end = (end_centiseconds.max(0.0) * samples_per_centisecond).ceil() as usize;
    let start = start.min(sample_count);
    let end = end.min(sample_count);
    if start < end {
        start..end
    } else {
        0..sample_count
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HostRequest {
    schema: String,
    id: String,
    method: String,
    operation_id: String,
    #[serde(default)]
    metadata: Value,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct HostError {
    code: String,
    message: String,
    retryable: bool,
}

#[derive(Debug, Serialize)]
struct HostResponse {
    schema: &'static str,
    id: String,
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<HostError>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SpeechManifest {
    version: String,
    model: ModelAsset,
    vad: ModelAsset,
    glossary: GlossaryAsset,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ModelAsset {
    version: String,
    file_name: String,
    sha256: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GlossaryAsset {
    version: String,
}

#[derive(Debug, Deserialize)]
struct GlossaryDocument {
    version: String,
    #[serde(rename = "properNames")]
    proper_names: Vec<GlossaryTerm>,
    #[serde(rename = "languageTerms", default)]
    language_terms: HashMap<String, Vec<GlossaryTerm>>,
}

#[derive(Debug, Deserialize)]
struct GlossaryTerm {
    canonical: String,
    aliases: Vec<String>,
}

struct TermNormalizer {
    replacements: HashMap<String, String>,
    matcher: Regex,
}

impl TermNormalizer {
    fn compile(terms: Vec<GlossaryTerm>) -> Result<Self, HostError> {
        let mut aliases = Vec::new();
        let mut replacements = HashMap::new();
        for term in terms {
            for alias in term
                .aliases
                .into_iter()
                .chain(std::iter::once(term.canonical.clone()))
            {
                replacements.insert(alias.to_lowercase(), term.canonical.clone());
                aliases.push(alias);
            }
        }
        aliases.sort_by_key(|alias| std::cmp::Reverse(alias.chars().count()));
        aliases.dedup_by(|left, right| left.eq_ignore_ascii_case(right));
        let pattern = aliases
            .iter()
            .map(|alias| regex::escape(alias))
            .collect::<Vec<_>>()
            .join("|");
        let matcher = Regex::new(&format!(r"(?iu)\b(?:{pattern})\b")).map_err(|_| {
            host_error(
                "speech.glossary.invalid",
                "The built-in speech glossary cannot be compiled.",
                false,
            )
        })?;
        Ok(Self {
            replacements,
            matcher,
        })
    }

    fn normalize(&self, transcript: &str) -> String {
        self.matcher
            .replace_all(transcript, |captures: &Captures<'_>| {
                let matched = captures
                    .get(0)
                    .map(|value| value.as_str())
                    .unwrap_or_default();
                self.replacements
                    .get(&matched.to_lowercase())
                    .cloned()
                    .unwrap_or_else(|| matched.to_string())
            })
            .into_owned()
    }
}

struct Glossary {
    proper_names: TermNormalizer,
    language_terms: HashMap<String, TermNormalizer>,
    version: String,
}

impl Glossary {
    fn load() -> Result<Self, HostError> {
        let document: GlossaryDocument = serde_json::from_str(GLOSSARY_JSON).map_err(|_| {
            host_error(
                "speech.glossary.invalid",
                "The built-in speech glossary is invalid.",
                false,
            )
        })?;
        let proper_names = TermNormalizer::compile(document.proper_names)?;
        let language_terms = document
            .language_terms
            .into_iter()
            .map(|(language, terms)| {
                TermNormalizer::compile(terms).map(|normalizer| (language, normalizer))
            })
            .collect::<Result<HashMap<_, _>, _>>()?;
        Ok(Self {
            proper_names,
            language_terms,
            version: document.version,
        })
    }

    fn normalize(&self, transcript: &str, detected_language: Option<&str>) -> String {
        let names_normalized = self.proper_names.normalize(transcript);
        self.language_terms
            .get(detected_language.unwrap_or_default())
            .map(|normalizer| normalizer.normalize(&names_normalized))
            .unwrap_or(names_normalized)
            .trim()
            .to_string()
    }
}

fn phonetic_characters(value: &str) -> Vec<char> {
    let mut folded = String::with_capacity(value.len());
    for character in value.chars().flat_map(char::to_lowercase) {
        let replacement = match character {
            'а' => "a",
            'б' => "b",
            'в' => "v",
            'г' => "g",
            'д' => "d",
            'е' | 'ё' | 'э' => "e",
            'ж' => "zh",
            'з' => "z",
            'и' | 'й' | 'ы' => "i",
            'к' => "k",
            'л' => "l",
            'м' => "m",
            'н' => "n",
            'о' => "o",
            'п' => "p",
            'р' => "r",
            'с' => "s",
            'т' => "t",
            'у' => "u",
            'ф' => "f",
            'х' => "h",
            'ц' => "ts",
            'ч' => "ch",
            'ш' | 'щ' => "sh",
            'ю' => "yu",
            'я' => "ya",
            'ь' | 'ъ' => "",
            _ if character.is_ascii_alphanumeric() => {
                folded.push(character);
                continue;
            }
            _ => continue,
        };
        folded.push_str(replacement);
    }
    folded.chars().collect()
}

fn edit_distance(left: &[char], right: &[char]) -> usize {
    if left.is_empty() {
        return right.len();
    }
    if right.is_empty() {
        return left.len();
    }
    let mut previous = (0..=right.len()).collect::<Vec<_>>();
    let mut current = vec![0; right.len() + 1];
    for (left_index, left_character) in left.iter().enumerate() {
        current[0] = left_index + 1;
        for (right_index, right_character) in right.iter().enumerate() {
            let substitution =
                previous[right_index] + usize::from(left_character != right_character);
            current[right_index + 1] = substitution
                .min(current[right_index] + 1)
                .min(previous[right_index + 1] + 1);
        }
        std::mem::swap(&mut previous, &mut current);
    }
    previous[right.len()]
}

fn best_phonetic_similarity(transcript: &[char], phrase: &[char]) -> f32 {
    if transcript.is_empty() || phrase.is_empty() {
        return 0.0;
    }
    let minimum_length = (phrase.len() * 3 / 4).max(4).min(transcript.len());
    let maximum_length = (phrase.len() * 5 / 4 + 2).min(transcript.len());
    let mut best = 0.0_f32;
    for candidate_length in minimum_length..=maximum_length {
        for candidate in transcript.windows(candidate_length) {
            let distance = edit_distance(candidate, phrase);
            let scale = candidate.len().max(phrase.len()) as f32;
            best = best.max(1.0 - distance as f32 / scale);
        }
    }
    best
}

fn context_hint_phrases(hint: &str) -> Vec<String> {
    let mut phrases = Vec::new();
    let words = hint
        .split(|character: char| !character.is_alphanumeric())
        .filter(|word| !word.is_empty())
        .collect::<Vec<_>>();
    if !hint.trim().is_empty() {
        phrases.push(hint.trim().to_string());
    }
    for word_count in 2..=words.len().min(6) {
        for phrase in words.windows(word_count) {
            phrases.push(phrase.join(" "));
        }
    }
    phrases.sort_by_key(|phrase| std::cmp::Reverse(phrase.chars().count()));
    phrases.dedup_by(|left, right| left.eq_ignore_ascii_case(right));
    phrases
}

fn context_hint_score(transcript: &str, hint: &str) -> Option<f32> {
    let transcript = phonetic_characters(transcript);
    context_hint_phrases(hint)
        .into_iter()
        .filter_map(|phrase| {
            let folded = phonetic_characters(&phrase);
            (folded.len() >= 7).then(|| (best_phonetic_similarity(&transcript, &folded), phrase))
        })
        .map(|(score, _)| score)
        .max_by(f32::total_cmp)
}

fn adaptive_context_hints(transcript: &str, hints: &[String]) -> Vec<String> {
    let mut scored = hints
        .iter()
        .filter_map(|hint| {
            let score = context_hint_score(transcript, hint)?;
            (score >= ADAPTIVE_CONTEXT_MATCH_THRESHOLD).then_some((score, hint.clone()))
        })
        .collect::<Vec<_>>();
    scored.sort_by(|left, right| right.0.total_cmp(&left.0));
    let mut selected = Vec::new();
    let mut seen = HashSet::new();
    for (_, phrase) in scored {
        if seen.insert(phrase.to_lowercase()) {
            selected.push(phrase);
        }
        if selected.len() >= MAX_ADAPTIVE_CONTEXT_HINTS {
            break;
        }
    }
    selected
}

#[derive(Debug, Clone)]
struct PhoneticSourceCharacter {
    value: char,
    source_start: usize,
    source_end: usize,
}

#[derive(Debug, Clone)]
struct PhoneticSpanMatch {
    score: f32,
    source_start: usize,
    source_end: usize,
}

fn phonetic_characters_with_source(value: &str) -> Vec<PhoneticSourceCharacter> {
    let mut folded = Vec::new();
    for (source_start, source_character) in value.char_indices() {
        let source_end = source_start + source_character.len_utf8();
        for character in source_character.to_lowercase() {
            let replacement = match character {
                'а' => "a",
                'б' => "b",
                'в' => "v",
                'г' => "g",
                'д' => "d",
                'е' | 'ё' | 'э' => "e",
                'ж' => "zh",
                'з' => "z",
                'и' | 'й' | 'ы' => "i",
                'к' => "k",
                'л' => "l",
                'м' => "m",
                'н' => "n",
                'о' => "o",
                'п' => "p",
                'р' => "r",
                'с' => "s",
                'т' => "t",
                'у' => "u",
                'ф' => "f",
                'х' => "h",
                'ц' => "ts",
                'ч' => "ch",
                'ш' | 'щ' => "sh",
                'ю' => "yu",
                'я' => "ya",
                'ь' | 'ъ' => "",
                _ if character.is_ascii_alphanumeric() => {
                    folded.push(PhoneticSourceCharacter {
                        value: character,
                        source_start,
                        source_end,
                    });
                    continue;
                }
                _ => continue,
            };
            folded.extend(replacement.chars().map(|value| PhoneticSourceCharacter {
                value,
                source_start,
                source_end,
            }));
        }
    }
    folded
}

fn expand_to_word_boundaries(value: &str, mut start: usize, mut end: usize) -> (usize, usize) {
    while let Some((previous_start, previous)) = value[..start].char_indices().next_back() {
        if !previous.is_alphanumeric() {
            break;
        }
        start = previous_start;
    }
    while let Some(next) = value[end..].chars().next() {
        if !next.is_alphanumeric() {
            break;
        }
        end += next.len_utf8();
    }
    (start, end)
}

fn best_phonetic_span(transcript: &str, phrase: &str) -> Option<PhoneticSpanMatch> {
    let phonetic_transcript = phonetic_characters_with_source(transcript);
    let phrase = phonetic_characters(phrase);
    if phonetic_transcript.is_empty() || phrase.is_empty() {
        return None;
    }
    let minimum_length = (phrase.len() * 3 / 4).max(4).min(phonetic_transcript.len());
    let maximum_length = (phrase.len() * 5 / 4 + 2).min(phonetic_transcript.len());
    let mut best: Option<PhoneticSpanMatch> = None;
    for candidate_length in minimum_length..=maximum_length {
        for candidate in phonetic_transcript.windows(candidate_length) {
            let candidate_characters = candidate.iter().map(|item| item.value).collect::<Vec<_>>();
            let distance = edit_distance(&candidate_characters, &phrase);
            let scale = candidate.len().max(phrase.len()) as f32;
            let score = 1.0 - distance as f32 / scale;
            if best.as_ref().map_or(true, |current| score > current.score) {
                let (source_start, source_end) = expand_to_word_boundaries(
                    transcript,
                    candidate.first()?.source_start,
                    candidate.last()?.source_end,
                );
                best = Some(PhoneticSpanMatch {
                    score,
                    source_start,
                    source_end,
                });
            }
        }
    }
    best
}

fn normalize_phonetic_context_spans(transcript: &str, hints: &[String]) -> String {
    let transcript_lowercase = transcript.to_lowercase();
    let mut candidates = hints
        .iter()
        .filter(|hint| !transcript_lowercase.contains(&hint.to_lowercase()))
        .filter(|hint| {
            hint.chars()
                .any(|character| character.is_ascii_alphabetic())
        })
        .filter(|hint| {
            ![" - ", " – ", " — ", " | ", " / "]
                .iter()
                .any(|separator| hint.contains(separator))
        })
        .filter_map(|hint| {
            let matched = best_phonetic_span(transcript, hint)?;
            let word_count = hint
                .split(|character: char| !character.is_alphanumeric())
                .filter(|word| !word.is_empty())
                .count();
            let threshold = if word_count >= 3 {
                ADAPTIVE_CONTEXT_REPAIR_THRESHOLD
            } else if word_count == 2 {
                ADAPTIVE_CONTEXT_MATCH_THRESHOLD
            } else {
                0.86
            };
            (matched.score >= threshold).then_some((matched, hint))
        })
        .collect::<Vec<_>>();
    candidates.sort_by(|left, right| right.0.score.total_cmp(&left.0.score));

    let mut replacements: Vec<(usize, usize, &str)> = Vec::new();
    for (matched, hint) in candidates {
        let overlaps = replacements
            .iter()
            .any(|(start, end, _)| matched.source_start < *end && matched.source_end > *start);
        if !overlaps {
            replacements.push((matched.source_start, matched.source_end, hint));
        }
    }
    replacements.sort_by_key(|(start, _, _)| std::cmp::Reverse(*start));
    let mut normalized = transcript.to_string();
    for (start, end, hint) in replacements {
        normalized.replace_range(start..end, hint);
    }
    normalized
}

struct TranscriptionOutput {
    transcript: String,
    no_speech: bool,
    detected_language: Option<String>,
    vad_time_ms: u64,
    inference_time_ms: u64,
    total_time_ms: u64,
    adaptive_pass_used: bool,
}

struct WhisperPass {
    transcript: String,
    detected_language: Option<String>,
    inference_time_ms: u64,
}

struct RealSpeechEngine {
    context: WhisperContext,
    vad: WhisperVadContext,
    threads: i32,
}

impl RealSpeechEngine {
    fn load(resource_dir: &Path, manifest: &SpeechManifest) -> Result<Self, HostError> {
        let model_path = resource_dir.join("models").join(&manifest.model.file_name);
        let vad_path = resource_dir.join("models").join(&manifest.vad.file_name);
        verify_sha256(
            &model_path,
            &manifest.model.sha256,
            "speech.model.hash-mismatch",
        )?;
        verify_sha256(&vad_path, &manifest.vad.sha256, "speech.vad.hash-mismatch")?;
        let threads = std::thread::available_parallelism()
            .map(|count| count.get().saturating_sub(1).clamp(1, 8) as i32)
            .unwrap_or(1);
        let mut context_params = WhisperContextParameters::default();
        context_params.use_gpu(SPEECH_BACKEND == "vulkan");
        let context =
            WhisperContext::new_with_params(&model_path, context_params).map_err(|_| {
                host_error(
                    if SPEECH_BACKEND == "vulkan" {
                        "speech.gpu.initialization"
                    } else {
                        "speech.model.corrupt"
                    },
                    if SPEECH_BACKEND == "vulkan" {
                        "Vulkan speech acceleration could not be initialized."
                    } else {
                        "The local Whisper model could not be loaded."
                    },
                    SPEECH_BACKEND == "vulkan",
                )
            })?;
        let mut vad_context_params = WhisperVadContextParams::new();
        vad_context_params.set_n_threads(threads);
        vad_context_params.set_use_gpu(false);
        let vad_path = vad_path.to_string_lossy().into_owned();
        let vad = WhisperVadContext::new(&vad_path, vad_context_params).map_err(|_| {
            host_error(
                "speech.vad.corrupt",
                "The local Silero VAD model could not be loaded.",
                false,
            )
        })?;
        Ok(Self {
            context,
            vad,
            threads,
        })
    }

    fn decode(
        &self,
        speech_pcm: &[f32],
        language: Option<&str>,
        initial_prompt: Option<&str>,
    ) -> Result<WhisperPass, HostError> {
        let plan = decoder_plan(speech_pcm.len());
        let mut params = FullParams::new(SamplingStrategy::Greedy {
            best_of: plan.best_of,
        });
        params.set_n_threads(self.threads);
        params.set_temperature(0.0);
        params.set_temperature_inc(0.0);
        params.set_translate(WHISPER_TRANSLATE);
        params.set_language(language);
        if let Some(initial_prompt) = initial_prompt {
            params.set_initial_prompt(initial_prompt);
        }
        params.set_no_context(true);
        params.set_no_timestamps(true);
        params.set_single_segment(plan.single_segment);
        params.set_max_tokens(plan.max_tokens);
        if plan.audio_context_tokens > 0 {
            params.set_audio_ctx(plan.audio_context_tokens);
        }
        params.set_token_timestamps(false);
        params.set_print_progress(false);
        params.set_print_realtime(false);
        params.set_print_special(false);
        params.set_print_timestamps(false);
        params.set_suppress_blank(true);
        params.set_suppress_nst(true);
        let mut state = self.context.create_state().map_err(|_| {
            host_error(
                "speech.host.state",
                "The local speech engine could not create a decoder state.",
                true,
            )
        })?;
        let inference_started = Instant::now();
        state.full(params, speech_pcm).map_err(|_| {
            host_error(
                if SPEECH_BACKEND == "vulkan" {
                    "speech.gpu.inference"
                } else {
                    "speech.inference.failed"
                },
                if SPEECH_BACKEND == "vulkan" {
                    "Vulkan speech acceleration failed during inference."
                } else {
                    "Local speech recognition failed."
                },
                true,
            )
        })?;
        let inference_time_ms = inference_started.elapsed().as_millis() as u64;
        let detected_language = whisper_rs::get_lang_str(state.full_lang_id_from_state())
            .map(str::to_string)
            .or_else(|| language.map(str::to_string));
        let transcript = state
            .as_iter()
            .filter_map(|segment| segment.to_str_lossy().ok().map(|text| text.into_owned()))
            .collect::<Vec<_>>()
            .join("");
        Ok(WhisperPass {
            transcript,
            detected_language,
            inference_time_ms,
        })
    }

    fn transcribe(
        &mut self,
        pcm: &[f32],
        glossary: &Glossary,
        language: Option<&str>,
        context_hints: &[String],
    ) -> Result<TranscriptionOutput, HostError> {
        let total_started = Instant::now();
        let vad_started = Instant::now();
        let mut vad_params = WhisperVadParams::new();
        vad_params.set_threshold(0.5);
        let segments = self
            .vad
            .segments_from_samples(vad_params, pcm)
            .map_err(|_| {
                host_error(
                    "speech.vad.failed",
                    "Local voice activity detection failed.",
                    true,
                )
            })?;
        let vad_time_ms = vad_started.elapsed().as_millis() as u64;
        if segments.num_segments() == 0 {
            return Ok(TranscriptionOutput {
                transcript: String::new(),
                no_speech: true,
                detected_language: None,
                vad_time_ms,
                inference_time_ms: 0,
                total_time_ms: total_started.elapsed().as_millis() as u64,
                adaptive_pass_used: false,
            });
        }

        let first_segment = segments.get_segment(0).ok_or_else(|| {
            host_error(
                "speech.vad.failed",
                "Local voice activity detection returned an invalid speech window.",
                true,
            )
        })?;
        let last_segment = segments
            .get_segment(segments.num_segments() - 1)
            .ok_or_else(|| {
                host_error(
                    "speech.vad.failed",
                    "Local voice activity detection returned an invalid speech window.",
                    true,
                )
            })?;
        let speech_window = vad_speech_window(pcm.len(), first_segment.start, last_segment.end);
        let speech_pcm = &pcm[speech_window];
        let context_normalizer = context_term_normalizer(context_hints)?;
        let mut selected = self.decode(speech_pcm, language, None)?;
        let mut transcript = normalize_transcript(
            glossary,
            context_normalizer.as_ref(),
            &selected.transcript,
            selected.detected_language.as_deref(),
        );
        let relevant_hints = if language.is_none() {
            adaptive_context_hints(&selected.transcript, context_hints)
        } else {
            Vec::new()
        };
        let mut inference_time_ms = selected.inference_time_ms;
        let mut adaptive_pass_used = false;
        if needs_adaptive_pass(&transcript, &relevant_hints) {
            let prompt = relevant_hints.join(". ");
            let prompted = self.decode(speech_pcm, language, Some(&prompt))?;
            inference_time_ms = inference_time_ms.saturating_add(prompted.inference_time_ms);
            adaptive_pass_used = true;
            let prompted_transcript = normalize_transcript(
                glossary,
                context_normalizer.as_ref(),
                &prompted.transcript,
                prompted.detected_language.as_deref(),
            );
            if hint_hit_count(&prompted_transcript, &relevant_hints)
                > hint_hit_count(&transcript, &relevant_hints)
            {
                selected = prompted;
                transcript = prompted_transcript;
            }
        }
        transcript = normalize_phonetic_context_spans(&transcript, &relevant_hints);
        let no_speech = transcript.is_empty();
        Ok(TranscriptionOutput {
            transcript,
            no_speech,
            detected_language: (!no_speech).then_some(selected.detected_language).flatten(),
            vad_time_ms,
            inference_time_ms,
            total_time_ms: total_started.elapsed().as_millis() as u64,
            adaptive_pass_used,
        })
    }
}

fn context_term_normalizer(hints: &[String]) -> Result<Option<TermNormalizer>, HostError> {
    if hints.is_empty() {
        return Ok(None);
    }
    TermNormalizer::compile(
        hints
            .iter()
            .map(|hint| GlossaryTerm {
                canonical: hint.clone(),
                aliases: Vec::new(),
            })
            .collect(),
    )
    .map(Some)
}

fn normalize_transcript(
    glossary: &Glossary,
    context_normalizer: Option<&TermNormalizer>,
    transcript: &str,
    detected_language: Option<&str>,
) -> String {
    let normalized = glossary.normalize(transcript, detected_language);
    context_normalizer
        .map(|normalizer| normalizer.normalize(&normalized))
        .unwrap_or(normalized)
        .trim()
        .to_string()
}

fn hint_hit_count(transcript: &str, hints: &[String]) -> usize {
    let transcript = transcript.to_lowercase();
    hints
        .iter()
        .filter(|hint| transcript.contains(&hint.to_lowercase()))
        .count()
}

fn needs_adaptive_pass(transcript: &str, hints: &[String]) -> bool {
    !hints.is_empty() && hint_hit_count(transcript, hints) < hints.len()
}

fn host_error(code: &str, message: &str, retryable: bool) -> HostError {
    HostError {
        code: code.to_string(),
        message: message.to_string(),
        retryable,
    }
}

fn speech_language(metadata: &Value) -> Result<Option<&str>, HostError> {
    let language = metadata
        .get("language")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or_default();
    if language == "auto" {
        Ok(None)
    } else if matches!(language, "en" | "ru" | "de") {
        Ok(Some(language))
    } else {
        Err(host_error(
            "speech.request.language",
            "The requested speech language is unsupported.",
            false,
        ))
    }
}

fn speech_context_hints(metadata: &Value) -> Result<Vec<String>, HostError> {
    let Some(values) = metadata.get("contextHints") else {
        return Ok(Vec::new());
    };
    let Some(values) = values.as_array() else {
        return Err(host_error(
            "speech.request.context",
            "The speech recognition context is invalid.",
            false,
        ));
    };
    let mut hints = Vec::with_capacity(values.len().min(MAX_CONTEXT_HINTS));
    let mut seen = HashSet::with_capacity(values.len().min(MAX_CONTEXT_HINTS));
    let mut total_characters = 0_usize;
    for value in values {
        let Some(hint) = value.as_str().map(str::trim) else {
            return Err(host_error(
                "speech.request.context",
                "The speech recognition context is invalid.",
                false,
            ));
        };
        let character_count = hint.chars().count();
        total_characters = total_characters.saturating_add(character_count);
        let key = hint.to_lowercase();
        if !(2..=MAX_CONTEXT_HINT_CHARS).contains(&character_count)
            || !hint.bytes().any(|byte| byte.is_ascii_alphabetic())
            || hint.chars().any(char::is_control)
            || total_characters > MAX_CONTEXT_HINT_TOTAL_CHARS
            || values.len() > MAX_CONTEXT_HINTS
        {
            return Err(host_error(
                "speech.request.context",
                "The speech recognition context is invalid.",
                false,
            ));
        }
        if seen.insert(key) {
            hints.push(hint.to_string());
        }
    }
    Ok(hints)
}

fn verify_sha256(path: &Path, expected: &str, code: &str) -> Result<(), HostError> {
    let mut file = File::open(path)
        .map_err(|_| host_error(code, "A required local speech model is missing.", false))?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 1024 * 1024];
    loop {
        let read = file.read(&mut buffer).map_err(|_| {
            host_error(code, "A required local speech model cannot be read.", false)
        })?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    let actual = format!("{:x}", hasher.finalize());
    if actual.eq_ignore_ascii_case(expected) {
        Ok(())
    } else {
        Err(host_error(
            code,
            "A local speech model failed its SHA-256 check.",
            false,
        ))
    }
}

fn parse_args() -> (bool, Option<PathBuf>) {
    let mut fake_engine = false;
    let mut resource_dir = None;
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--fake-engine" => fake_engine = true,
            "--resource-dir" => resource_dir = args.next().map(PathBuf::from),
            _ => {}
        }
    }
    (fake_engine, resource_dir)
}

fn read_frame(reader: &mut impl Read) -> Result<Option<(HostRequest, Vec<u8>)>, HostError> {
    let mut prefix = [0_u8; 20];
    match reader.read_exact(&mut prefix) {
        Ok(()) => {}
        Err(error) if error.kind() == io::ErrorKind::UnexpectedEof => return Ok(None),
        Err(_) => {
            return Err(host_error(
                "speech.protocol.read",
                "The speech request frame could not be read.",
                true,
            ))
        }
    }
    if &prefix[..4] != FRAME_MAGIC {
        return Err(host_error(
            "speech.protocol.magic",
            "The speech request frame has an invalid magic value.",
            false,
        ));
    }
    let version = u16::from_le_bytes([prefix[4], prefix[5]]);
    let header_len = u32::from_le_bytes(prefix[8..12].try_into().unwrap()) as usize;
    let pcm_len = u64::from_le_bytes(prefix[12..20].try_into().unwrap()) as usize;
    if version != FRAME_VERSION
        || header_len == 0
        || header_len > MAX_HEADER_BYTES
        || pcm_len > MAX_PCM_BYTES
    {
        return Err(host_error(
            "speech.protocol.bounds",
            "The speech request frame is outside supported bounds.",
            false,
        ));
    }
    let mut header = vec![0_u8; header_len];
    reader.read_exact(&mut header).map_err(|_| {
        host_error(
            "speech.protocol.read",
            "The speech request header is incomplete.",
            true,
        )
    })?;
    let request: HostRequest = serde_json::from_slice(&header).map_err(|_| {
        host_error(
            "speech.protocol.header",
            "The speech request header is invalid.",
            false,
        )
    })?;
    if request.schema != "fluxora.speech.request.v1"
        || request.id.is_empty()
        || request.operation_id.is_empty()
    {
        return Err(host_error(
            "speech.protocol.header",
            "The speech request header is incomplete.",
            false,
        ));
    }
    let mut pcm = vec![0_u8; pcm_len];
    reader.read_exact(&mut pcm).map_err(|_| {
        host_error(
            "speech.protocol.read",
            "The speech PCM frame is incomplete.",
            true,
        )
    })?;
    Ok(Some((request, pcm)))
}

fn write_response(writer: &mut impl Write, response: HostResponse) -> io::Result<()> {
    serde_json::to_writer(&mut *writer, &response)?;
    writer.write_all(b"\n")?;
    writer.flush()
}

fn pcm_f32(bytes: &[u8]) -> Result<Vec<f32>, HostError> {
    if bytes.len() % 4 != 0 {
        return Err(host_error(
            "speech.audio.format",
            "PCM data is not valid f32le audio.",
            false,
        ));
    }
    Ok(bytes
        .chunks_exact(4)
        .map(|chunk| f32::from_le_bytes(chunk.try_into().unwrap()))
        .collect())
}

fn load_manifest(resource_dir: &Path) -> Result<SpeechManifest, HostError> {
    let bytes = std::fs::read(resource_dir.join("manifest.json")).map_err(|_| {
        host_error(
            "speech.manifest.missing",
            "The bundled speech model manifest is missing.",
            false,
        )
    })?;
    let manifest: SpeechManifest = serde_json::from_slice(&bytes).map_err(|_| {
        host_error(
            "speech.manifest.invalid",
            "The bundled speech model manifest is invalid.",
            false,
        )
    })?;
    if manifest.version != "1.0.0" {
        return Err(host_error(
            "speech.manifest.version",
            "The bundled speech model manifest version is unsupported.",
            false,
        ));
    }
    Ok(manifest)
}

fn main() {
    let host_thread = std::thread::Builder::new()
        .name("fluxora-speech-host".to_string())
        .stack_size(SPEECH_HOST_STACK_BYTES)
        .spawn(run_host);
    let Ok(host_thread) = host_thread else {
        std::process::exit(1);
    };
    if host_thread.join().is_err() {
        std::process::exit(1);
    }
}

fn run_host() {
    whisper_rs::install_logging_hooks();
    let (fake_engine, resource_dir) = parse_args();
    let glossary = match Glossary::load() {
        Ok(glossary) => glossary,
        Err(_) => std::process::exit(2),
    };
    let stdin = io::stdin();
    let mut reader = BufReader::new(stdin.lock());
    let stdout = io::stdout();
    let mut writer = stdout.lock();
    let handshake = json!({
        "schema": "fluxora.speech.handshake.v1",
        "hostVersion": env!("CARGO_PKG_VERSION"),
        "backend": SPEECH_BACKEND,
        "modelVersion": MODEL_VERSION,
        "glossaryVersion": glossary.version,
        "warmed": false
    });
    if serde_json::to_writer(&mut writer, &handshake).is_err()
        || writer.write_all(b"\n").is_err()
        || writer.flush().is_err()
    {
        return;
    }

    let mut manifest: Option<SpeechManifest> = None;
    let mut engine: Option<RealSpeechEngine> = None;
    let mut warmed = false;
    loop {
        let frame = match read_frame(&mut reader) {
            Ok(Some(frame)) => frame,
            Ok(None) => break,
            Err(error) => {
                let _ = write_response(
                    &mut writer,
                    HostResponse {
                        schema: "fluxora.speech.response.v1",
                        id: "protocol-error".to_string(),
                        ok: false,
                        result: None,
                        error: Some(error),
                    },
                );
                break;
            }
        };
        let (request, pcm_bytes) = frame;
        let started = Instant::now();
        let result = match request.method.as_str() {
            "prepare" => {
                if !warmed {
                    if fake_engine {
                        warmed = true;
                    } else if let Some(resource_dir) = resource_dir.as_deref() {
                        match load_manifest(resource_dir).and_then(|loaded| {
                            if loaded.glossary.version != glossary.version {
                                return Err(host_error("speech.glossary.version", "The bundled speech glossary version does not match its manifest.", false));
                            }
                            let loaded_engine = RealSpeechEngine::load(resource_dir, &loaded)?;
                            manifest = Some(loaded);
                            engine = Some(loaded_engine);
                            Ok(())
                        }) {
                            Ok(()) => warmed = true,
                            Err(error) => {
                                let _ = write_response(&mut writer, HostResponse {
                                    schema: "fluxora.speech.response.v1",
                                    id: request.id,
                                    ok: false,
                                    result: None,
                                    error: Some(error),
                                });
                                continue;
                            }
                        }
                    } else {
                        let _ = write_response(
                            &mut writer,
                            HostResponse {
                                schema: "fluxora.speech.response.v1",
                                id: request.id,
                                ok: false,
                                result: None,
                                error: Some(host_error(
                                    "speech.resources.missing",
                                    "The bundled speech resource directory is unavailable.",
                                    false,
                                )),
                            },
                        );
                        continue;
                    }
                }
                Ok(json!({
                    "operationId": request.operation_id,
                    "ready": true,
                    "warmed": true,
                    "health": "ready",
                    "modelVersion": manifest.as_ref().map(|value| value.model.version.as_str()).unwrap_or(MODEL_VERSION),
                    "glossaryVersion": glossary.version,
                    "backend": SPEECH_BACKEND,
                    "threads": engine.as_ref().map(|value| value.threads).unwrap_or(1),
                    "modelLoadTimeMs": started.elapsed().as_millis() as u64
                }))
            }
            "transcribe" => (|| -> Result<Value, HostError> {
                if !warmed {
                    Err(host_error(
                        "speech.host.not-ready",
                        "The local speech model has not been prepared.",
                        true,
                    ))
                } else {
                    let pcm = pcm_f32(&pcm_bytes)?;
                    if pcm.iter().any(|sample| !sample.is_finite()) {
                        Err(host_error(
                            "speech.audio.invalid",
                            "PCM contains non-finite samples.",
                            false,
                        ))
                    } else {
                        let language = speech_language(&request.metadata)?;
                        let duration_ms = request
                            .metadata
                            .get("durationMs")
                            .and_then(Value::as_u64)
                            .unwrap_or_else(|| (pcm.len() as u64 * 1_000) / 16_000);
                        let context_hints = speech_context_hints(&request.metadata)?;
                        let output = if fake_engine {
                            if pcm.iter().all(|sample| sample.abs() < 0.0001) {
                                TranscriptionOutput {
                                    transcript: String::new(),
                                    no_speech: true,
                                    detected_language: None,
                                    vad_time_ms: 0,
                                    inference_time_ms: 0,
                                    total_time_ms: 0,
                                    adaptive_pass_used: false,
                                }
                            } else {
                                let text = request
                                    .metadata
                                    .get("fakeTranscript")
                                    .and_then(Value::as_str)
                                    .unwrap_or("Fluxora voice fixture");
                                let detected_language = request
                                    .metadata
                                    .get("fakeDetectedLanguage")
                                    .and_then(Value::as_str)
                                    .or(language)
                                    .unwrap_or("en")
                                    .to_string();
                                let context_normalizer = context_term_normalizer(&context_hints)?;
                                TranscriptionOutput {
                                    transcript: normalize_transcript(
                                        &glossary,
                                        context_normalizer.as_ref(),
                                        text,
                                        Some(&detected_language),
                                    ),
                                    no_speech: false,
                                    detected_language: Some(detected_language),
                                    vad_time_ms: 0,
                                    inference_time_ms: 0,
                                    total_time_ms: 0,
                                    adaptive_pass_used: false,
                                }
                            }
                        } else {
                            engine
                                .as_mut()
                                .ok_or_else(|| {
                                    host_error(
                                        "speech.host.not-ready",
                                        "The local speech engine is unavailable.",
                                        true,
                                    )
                                })?
                                .transcribe(&pcm, &glossary, language, &context_hints)?
                        };
                        let real_time_factor = if duration_ms == 0 {
                            0.0
                        } else {
                            output.total_time_ms as f64 / duration_ms as f64
                        };
                        Ok(json!({
                            "operationId": request.operation_id,
                            "transcript": output.transcript,
                            "detectedLanguage": output.detected_language,
                            "backend": SPEECH_BACKEND,
                            "modelVersion": manifest.as_ref().map(|value| value.model.version.as_str()).unwrap_or(MODEL_VERSION),
                            "glossaryVersion": glossary.version,
                            "durationMs": duration_ms,
                            "processingTimeMs": started.elapsed().as_millis() as u64,
                            "noSpeech": output.no_speech,
                            "threads": engine.as_ref().map(|value| value.threads).unwrap_or(1),
                            "vadTimeMs": output.vad_time_ms,
                            "inferenceTimeMs": output.inference_time_ms,
                            "totalTimeMs": output.total_time_ms,
                            "realTimeFactor": real_time_factor,
                            "adaptivePassUsed": output.adaptive_pass_used
                        }))
                    }
                }
            })(),
            "shutdown" => Ok(json!({ "operationId": request.operation_id, "accepted": true })),
            _ => Err(host_error(
                "speech.protocol.method",
                "The speech host method is unsupported.",
                false,
            )),
        };
        let should_shutdown = request.method == "shutdown";
        let response = match result {
            Ok(result) => HostResponse {
                schema: "fluxora.speech.response.v1",
                id: request.id,
                ok: true,
                result: Some(result),
                error: None,
            },
            Err(error) => HostResponse {
                schema: "fluxora.speech.response.v1",
                id: request.id,
                ok: false,
                result: None,
                error: Some(error),
            },
        };
        if write_response(&mut writer, response).is_err() || should_shutdown {
            break;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn glossary_normalizes_names_globally_and_generic_terms_only_for_the_detected_language() {
        let glossary = Glossary::load().unwrap();
        assert_eq!(
            glossary.normalize("community shaders with skyrim se and esp-fe", Some("en")),
            "Community Shaders with Skyrim SE and ESP-FE"
        );
        assert_eq!(
            glossary.normalize(
                "em oh zwei und ladereihenfolge im überschreibungsordner",
                Some("de")
            ),
            "MO2 und Ladereihenfolge im Überschreibungsordner"
        );
        assert_eq!(
            glossary.normalize("флюксора и порядок загрузки плагинов", Some("ru")),
            "Fluxora и порядок загрузки плагинов"
        );
        assert_eq!(
            glossary.normalize("flex aura and load order", Some("en")),
            "Fluxora and load order"
        );
        assert_eq!(
            glossary.normalize("fluxera with scaram", Some("en")),
            "Fluxora with Skyrim"
        );
        assert_eq!(
            glossary.normalize("флагсора и Skyrim", Some("ru")),
            "Fluxora и Skyrim"
        );
        assert_eq!(
            glossary.normalize("flux ora plugin master overwrite", Some("fr")),
            "Fluxora plugin master overwrite"
        );
        assert_eq!(
            glossary.normalize("masterful pluginized", Some("en")),
            "masterful pluginized"
        );
        assert_eq!(
            glossary.normalize("включи ноуграс и ноубджект и Use-grass-cache", Some("ru")),
            "включи No Grass In Objects и Use-grass-cache"
        );
        assert_eq!(
            glossary.normalize(
                "в настройках но грессы и нервы джекц, затем дилот фром грозкэш",
                Some("ru")
            ),
            "в настройках No Grass In Objects, затем Only Load From Grass Cache"
        );
    }

    #[test]
    fn mixed_language_transcript_selects_only_phonetically_relevant_build_context() {
        let hints = vec![
            "No Grass In Objects - Grass Control".to_string(),
            "Community Shaders".to_string(),
            "SSE Display Tweaks".to_string(),
        ];

        assert_eq!(
            adaptive_context_hints(
                "Можешь включить генерацию кэша травы в ноуграс и ноубджект?",
                &hints
            ),
            ["No Grass In Objects - Grass Control"]
        );
        assert_eq!(
            adaptive_context_hints(
                "Можешь, пожалуйста, включить генерацию кэша травы в настройках, но грессы и нервы джекц.",
                &hints
            ),
            ["No Grass In Objects - Grass Control"]
        );
    }

    #[test]
    fn mixed_language_context_repairs_a_confident_phonetic_span_without_translating_russian() {
        assert_eq!(
            normalize_phonetic_context_spans(
                "Можешь включить кэш в настройках, ноу грас ин обджектс.",
                &["No Grass In Objects".to_string()]
            ),
            "Можешь включить кэш в настройках, No Grass In Objects."
        );
        assert_eq!(
            normalize_phonetic_context_spans(
                "Открой Community Shaders и ноу грас ин обджектс.",
                &[
                    "Community Shaders".to_string(),
                    "No Grass In Objects".to_string()
                ]
            ),
            "Открой Community Shaders и No Grass In Objects."
        );
    }

    #[test]
    fn adaptive_pass_still_runs_when_only_one_of_multiple_spoken_terms_is_exact() {
        let hints = vec![
            "No Grass In Objects".to_string(),
            "Only Load From Grass Cache".to_string(),
        ];

        assert!(needs_adaptive_pass(
            "Включи No Grass In Objects и онли лоуд фром грас кэш",
            &hints
        ));
        assert!(!needs_adaptive_pass(
            "Включи No Grass In Objects и Only Load From Grass Cache",
            &hints
        ));
    }

    #[test]
    fn speech_context_accepts_bounded_english_terms_for_local_adaptation() {
        let hints = speech_context_hints(&json!({
            "contextHints": ["No Grass In Objects", "GrassControl.ini"]
        }))
        .unwrap();

        assert_eq!(hints, ["No Grass In Objects", "GrassControl.ini"]);
        assert!(speech_context_hints(&json!({
            "contextHints": vec!["context"; 97]
        }))
        .is_err());
    }

    #[test]
    fn model_hash_mismatch_is_typed() {
        let path = std::env::temp_dir().join(format!("fluxora-speech-hash-{}", std::process::id()));
        std::fs::write(&path, b"not-a-model").unwrap();
        let error = verify_sha256(&path, "00", "speech.model.hash-mismatch").unwrap_err();
        let _ = std::fs::remove_file(path);
        assert_eq!(error.code, "speech.model.hash-mismatch");
        assert!(!error.retryable);
    }

    #[test]
    fn whisper_auto_language_keeps_explicit_compatibility_and_translation_off() {
        for language in ["en", "ru", "de"] {
            assert_eq!(
                speech_language(&json!({ "language": language })).unwrap(),
                Some(language)
            );
        }
        assert_eq!(
            speech_language(&json!({ "language": "auto" })).unwrap(),
            None
        );
        assert!(!WHISPER_TRANSLATE);
    }

    #[test]
    fn short_voice_decoder_plan_is_latency_bounded() {
        let plan = decoder_plan(38_080);

        assert_eq!(plan.sampling, DecoderSampling::Greedy);
        assert_eq!(plan.best_of, 1);
        assert!(plan.single_segment);
        assert!(plan.max_tokens <= 32);
        assert!((128..=256).contains(&plan.audio_context_tokens));
    }

    #[test]
    fn short_voice_uses_the_vad_speech_window_instead_of_outer_silence() {
        assert_eq!(vad_speech_window(30_657, 7.0, 134.0), 1_120..21_440);
    }

    #[test]
    fn long_voice_decoder_plan_preserves_segmented_transcription() {
        let plan = decoder_plan(16_000 * 60);

        assert_eq!(plan.sampling, DecoderSampling::Greedy);
        assert!(!plan.single_segment);
        assert!(plan.max_tokens >= 128);
        assert_eq!(plan.audio_context_tokens, 0);
    }
}
