# Multiple filesystem sources: test plan

Status: **Baseline 7c201f0; existing checks and pending acceptance additions (2026-09-09)**

The added acceptance cases below are not recorded as executed. Implementation order is in [the work plan](implementation-plan.md); historical results remain in [the evidence](../evidence/multi-device-integration/INDEX.md).

## 1. Non-negotiable gates

All tests use isolated temporary application data and synthetic provider histories. No real home, share, database, session, path, provider charge, or credential is accessed.

```text
npm test
npm run typecheck
npm run lint
npm run format:check
npm run privacy:check
npm run build
```

## 2. Identity and aggregation

- Built-in local keys remain byte-for-byte compatible.
- PC1, PC2, and DGX fixtures containing identical native IDs become three distinct source/session/project identities.
- Observations share an allocation denominator only when they belong to the same actual contract and applicable period. Distinct-contract attribution and copied-history detection are pending W03 work; source identity alone proves neither.
- Same-name folders stay separate until mapped.
- Source aliases appear in assignment summaries; roots do not.
- Repeating a complete scan replaces only that source and does not double count.

## 3. Availability and consistency

- Missing configured root records `unavailable` and keeps the last successful observations.
- Permission, traversal, or read I/O failures protect the source snapshot.
- Format-incompatible and unstable files are deferred individually: reuse a valid prior value where available and advance other stable files. A first-seen deferred file remains unknown. Do not equate one deferred file with a source-wide failed scan.
- Pending W02 cases retain prior-value usage, missing coverage, adapter version, and timezone alongside numbers through restart, adoption, and export.
- A readable empty root clears only current observations for that source, never adopted records. Pending W02 case: acquire numbers, leave tax decisions/annual adoption unfinished, lose originals, and restart automatic scanning; preserved numerical records and conditions must remain explainable.
- A failed DGX source does not prevent PC1/PC2 sources from completing.
- Startup/manual scans and source mutations serialize rather than interleave replacement transactions.

## 4. API and UX

- Source mutations require loopback origin and CSRF protection.
- Relative roots and path-like aliases are rejected.
- Duplicate normalized provider/root pairs are rejected.
- Default sources cannot be edited or deleted.
- Source connectivity test returns counts only, never filenames.
- Startup automatically scans a previously configured synthetic source.
- The settings screen exposes add, edit, test, enable, cancel, and confirmed removal controls; keyboard and focus behavior remain a release-platform check.
- Unavailable/failed copy explains that prior data remains.
- Removal deletes only normalized data for that source; the fixture directory remains unchanged.

## 5. Privacy

Canaries for configured absolute paths, native session IDs, prompts, responses, source content, and hashes must be absent from:

- scan results and progress;
- runtime and dashboard;
- folder and session-list APIs;
- planning, diagnosis, ledger, and Markdown export;
- public demo/static build; and
- server responses exercised by isolated integration tests.

The configured root is expected only in the explicit `/api/sources` settings response.

Configured sources must not create `session_references` rows or expose local resume/session-preview functionality.

## 6. Migration

- A pre-source current-schema database is backed up before DDL.
- Backup passes `PRAGMA integrity_check`.
- Existing session/project keys and planning rules remain unchanged.
- Existing usage/reference/scan rows receive `local-claude` or `local-codex` provenance.
- Rebuilt unique/primary keys include `source_id`.
- Existing charges, contracts, tax units, planning ledger, and allocations remain equal.
- A second initialization is idempotent and does not create another migration backup.
- A checksum failure closes and discards the failed singleton so a retry fails closed again.

## 7. Platform checks before a release

- Windows local path and UNC path normalization.
- DGX/Linux absolute mounted path normalization.
- Windows share offline/online transition.
- Linux SMB/NFS mounted read-only root.
- Narrow settings modal, path wrapping, focus, labels, status announcement, and removal confirmation.

Real PC1/DGX validation may use synthetic directories only and requires separate authorization to create or change actual shares. Repository completion does not claim that real-device smoke occurred.

## 8. Added cross-cutting acceptance (not yet run)

- AC-TIME: scan in UTC, restart in Japan time, then mix unchanged and changed files. Reused and reread data must share the declared calculation timezone; adopted records must not move months.
- AC-ALLOC: same provider/period, contract A 8,000 yen solely for product A and B 2,000 yen solely for B; expect 8,000/2,000, not 5,000/5,000. Unknown attribution remains unknown.
- AC-RESTORE: restore on a separate machine while the former shared roots are inaccessible; fixed records remain readable, and reconnection preserves identity.
- Preserve historical platform results as historical; neither this plan nor synthetic tests establishes a new Windows/DGX smoke result.
