# 2026-08-20-direct-folder-pull-phase2: Direct shared-folder aggregation

- Status: accepted; implementation and verification complete
- Created: 2026-08-20T14:10:00+09:00
- Last updated: 2026-08-20T16:27:00+09:00
- Parent iteration: `2026-08-20-phase0-phase1`
- Supersedes: the unimplemented canonical signed-bundle and LAN-ingress recommendation in `2026-08-20-phase0-phase1`
- Superseded by: none

## Objective and authority

- User objective: Aggregate PC1, PC2, and DGX usage without peer synchronization, manual import/export, always-on clients, scheduled source jobs, or source-side update maintenance.
- Why this change is being made: DevTax is expected to run only once or twice per month. At that frequency, direct hub-side scanning of user-selected read-only shares has materially lower setup and maintenance cost than deploying collectors.
- Allowed scope: Update the Phase 1 design; implement explicit filesystem data sources, direct provider scanning, source provenance, idempotent rescans, startup scan behavior, settings/diagnostics UI, database migration, synthetic tests, and documentation in the PC2 authority repository.
- Excluded scope: Reading real PC1/DGX histories; creating or changing SMB/NFS shares, OS credentials, firewalls, schedulers, services, or remote machines; peer synchronization; per-device keys; LAN upload listener; push, PR, deploy, publish, or release.

## Baseline

- Prior result and decision: Phase 0 is complete. Phase 1 proposed a signed encrypted bundle and dedicated LAN ingress, but no product code implemented it.
- Baseline identity: PC2 `main` at `9258ff04276670be3a8b2607eab4296326dfa958`; four untracked Phase 1 design files and untracked evidence exist.
- Known limitations: The current product scans only default local Claude/Codex locations. Exact schema, adapter, API, and UI deltas are not yet inspected for this iteration.

## Planned change

- Exact delta: Add hub-owned source definitions whose explicit roots are passed to existing provider scanners; scan those sources automatically while DevTax is running; retain the last successful observation when a source is unavailable; expose setup and status without leaking native paths through ordinary APIs; preserve existing one-PC behavior as the default source.
- Expected gain: One DevTax installation and one update point; no remote binary, scheduler, pairing, app credential, or manual transfer in the standard path.
- Possible loss or risk: Raw source files traverse the trusted filesystem share and are readable by the hub OS account; live/partial files and provider databases need provider-specific consistency handling; path configuration can accidentally grant broader access than intended.
- Fixed conditions: Read only user-configured roots; never write source files; never share or open the DevTax SQLite database over the network; never persist prompt/response/source-code bodies; unavailable sources do not erase prior imported observations.
- Decision rule: Implement only behavior supported by synthetic fixtures and preserve existing scan/allocation/privacy invariants. Any provider format that cannot be read consistently over a mounted filesystem must fail safely and document a collector/export fallback rather than guessing.

## Exact inputs and settings

- User-approved topology: one hub on PC2; direct filesystem pull from PC1 and DGX; collector only when filesystem sharing is unavailable or a provider format cannot be read safely.
- Trust boundary: User-selected local or OS-mounted read-only paths on a trusted LAN. DevTax does not implement SMB authentication or store share credentials.
- Automatic behavior: Scan configured sources on DevTax startup; optional in-process rescan while DevTax is open may be added only if it does not create a background service.
- Verification data: Synthetic PC1, PC2, and DGX directory trees only.
- Commands: `npm test`, `npm run build`, `npm run format:check`, `npm run privacy:check`, `npm run lint`, `git diff --check`, canonical-name scans, and isolated local browser smoke.

## Execution and artifacts

- Replaced the signed-bundle design with the approved direct-filesystem design in the four multi-device documents.
- Added `history_sources` and source-scoped identities/constraints to `usage_events`, `scans`, and `session_references`.
- Added a verified `VACUUM INTO` backup, transaction, and checksummed migration marker. Existing local keys remain byte-for-byte unchanged under `local-claude`/`local-codex`.
- Added local/UNC/mounted absolute-path validation, duplicate prevention, immutable default sources, configured-source CRUD/test, and source-scoped removal.
- Added stable-file checks and whole-source last-good retention for unavailable, unreadable, changing, malformed, invalid, or incompatible multi-file inputs.
- Added configured-source-specific identifier salts and host-independent Windows/POSIX cwd canonicalization while preserving existing local identifier bytes.
- Added startup and manual in-process scanning, serialized scan requests, source provenance, and remote-detail suppression.
- Added the source manager to the first onboarding step. No source-side client, service, task, listener, secret, or manual import path was added.
- Added synthetic PC2/PC1/DGX, migration, source API/privacy, empty-root, unavailable-root, queueing, and UI helper tests.

Final verification before re-review:

