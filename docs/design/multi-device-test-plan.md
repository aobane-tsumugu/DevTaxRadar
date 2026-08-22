# Multiple filesystem sources: test plan

Status: **Phase 2 implemented checks and remaining platform evidence**

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
- All three observations contribute to one provider/month allocation denominator.
- Same-name folders stay separate until mapped.
- Source aliases appear in assignment summaries; roots do not.
- Repeating a complete scan replaces only that source and does not double count.

## 3. Availability and consistency

- Missing configured root records `unavailable` and keeps the last successful observations.
- Unknown-only files, invalid usage claims, permission, traversal, or read failures record a safe failure and keep prior observations. Malformed lines are counted and skipped only when the same file contains another recognized provider envelope.
- A file whose size or mtime changes during read is unstable and does not replace the source snapshot.
- A readable empty root is a complete empty snapshot and clears only that source.
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
