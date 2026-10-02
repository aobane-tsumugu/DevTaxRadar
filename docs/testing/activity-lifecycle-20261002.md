# Common activity facts and lifecycle timeline validation

Baseline: PR #35 merged at `e4c3f22c3208107af38d048aa057992e512e4131`.

## Implemented path

- Register a product without usage history; later link existing cost units/history without replacing their IDs.
- Record concurrent development, internal use, external release, maintenance, suspension, retirement or partial abandonment with explicit scope, date/period/unknown time, observation/estimate/confirmation/unknown/conflict state, evidence and recording time.
- Correct facts and product/unit relationships by appending a predecessor reference and reason. Preserve original facts and wrong-target history.
- Save through the existing versioned workspace, preview hash, request receipt and three-way merge. New activity data is a versioned setting; no physical schema migration or legacy-fact conversion is performed.
- Inspect whole-product timeline and year-specific contribution/basis, decision, pending amount, balance account/movement links. Unknown costs remain unknown; stages are not added as duplicate expenses.
- Freeze timeline facts and stated cost-year coverage in annual review materials and export from that saved revision only.

## Automated coverage

- `tests/core/activityFacts.test.ts`: zero-history identity, concurrent uses, partial release/abandonment, unsupported contracts/dates/references, scoped correction closure, contradictory-purpose checks after resealing, moved-year corrections, confirmed-purpose reuse and unchanged stale seals, relationship/target correction, three-way merge.
- `tests/server/activityLedger.test.ts`: omitted old-client writes, append-only protection, SQL rollback, stable repeated requests, changed-payload and stale-revision rejection, backup/restore envelope preservation, future contract rejection, adopted N/N+1 bytes/hashes/export immutability and carry-forward correction checks.
- `tests/server/server.integration.test.ts`: real loopback HTTP timeline and versioned write, cross-year results, old-client rejection, absence of private original-evidence path.
- `tests/client/activityTimeline.test.tsx`: repeated zero-history registration, unsent partial-input recovery, cancellation, correction anchors, explicit coverage and contradictory states, network retry and dataset mismatch.
- `tests/client/appTimelineNavigation.test.tsx`: button navigation, repeated clicks, browser Back/Forward page restoration.
- Existing full suite covers historical-source retention, cost conservation, fixed-review reading and release-package startup/save/backup/restore/reconnect/restart.

## Verification boundaries

The local Node 24.19 / lockfile test, typecheck, build, lint, formatting and generated-document gates are run for the candidate. The sandbox does not permit the tsx CLI's optional Unix IPC socket, so local privacy and packaging also run the same source scripts using `node --import tsx`. GitHub's Linux and Windows jobs execute the ordinary npm privacy/package commands on the exact pushed head.

No graphical-browser or real-device visual acceptance is claimed. Localhost in the available cloud browser is blocked; this restriction was not bypassed. Narrow-width CSS, semantic controls, component flows and API/package checks are automated, but Windows CI is not Windows GUI/device acceptance. No merge, release or deployment is performed by this phase.

Unified original-charge intake, receipt-content extraction, accountant CSV and nonstandard annual-method calculations remain separate later phases.
