# Multiple filesystem sources

Status: **approved Phase 2 architecture**
Decision date: 2026-08-20

## 1. Outcome

DevTax runs on one hub PC and directly scans user-selected filesystem roots. A root may be:

- the hub's normal local Claude Code or Codex history directory;
- a Windows UNC path;
- an SMB, NFS, or other share mounted by the operating system; or
- another read-only directory visible through the local filesystem.

DevTax does not implement Samba, store share credentials, synchronize peer databases, install a remote client, register a scheduled task, or require a source PC to run DevTax.

```text
PC1 history root ── OS file share ─┐
DGX history root ── OS file share ─┼─> one PC2 DevTax database
PC2 local history ─────────────────┘
```

The hub automatically scans enabled roots when its server starts. A user may also scan while DevTax is open. There is no operating-system autostart service or background process after DevTax exits.

## 2. Why this is the OSS default

DevTax is expected to be opened roughly once or twice per month. Direct pull therefore minimizes total ownership cost:

- only the hub installation needs updates;
- source machines need no binary, runtime, service, timer, pairing, or app credential;
- local paths and mounted shares use one provider-adapter interface;
- a source may be offline without deleting the hub's last successful observations; and
- the single-PC experience remains zero-configuration.

The earlier signed-bundle and dedicated LAN-ingress proposal was reviewed but superseded before implementation. It solved untrusted-network and unattended-source cases that are not the accepted default threat model.

## 3. Authority and synchronization

There is no peer synchronization.

| State | Authority |
|---|---|
| Claude/Codex transcript files | The source filesystem |
| Source configuration | The hub |
| Normalized observations | The hub's local SQLite database |
| Project rules and tax units | The hub |
| Provider charges and contracts | The hub |
| Allocation results | Derived on the hub |

Each source contributes only observations read from its own root. Mutable planning state is never copied back to PC1 or DGX. Other PCs may view the same hub UI in a future opt-in feature, but they do not receive replicated databases.

## 4. Source model

`history_sources` stores one provider root per row:

```text
HistorySource
  id          opaque UUID, or local-claude/local-codex for built-ins
  provider    claude | codex
  kind        default | configured
  name        user-chosen safe alias
  root        absolute local/UNC/mounted path; settings boundary only
  enabled
  timestamps
```

One device using both providers is represented by two roots. Their aliases may share a prefix such as `PC1 · Claude Code` and `PC1 · Codex`. A separate device-enrollment model is intentionally unnecessary.

Every observation, local reference, and scan row carries `source_id`. Database uniqueness includes `source_id`, so equal provider-native IDs from PC1 and DGX coexist.

## 5. Stable identifiers and compatibility

- Existing local Claude/Codex rows retain their exact session and project keys.
- Existing rows migrate to `local-claude` or `local-codex` without changing their keys.
- A configured root derives an identifier namespace from the hub's existing local identifier salt and the opaque source ID.
- The source ID is not a password or cryptographic device identity. It prevents accidental key collision.
- Deleting and recreating a configured source creates a new namespace. Editing the root for the same source preserves its namespace.

Same folder names or equal native session IDs on different sources never merge automatically. Users may assign the resulting distinct project keys to the same tax unit through the existing mapping rules.

## 6. Scan and replacement contract

A scan is serialized inside the running DevTax process. For each enabled source:

1. Probe the configured root without returning filesystem errors or paths through ordinary APIs.
2. Stream only `.jsonl` files through the existing provider adapter.
3. Verify that each file's size and modification time did not change while it was read.
4. Aggregate messages into the existing session/month slices.
5. Replace only rows owned by `(sourceId, provider)` in one transaction.
6. Record safe counts and status.

Current behavior at 7c201f0 (2026-09-09): source-wide replacement is withheld on missing/offline roots, unreadable shares, probe timeouts, traversal/read I/O errors, or an unexpected failure before commit. Previously imported rows remain.

Files that change during reading or do not match the adapter format are deferred individually by the incremental scan. Reusable prior values for those files remain, while other stable files can advance. A first-seen deferred file has no prior value; it must not be described as fully captured. Do not restore the former all-source stop for a single unstable file.

