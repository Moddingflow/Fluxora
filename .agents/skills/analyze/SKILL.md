---
name: analyze
description: "General diagnosis workflow for build failures, broken tests, runtime errors, confusing repository behavior, dependency/toolchain questions, and requests to find current information online before analyzing local evidence. Use when Codex needs to search the internet or current docs for errors, APIs, libraries, CLI/toolchain behavior, release notes, or known issues, then inspect logs, run the relevant build/test command, and explain what is wrong or what to fix."
---

# Analyze

## Overview

Use this skill for diagnosis-first work that combines current external research with local build, test, log, and source evidence. The goal is to turn a vague failure or research question into an evidence-backed diagnosis, proof path, or scoped fix.

## Workflow

1. Restate the problem in concrete terms: exact symptom, expected behavior, actual behavior, failing command, environment, changed files, and any user-provided logs or screenshots.
2. Gather current external context early when the issue may depend on public docs, dependency behavior, OS/toolchain behavior, error messages, release notes, or known upstream issues.
3. Inspect local project rules and evidence before broad source exploration. Read the closest agent instructions, check logs for bug investigations, and use the repository's preferred navigation layer before wide raw search.
4. Analyze the build surface. Identify the owner layer, run the smallest relevant command that can reproduce or explain the failure, and capture the first useful error rather than downstream noise.
5. Build ranked hypotheses from evidence. Separate confirmed facts, plausible inferences, and missing evidence.
6. Decide the next move:
   - If the user asked only to analyze, return the diagnosis and proof path without editing files.
   - If the user asked to fix the issue, make the smallest scoped change after the likely cause is proven enough to act.
7. Validate with the narrow command first, then any broader repository-required build or test gate. Report commands, outcomes, and any skipped checks.

## External Research Rules

- Use internet search when the answer may depend on current external information, exact source attribution, error-message history, upstream releases, dependency behavior, security/legal facts, or toolchain quirks.
- For libraries, frameworks, SDKs, APIs, CLIs, and cloud services, use Context7 first when it is available and the repository instructions require it. Prefer official docs, release notes, issue trackers, and vendor changelogs over secondary summaries.
- Record source dates, versions, and links when they affect the diagnosis.
- Distinguish verified facts from inference. Do not present a web result as proof of the local root cause until local evidence also supports it.
- Summarize sources; avoid long copied passages.

## Build Analysis Rules

- Start from the failing command, log, crash, test, or build artifact. If no reproduction exists, state the missing evidence and choose the smallest safe command that can raise confidence.
- Preserve user changes. Do not clean, reset, delete build outputs, or rewrite generated files unless the user asked for that operation or the repository rules require it.
- Prefer existing build, test, and diagnostic commands over inventing parallel scripts. Use the smallest reliable reproduction before expensive full builds.
- Watch for stale generated files, environment variables, dependency lockfile drift, platform-specific toolchain changes, multi-layer contract mismatches, and release packaging differences.
- Capture exact commands and meaningful results for the handoff.
- When changing files, add or update focused test coverage where applicable, then rerun the narrow failing check and the repository's required broader validation.

## Fluxora Notes

- Read `.agents/PROJECT_RULES.md` before changes.
- Before broad repository search, use `graphify query` when `graphify-out/graph.json` exists.
- When investigating bugs, check `logs/` early.
- After changing code, docs, project instructions, or agent configuration, run `graphify update .`.
- After changes, run the required Fluxora validation, including `.\Build.ps1 -Configuration Release` unless the task was launched by automation or the user explicitly narrows validation.