```text
npm test
  36 files / 276 tests passed

npm run build
  typecheck and production build passed

npm run format:check
  passed

npm run privacy:check
  passed

npm run lint
  exited 0; 10 pre-existing Fast Refresh warnings in src/client/pages/shared.tsx

git diff --check
  passed

canonical visible-name and forbidden-name scans
  no matches

isolated browser smoke
  startup scan integrated synthetic PC1 Claude and DGX Codex sources; source aliases and aggregate-only remote detail rendered correctly
```

## Direct observations

- The user considers Task Scheduler/systemd registration unacceptable for this product frequency.
- The user accepts user-specified Samba or equivalent filesystem paths as the primary transport.
- Only the PC2 DevTax installation should require routine updates.

## Gains

- Three sources containing the same native Claude session ID coexist as three distinct source/session/project identities.
- One 30,000円 Claude charge is allocated exactly once across all three sources.
- A configured source that becomes unavailable retains its prior normalized rows; a readable empty source intentionally clears only itself.
- Startup and user-triggered scans are performed inside the hub process and are serialized without an OS scheduler or resident source client.

## Losses and regressions

- Raw JSONL bytes cross the user-configured filesystem share during a scan; DevTax does not supply transport encryption.
- Source availability probing uses a 3-second application timeout, but the underlying OS filesystem request is not cancellable.
- Remote/configured sessions expose aggregate folder labels and provenance but intentionally do not offer transcript preview or resume commands.
- A real SMB/NFS server and real PC1/DGX histories were not accessed; filesystem behavior is covered with synthetic local directory trees and the browser smoke.
- Fresh security/migration review initially blocked the mutation-response path exposure. After correction and a full gate rerun, focused re-review returned `accept` with no blocking findings.

## Interpretation and alternatives

- Current explanation: Peer synchronization solves a problem DevTax does not have because source histories are append/read observations and hub mappings/contracts remain authoritative. A filesystem source makes local, UNC, SMB, NFS, and mounted-volume inputs one adapter boundary.
- Collector fallback: Retained only for sources that cannot expose files or cannot be read consistently.
- Manual bundle fallback: Not part of the approved standard path and not required in the first direct-pull implementation unless the code audit shows a compatibility need.

## Contemporaneous decision

- Decision at this time: Keep the implemented direct filesystem scanner as the standard architecture and proceed to final acceptance.
- Action now allowed: Local verification and evidence corrections on PC2.
- Action still prohibited: Real-data access, remote machine mutation, external publication, and LAN listener enablement.
- Coverage and confidence limit: Full synthetic acceptance and isolated UI smoke pass; no claim is made for real SMB/NFS hardware or real user histories.
- Revision trigger: Source file consistency cannot be made safe, privacy checks expose native path/content, existing single-PC results change, or fresh review finds a blocking issue.

## Knowledge disposition

- Candidate knowledge: For low-frequency local-first aggregation, direct read-only filesystem pull can be the OSS default while source collectors remain a transport fallback.
- Promoted to: none
- Demoted or withdrawn from: canonical signed bundles as the mandatory data plane.
- Supporting iteration IDs: `2026-08-20-phase0-phase1`, this entry.

## Corrections and later history

- The initial UI helper blocked a retry when a source was currently unavailable. It now treats any enabled source as retryable while still displaying the retained-last-good warning.
- The initial multi-source DDL began before the migration transaction. It now creates all source schema and the checksummed marker in the same transaction after a verified pre-migration backup.
- The initial single-flight scan returned an already-running scan for a later distinct request. It now queues the later request and executes it after the active scan.
- The initial source-scoping change left legacy uniqueness constraints in place. Migration now rebuilds `usage_events` and `session_references` with source-inclusive constraints.
- The initial configured-source project key used the hub OS path rules. Configured source cwd values now use their recorded Windows/POSIX syntax; existing local key bytes remain unchanged.
- The initial multi-file compatibility guard could accept a partial source when one file changed schema. Unknown-only files, invalid usage claims, unstable files, unreadable files, and incompatible files reject replacement for that whole source. A later real-history correction permits counted malformed lines only when the same file also contains a recognized provider envelope.
- Visible naming, the export filename, privacy copy, and file-hash documentation were corrected to match the canonical product name and the implemented local-preview/shared-source boundaries.
- Startup UI polling initially stopped after five minutes and could remain stale. It now releases the loading UI at that limit but continues polling until the queued startup scan settles, then refreshes the aggregate.
- The first final re-review found configured root paths in create/update responses. Those mutations now return only `{ saved, sourceId }`; absolute roots are returned only by the explicit local settings `GET /api/sources`. The API regression test checks that both mutation responses omit the root.
- Final focused correction re-review accepted the architecture, security boundary, migration, identity preservation, last-good retention, serialization/startup behavior, naming, and UI requirements with no blocking findings.