Persisting that distinction, adapter/timezone provenance, and numerical records before annual adoption remains planned in [W02](implementation-plan.md); it is not established by a successful scan response.

A readable empty directory is a valid complete snapshot and removes that source's current observations. This differs from an unavailable directory. Adopted records remain separate; preservation of acquired numbers before annual adoption is an explicit W02 acceptance case.

## 7. Provenance and mapping

Folder summaries and session lists contain the safe source ID and user alias. They do not contain the configured root, native session ID, absolute source path, or content hash.

Configured roots use the existing basename-only project label to support mapping. The full working directory remains outside dashboard, planning, allocation, and export responses.

Local built-in histories retain the existing on-demand local session detail/resume feature. Configured shared roots expose aggregate metadata only because a resume command for a remote machine would be misleading and would reveal remote working-directory details.

## 8. Startup and offline behavior

- Server startup starts one in-process scan after the loopback listener is ready.
- `DEVTAX_RADAR_AUTO_SCAN=0` exists for isolated tests and diagnostics.
- Manual scans queue behind an already-running startup scan rather than running concurrently.
- An offline source receives an `unavailable` status; its last successful rows remain allocated.
- The next DevTax start retries automatically.
- No polling, watcher, scheduler, or resident process remains after DevTax exits.

## 9. User workflow

The existing local settings/onboarding screen contains “読み取り元を管理”:

1. Choose Claude Code or Codex.
2. Enter a safe display name such as `PC1` or `DGX`.
3. Enter the absolute provider-history root.
4. Test visibility without importing.
5. Save; the next scan includes it automatically.

The explicit source-settings API is the only product API that returns configured absolute roots. All dashboard, folder, session-list, scan-result, planning, ledger, diagnosis, and export surfaces omit them.

Removing a configured source is an explicit destructive action in the UI. It removes only that source's normalized rows and scan history from the hub; original files are never changed.

## 10. Migration

Before adding the multi-source schema to an existing database, DevTax creates a unique SQLite `VACUUM INTO` backup and verifies it with `PRAGMA integrity_check`.

The forward migration:

- adds source provenance to scans;
- rebuilds `usage_events` uniqueness as `(source_id, provider, session_key, project_key, month)`;
- rebuilds `session_references` identity as `(source_id, provider, session_key)`;
- assigns existing rows to the appropriate built-in local source; and
- preserves existing keys, project rules, tax units, charges, contracts, and planning tables.

Rollback is manual: stop DevTax and restore the verified `before-multi-source` backup. DevTax never mutates a source history directory during migration or scanning.

## 11. Deferred fallback modes

A one-shot collector may later be offered only when:

- the source cannot expose a readable filesystem root;
- a provider changes to a database format that cannot be read safely over a share; or
- the user does not want raw transcript bytes to traverse the share.

Such a collector would be manually invoked or integrated by the user's own automation. It is not installed, scheduled, or auto-updated by the current DevTax implementation.

Manual bundles, a LAN upload API, pairing, public/private device keys, and peer synchronization are not part of the approved Phase 2 scope.

## 12. Known limits

- DevTax necessarily reads source-file bytes over the LAN/share; it persists only normalized metadata.
- Filesystem availability timeouts cannot cancel an operating-system network I/O already in progress; the UI returns a safe unavailable result while the OS request finishes.
- Source aliases are user-provided and should not contain confidential client or repository names unless the user intends to display them.
- Duplicate-root detection is lexical after path normalization. Filesystem aliases such as symlinks, junctions, mapped drives, or different UNC spellings can still identify the same directory; users should configure only one spelling per provider root.
- SQLite/WAL provider histories would require a provider-specific consistency design; current supported providers use JSONL.
- A configured source should grant read-only access to the narrowest provider-history directory, not an entire home directory or drive.

## 13. Review follow-through (2026-09-09)

[The implementation plan](implementation-plan.md) preserves direct-folder pull and source namespaces. W03 distinguishes provider, actual subscription, and history source: multiple devices do not automatically imply a common contract, and distinct source IDs do not by themselves prevent counting a copied history twice. W02 covers mixed-timezone cache reuse and capture provenance; W07 covers separate-device restoration without original roots. These are pending acceptance cases, not new real-device test results.
