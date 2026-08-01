# Terms of Use

Effective date: 1 August 2026

Engineering review status: these terms are a release candidate, not final legal advice. Public distribution is blocked until the operator has approved the facts and a qualified German lawyer has reviewed the German original and the English and Russian translations.

## 1. Operator and acceptance

Fluxora is provided by Valerii Semenov / Валерий Семёнов, c/o Autorenglück #61208, Albert-Einstein-Straße 47, 02977 Hoyerswerda, Germany.

By installing or using Fluxora you accept these Terms of Use. Setup asks separately for acceptance of these terms and acknowledgement that the Privacy Policy was read. The privacy acknowledgement is not consent to all data processing.

If you do not accept these terms, do not continue with installation.

## 2. Licence and permitted use

Subject to these terms and applicable third-party licences, you receive a personal, non-exclusive, non-transferable, revocable right to install and use Fluxora for lawful mod-management and related desktop tasks. You may not bypass signature or integrity controls, impersonate the official distribution, use Fluxora to violate third-party rights, or use connected services contrary to their terms.

Rights in games, mods, archives, brands, APIs, models, fonts, icons, and other third-party material remain with their respective owners. A mod being technically downloadable does not grant permission to redistribute or modify it.

## 3. Official installation and no portable distribution

The supported public Windows installer is `FluxoraSetup.exe` from the official Fluxora release channel. Setup installs per user, normally to `%LOCALAPPDATA%\Programs\Fluxora`, without mandatory elevation. It can create a desktop shortcut by default and register `moddingflow://` for the current user. Repair and removal change registration and shortcuts only after ownership checks.

Fluxora is not distributed as a portable program folder or portable archive. Loose payload files, staging directories, build outputs, update packages, manifests, signatures, and inventories are not alternative end-user installers. Obtain the application only from the official channel and do not run internal update data as a program.

## 4. WebView2 prerequisite

Fluxora's Windows UI requires Microsoft Edge WebView2. If a suitable runtime is already present, Setup can install Fluxora offline. If it is absent, Setup explains the dependency before creating the web UI and, only after confirmation, starts the embedded official Microsoft Evergreen Bootstrapper. The bootstrapper requires an online connection to Microsoft and is governed by Microsoft's terms. Declining or lacking network access means Setup cannot continue until WebView2 is installed by another supported method.

## 5. Installation transactions, repair, and recovery

Setup validates the target path, free space, package integrity, and existing installation ownership. By selecting Install after accepting these terms and acknowledging the Privacy Policy, you authorise one operation that installs, repairs, or updates the bundled payload and then automatically brings that installation to the latest newer signed stable release when available. A setup-origin installation initially has no signed update-inventory receipt and therefore uses only the signed full package for this first post-Setup update; downgrade and delta selection are not permitted in that flow. Setup and Updater use staging, atomic commit, a durable per-user ownership record, recovery markers, health probation, and rollback to reduce the risk of a partial installation. Cancellation is available only before the updater handoff commit. After that boundary, closing or cancellation is blocked while Fluxora completes or recovers the transaction. If discovery or download fails, Setup starts the successfully installed bundled version; if application fails, the native workflow rolls back and starts the recovered previous version when safe.

Do not alter transaction, backup, watchdog, receipt, or recovery files while Setup or Updater is running. Power loss, storage failure, security software, insufficient permissions, or manual file changes can still prevent recovery.

## 6. Updates

Fluxora checks fixed public GitHub Release assets at application startup, every 15 minutes while the primary window is running, when that window regains focus after at least five minutes, and when you request a check in Settings. These checks only discover a newer signed version; package download, installation, application shutdown, and restart begin only after you choose the available update action. In Setup, the Install action expressly includes the automatic post-install signed check and, when a newer version is available, full-package download, isolated Updater handoff, installation, health verification, and restart described above.

Updates can be signed full packages or deltas for an exact previous version. A full package is used when a safe delta is unavailable or the installation has no suitable receipt. Fluxora verifies the signed manifest, package hash, and target-file inventory before commit. Updater waits for the application, uses an isolated runtime, stages changes, launches the new version under probation, requires a fresh health acknowledgement, and finalises or rolls back.

Keep security and compatibility updates reasonably current. Under section 327f BGB, required updates, including security updates, may have to be provided and users informed. Where the statutory conditions apply, failure to install an update within a reasonable time after proper information can affect responsibility for a defect caused only by the missing update. Mandatory consumer rights remain unaffected.

