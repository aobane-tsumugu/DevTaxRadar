# Current iteration state

- Current objective: Validate the accepted direct-folder architecture against already-connected real PC1 and DGX Spark history roots, then preserve the complete implementation in a local commit.
- Active iteration: `2026-08-22-real-share-validation-and-commit`
- Current status: accepted after correction re-review; implementation, real-share validation, startup/browser verification, filesystem-boundary correction, and full gates are complete. Local commit is pending.
- Last durable checkpoint: Both DGX Spark sources, PC1 Claude, and both PC2 local sources have successful real snapshots. PC1 Codex is reachable and structurally compatible but remains intentionally uncommitted to the database while one remote file is intermittently appended during each multi-minute read.
- Last verified artifact: 37 files/293 tests, build/typecheck, format, privacy, lint, diff check, ordinary-API root non-disclosure, configured-detail denial, browser real-data mode, and startup auto-scan passed.
- Current decision: One hub owns mutable DevTax state. Its provider adapters read explicit filesystem roots regardless of whether they are local paths, UNC paths, or OS-mounted SMB/NFS paths. No peer synchronization or remote client is required in the standard path.
- Unresolved question: Operational only: PC1 Codex needs a future scan window long enough that its active file does not change. No code or share mutation is justified by the current evidence.
- Exact next action: Inspect final diff/status and create the authorized local commit without pushing.
- Required approval or external change: None for the current read-only scan and local commit. Share/credential/firewall/remote-file mutations and push/PR/deploy/release remain prohibited.
- Relevant predecessor entries: `2026-08-20-phase0-phase1`
- Current curated knowledge version: none
- Last updated: 2026-08-22T12:06:56+09:00

## Resume sequence

1. Read project governance.
2. Read the active real-share iteration entry and its Phase 2 predecessor.
3. Verify the last availability probes before accessing any root.
4. Continue from the exact next action without printing transcript content or mutating remote systems.
