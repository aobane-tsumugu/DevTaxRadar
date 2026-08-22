# Multiple filesystem sources: security and privacy

Status: **approved Phase 2 boundary**
Decision date: 2026-08-20

## 1. Trust model

The standard mode assumes:

- the user controls the hub and source machines;
- the selected LAN and operating-system file share are trusted for the user's transcript data;
- share authentication, transport protection, credential storage, and mount lifecycle are owned by Windows/Linux/NAS configuration; and
- only the narrow provider-history roots are shared read-only.

DevTax does not claim that every LAN is trusted. Instead, the user explicitly chooses a filesystem root already authorized by the OS. Users on guest, public, or mutually untrusted networks should not expose transcript directories and should wait for a minimized collector/export fallback.

## 2. Removed attack surface

The approved standard mode adds no LAN listener. The existing Fastify browser/API server remains bound to `127.0.0.1` and retains Host, Origin, CSRF, and request-size protection.

Consequently DevTax needs no:

- device private keys or certificates;
- pairing service or discovery protocol;
- DevTax network password;
- firewall opening;
- replay protocol;
- remote command endpoint;
- arbitrary remote-path API; or
- uploaded archive parser.

## 3. Remaining threats and controls

| Threat | Control |
|---|---|
| Hub account can read too much | User selects a narrow provider root; documentation recommends read-only share permissions |
| Malicious/accidental relative path | API accepts only normalized absolute filesystem paths |
| Duplicate root configured twice | Unique normalized root key per provider |
| Source unavailable | No replacement; last successful observations remain |
| Partial network read | Any I/O error fails the source snapshot without replacement |
| File changes during scan | Compare size and mtime before/after read; retain prior snapshot |
| Same session ID on two PCs | Source-specific identifier namespace and source-aware DB uniqueness |
| Shared SQLite corruption | DevTax SQLite remains hub-local; only provider history files are read remotely |
| Path or native ID leaks | Allowlisted responses; explicit settings endpoint is the only root-path surface |
| Prompt/source content persistence | Adapters extract numeric/session metadata only; remote session detail is disabled |
| Path disclosure in logs | Filesystem exception text and roots are not logged by scan orchestration |
| Accidental source deletion | Explicit confirmation; deletion is source-scoped and never writes original files |

## 4. Privacy boundary

The following may be read from a selected root because the provider JSONL format contains them:

- native session IDs;
- working directories;
- prompt/response/source-code records; and
- token-usage records.

The parser ignores prompt, response, and source-code bodies. For configured roots, it does not persist local references, native session IDs, full working directories, source paths, content hashes, or resume commands.

Persisted configured-source fields are allowlisted:

- opaque source ID and user alias;
- provider;
- namespaced session/project keys;
- basename-only project label;
- timestamps and month;
- model and token counters;
- adapter/schema/confidence metadata; and
- safe scan counts/status.

## 5. Explicit path-settings exception

Absolute roots are sensitive. They are accepted and returned only by the loopback source-settings workflow. Every mutation remains CSRF-protected; the read-only `GET` uses the existing Host/loopback boundary:

- `GET /api/sources`
- `POST /api/sources`
- `PATCH /api/sources/:id`
- `POST /api/sources/test`
- `DELETE /api/sources/:id`

The browser renders roots only inside the explicit local settings modal. Roots must not appear in dashboard, folders, sessions, scan results/progress, planning, diagnosis, ledger, export, public demo, logs, or release fixtures.

## 6. Credentials

DevTax stores no Samba/NFS password. Windows Credential Manager, a Windows authenticated session, Linux mount configuration, or the relevant OS mechanism supplies access before DevTax starts.

If the OS cannot access a share, DevTax reports a generic missing/not-readable status. It does not return the OS error string because that can contain server names, usernames, and paths.

## 7. Read-only contract

Provider adapters open transcript files with read flags and enumerate directories. DevTax never creates, edits, renames, deletes, or locks a configured history root.

The only history-file write in the existing product is the separate, explicit Claude retention-settings feature for the hub's own default settings file. It is not available for configured shared roots.

## 8. Residual risk

Direct scanning means raw transcript bytes traverse the LAN/share before filtering. A compromised hub account or share administrator could read them outside DevTax. This is an accepted tradeoff for zero source installation and one-point updates.

Users who cannot accept that tradeoff need a future local projection/collector mode. Adding such a mode does not change direct filesystem pull as the simplest OSS default.