Update infrastructure and third-party hosting can be unavailable. A signature check reduces supply-chain risk but does not replace operating-system code signing, backups, or downloading Fluxora only from the official channel. Current Windows executables and Setup are intentionally distributed without a paid trusted-publisher Authenticode certificate, so Windows can show an unknown-publisher or reputation warning.

## 7. User responsibilities

Before installing mods, deploying files, importing manager data, changing load order, running tools, applying an update, or using AI-assisted changes:

- verify the selected game, profile, paths, mod permissions, dependencies, and proposed action;
- keep tested backups of saves, projects, profiles, configuration, and irreplaceable archives;
- close or pause tools that can lock the same files;
- review warnings, operation summaries, and recovery instructions;
- comply with game, platform, API, copyright, licence, and community rules.

The protected Fluxora `Downloads` tree and logs are user data and are excluded from application payload replacement, but that protection is not a substitute for backups.

## 8. Connected services and downloads

ModdingFlow, Nexus Mods, GitHub, Microsoft, Google/Gemini, download hosts, game vendors, and websites you open are independent third parties with their own availability, terms, privacy practices, quotas, moderation, and content decisions. Fluxora cannot guarantee their data, links, identifiers, files, or responses.

A `moddingflow://` handoff identifies a specific ModdingFlow artifact. Fluxora validates the artifact metadata, including its expected size and SHA-256, and requires you to select a compatible instance and profile and explicitly confirm the current install plan before it queues any required downloads in the manager. A changed or conflicting plan is blocked and must be reviewed again.

Downloads can be delayed, revoked, incomplete, malicious, or incorrectly described. Fluxora performs the integrity and path checks implemented by the current version, but you remain responsible for the selected content, its permissions, and the resulting game state.

## 9. AI and local voice input

AI output can be wrong, incomplete, outdated, or unsafe. Public web content, model output, and retrieved files are untrusted input. Native policy checks, typed capabilities, confirmation requirements, transaction limits, and rollback reduce risk but do not make output authoritative. Review diffs and results before relying on them.

Voice recognition is performed locally with bundled models. Only a transcript you submit enters the AI request flow. Check the transcript before sending it, especially when it can initiate a proposed action.

Do not submit secrets, unlawful content, or personal/confidential data that is unnecessary for the requested task. You must have the right to process and transmit any third-party content you provide.

## 10. Availability and changes

Fluxora can be corrected, secured, changed, suspended, or discontinued. Features and integrations can change when operating systems, games, mod formats, or third-party APIs change. No uninterrupted availability or compatibility with every tool, mod, game version, or device is promised.

Material changes to these terms will be reflected by a new effective date and, where required, appropriate notice.

## 11. Warranty and liability

Fluxora is provided subject to mandatory law. Nothing in these terms excludes or limits liability for intent, gross negligence, injury to life, body or health, mandatory product liability, fraudulently concealed defects, a guarantee expressly assumed, or any liability that cannot lawfully be excluded.

For ordinary negligence, liability is limited, to the extent permitted by law, to breach of an essential contractual obligation and the foreseeable damage typical for the contract. Mandatory German and EU consumer rights, including rights concerning digital products and required updates, remain unaffected.

## 12. Termination and removal

You may stop using Fluxora at any time and uninstall it. Application removal may not remove projects, downloads, logs, credentials, backups, or data stored outside the installation directory; use the available controls and inspect the documented local locations.

The licence can be terminated for a material breach. Provisions that by their nature survive termination, including intellectual-property, liability, and dispute provisions, continue to apply.

## 13. Governing law and consumer disputes

German law applies, without depriving consumers of mandatory protection under the law of their habitual residence. Jurisdiction is determined by mandatory law.

The operator is not obliged and is not willing to participate in dispute-resolution proceedings before a consumer arbitration board. The former EU Online Dispute Resolution platform was discontinued on 20 July 2025, so these terms do not link to it.

## 14. Contact

General and legal enquiries:

Email: moddingflow@gmail.com<br>
Legal contact: legal@moddingflow.com

## 15. Authoritative review sources

- BGB section 327f: https://www.gesetze-im-internet.de/bgb/__327f.html
- VSBG section 36: https://www.gesetze-im-internet.de/vsbg/__36.html
- European Commission notice confirming closure of the former ODR platform: https://consumer-redress.ec.europa.eu/site-relocation_en
