# 2026-08-22-real-share-validation-and-commit: Real shared-root validation and local commit

- Status: accepted; local commit pending
- Created: 2026-08-22T10:05:28+09:00
- Last updated: 2026-08-22T12:06:56+09:00
- Parent iteration: `2026-08-20-direct-folder-pull-phase2`
- Supersedes: none
- Superseded by: none

## Objective and authority

- User objective: Execute the remaining work after Phase 2 acceptance.
- Current authority: Use the already-connected PC1 UNC share and DGX Spark mapped home share to configure and run DevTax read-only scans; verify the real operational path; preserve evidence; create a local Git commit.
- Excluded scope: Creating or changing shares, credentials, firewall rules, schedulers, services, or remote files; displaying or copying prompt/response/source-code bodies; push, PR, tag, publish, deploy, release, or destructive Git operations.

## Baseline

- Repository HEAD: `9258ff04276670be3a8b2607eab4296326dfa958` on `main`.
- Phase 2 state: accepted after full synthetic gates, isolated browser smoke, and fresh security/migration review.
- Working tree: 33 tracked paths changed and 13 untracked paths before this entry.
- Existing connections: PC1 history roots are reachable through an existing UNC share; DGX Spark history roots are reachable through the existing mapped home share. No share or credential mutation is required.

## Planned execution

1. Count only JSONL files at the four real roots without printing paths or contents.
2. Start the current DevTax server on loopback with its normal local data directory.
3. Configure four explicit read-only sources through the protected local API and run the scan.
4. Verify source status, aggregate-only remote-session behavior, absence of native roots/content in ordinary APIs, and browser-visible source status.
5. Rerun repository gates proportionate to any resulting code/evidence changes.
6. Record actual counts and limitations, update current/index state, and create one local commit. Do not push.

## Exact inputs and privacy handling

- Sources: PC1 Claude Code, PC1 Codex, DGX Spark Claude Code, DGX Spark Codex.
- Root forms: existing UNC and mapped-drive absolute paths. Exact user-specific roots are intentionally retained only in DevTax's local source settings and are not copied into repository evidence.
- Data handling: recursive file counts and normalized aggregate results only. Do not print or persist transcript bodies in evidence.

## Expected gain and residual risk

- Gain: Replace synthetic-only platform confidence with a real Windows UNC and DGX Samba-mounted operational scan.
- Residual risk: This run observes the current connected state; it does not create a controlled network outage or prove every SMB/NFS failure mode.

## Execution checkpoint: real compatibility diagnosis

- File-count probe completed without printing paths or contents:
  - PC1 Claude Code: 3,998 JSONL files.
  - PC1 Codex: 554 JSONL files.
  - DGX Spark Claude Code: 321 JSONL files.
  - DGX Spark Codex: 84 JSONL files.
- The accepted Phase 2 scanner connected to all four roots, but its whole-source compatibility guard was too strict for real provider histories:
  - PC1 Claude Code produced 56,535 normalized events but marked 182 known zero-usage files incompatible.
  - PC1 Codex produced 540 normalized events; 14 known incomplete sessions were marked invalid/incompatible and 18 malformed lines occurred inside otherwise recognized files.
  - DGX Spark Claude Code produced 21,101 normalized events but marked 45 known zero-usage files incompatible.
  - DGX Spark Codex produced 81 normalized events; 3 known incomplete sessions were marked invalid/incompatible.
- PC2 local history showed the same issue, proving it was Adapter classification rather than SMB transport: Claude produced 17,232 candidate events with 16 false incompatible files; Codex produced 619 candidate events with 5 false invalid/incompatible files, 99 malformed lines in recognized histories, and one concurrently changing file.
- Structural-only inspection identified normal zero-usage Claude records such as user-only, bridge-session, progress, attachment, metadata, started, and result envelopes. Codex zero-usage files contained normal session metadata/turn context but no token snapshot.
- Decision: Do not register a known-failing source snapshot. First correct the Adapter to recognize structurally known zero-usage files, keep renamed/missing token claims invalid, keep unknown-only files incompatible, and allow malformed lines only when the file has another recognized provider envelope. Preserve unstable-file and structural-failure last-good rejection.

