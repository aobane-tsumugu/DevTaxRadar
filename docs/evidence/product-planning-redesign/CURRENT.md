# Current iteration state

- Current objective: Reorder DevTax around full history-candidate grouping, remove the pre-emptive filing-method question, model dated charges, and make repeat scans incremental without breaking existing saved data.
- Active iteration: `2026-08-22-candidate-grouping-and-incremental-scan`
- Current status: complete in the local working tree; candidate grouping, result scenarios, dated charges, and persistent incremental scanning have passed repository and browser acceptance.
- Last durable checkpoint: 41 test files / 312 tests pass; build, lint, formatting, privacy, and diff checks pass; final fresh review reported no P0/P1/P2 findings and a `ship` verdict; the latest bundle is running as one server on port 4399 with automatic scanning disabled for browser verification.
- Last verified artifact: Git HEAD `82c530e` plus the uncommitted working-tree delta; browser verification completed at 2026-08-22T13:51+09:00.
- Current decision: History candidates are the first substantive onboarding task. Filing method is a result scenario, not a required prior input. Group identity must be independent of UI gesture.
- Unresolved question: Drag-and-drop is deferred. The first cache fill can remain slow for multi-gigabyte history files, and a share that changes a file while preserving both size and mtime requires an explicit full rescan.
- Exact next action: User acceptance of the local UI; no implementation work remains in the authorized scope.
- Required approval or external change: None. Push, PR, publish, deploy, remote-share mutation, and destructive actions remain prohibited.
- Relevant predecessor entries: `../multi-device-integration/entries/2026-08-20-direct-folder-pull-phase2.md`, `../multi-device-integration/entries/2026-08-22-real-share-validation-and-commit.md`
- Current curated knowledge version: none
- Last updated: 2026-08-22T13:51:49+09:00

## Resume sequence

1. Read project governance.
2. Read the active iteration entry.
3. Verify the recorded HEAD and working-tree scope.
4. Treat this iteration as complete unless user acceptance identifies a correction.