## Contemporaneous decision

- Decision: Proceed because the user explicitly authorized the remaining work and both shares are already connected. Stop before any operation that would require modifying remote systems or credentials.

## Execution checkpoint: first protected API scan

- Four configured sources were saved through the loopback-origin/CSRF-protected local API. Create responses returned only opaque source IDs and did not return configured roots.
- The ordinary six-source scan completed in 845.3 seconds:
  - PC2 Claude Code: complete, 281 files, 189 aggregated sessions, zero malformed/invalid/incompatible/unstable/I/O diagnostics.
  - DGX Spark Claude Code: complete, 321 files, 192 aggregated sessions, zero malformed/invalid/incompatible/unstable/I/O diagnostics.
  - PC1 Claude Code: complete, 3,998 files, 918 aggregated sessions, zero malformed/invalid/incompatible/unstable/I/O diagnostics.
  - DGX Spark Codex: complete, 84 files, 57 aggregated sessions, zero malformed/invalid/incompatible/unstable/I/O diagnostics.
  - PC2 Codex: one concurrently changing file; replacement rejected while its startup-scan last-good aggregate remained available. The 99 malformed lines were inside structurally recognized histories and caused no invalid or incompatible classification.
  - PC1 Codex: one concurrently changing file; replacement rejected. Its 18 malformed lines were inside structurally recognized histories and caused no invalid or incompatible classification.
- Decision: Preserve the unstable-file guard and rerun Codex. Do not weaken consistency merely to force a green result while a provider is appending to a session.

## Execution checkpoint: privacy boundary

- Aggregate-only inspection covered dashboard, folders, planning, diagnosis, ledger, and every project session-list response after the first scan.
- None of the four exact configured roots appeared in those ordinary API responses.
- At least one configured-source session was present, and its detail endpoint returned `{ available: false }`; remote prompt preview and resume metadata remain unavailable.

## Execution checkpoint: startup and browser path

- Restarting the normal server with the saved local settings automatically began a six-source scan; no client, scheduler, service, import, or manual source selection was needed.
- The startup scan completed for both PC2 local sources, both DGX Spark sources, and PC1 Claude Code. PC1 Codex remained guarded because exactly one file changed during its read.
- A later source-only PC1 Codex scan again read all 554 files and produced zero invalid, incompatible, or I/O diagnostics, but the same one-file stability conflict prevented replacement. A 30-second metadata-only observation can be quiet, but the full read takes several minutes and overlaps intermittent remote writes.
- Browser inspection at a desktop viewport showed local/real-data mode, all six configured/default source names, three sources per provider, current aggregate data, explicit read-only/privacy copy, successful PC1/DGX statuses, and the retained-last-good warning for changing Codex inputs.
- This is an observed active-writer limitation, not a share-connectivity, permission, or schema-compatibility failure. Do not weaken the whole-source guard merely to import a mixed-time snapshot.

## Fresh security review and correction

- Fresh read-only Sol review accepted the compatibility, source-scoped replacement, migration, CSRF/loopback, configured-detail privacy, and naming paths, but found one blocking filesystem-boundary issue: a configured tree could contain a junction/reparse link that resolves outside the selected root or cycles to an ancestor.
- Correction: JSONL discovery now canonicalizes the selected root and every traversed directory, rejects any resolved directory outside the root as an I/O failure, and uses a Windows-case-folded visited set to stop cycles and duplicate traversal.
- Regression tests cover an outside-root directory link and an ancestor link. Because an escape increments the existing I/O diagnostic, the whole-source scanner rejects replacement and retains the prior successful snapshot.

## Verification

- `npm test`: 37 files, 293 tests passed.
- `npm run build`: typecheck and production build passed.
- `npm run format:check`: passed.
- `npm run privacy:check`: passed.
- `npm run lint`: passed with the same ten pre-existing Fast Refresh warnings in `src/client/pages/shared.tsx`.
- `git diff --check`: passed.
- Visible-name scans: canonical product naming is present; both retired visible-name patterns have zero repository matches.
- Correction re-review verdict: ship. The original blocking finding is resolved and no blocking issues remain.
- Remaining step: one local commit. Push, PR, tag, publish, deploy, and release remain excluded.
