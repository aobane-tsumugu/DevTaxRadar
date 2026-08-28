# 2026-08-22-candidate-grouping-and-incremental-scan: candidate-first planning redesign

- Status: complete
- Created: 2026-08-22T12:32:09+09:00
- Last updated: 2026-08-22T13:51:49+09:00
- Parent iteration: none
- Supersedes: none
- Superseded by: none

## Objective and authority

- User objective: Make full history candidates the first substantive workflow; group candidates by assigning the same number, including private-use and excluded groups; stop requiring filing method in advance; retain the previously accepted dated-charge and incremental-scan direction.
- Why this change is being made: The current onboarding exposes tax terminology before the evidence it depends on, hides candidates after the first 12, and separates existing merge/split capabilities from candidate creation.
- Allowed scope: Local DevTax source, tests, migrations or compatibility adapters, user documentation, and project-local evidence. Local verification and browser testing are allowed.
- Excluded scope: Push, PR, deployment, publication, remote-share or credential changes, destructive data operations, and unrelated design work.

## Baseline

- Prior result and decision: Direct local/UNC/mounted-share scanning is the standard architecture at local commit `82c530e`.
- Baseline artifacts: `src/client/pages/Onboarding.tsx`, `src/client/pages/FolderAssignmentPage.tsx`, `src/planning/types.ts`, `src/server/historySources.ts`, adapters and their tests.
- Known limitations: Filing method is asked independently of income category; only 12 candidates are visible; manual add does not import remaining history; merge/split exists only in a separate folder screen; charges are calendar-month rows without billing periods; repeat scans reread all files and one unstable file can defer an entire source.

## Planned change

- Exact delta: Show all candidates with searchable numeric grouping and special private/excluded destinations; materialize final product groups and effective assignments; move filing-method treatment to result scenarios; add dated charge records with backward compatibility; add file-level incremental scan state and periodic/manual full reconciliation.
- Expected gain: Candidate-first workflow, explicit many-to-one grouping, lower repeat-scan work, more faithful billing history, and less misleading tax input.
- Possible loss or risk: Persisted-profile compatibility, allocation regressions, stale cache entries, and increased onboarding density.
- Fixed conditions, if any: Existing saved profiles and existing direct-share behavior must remain readable; raw transcript content and source paths must not be exposed; drag-and-drop is deferred but the grouping model must support it.
- Decision rule, if preregistered: Accept only after targeted tests, full test suite, type/build checks, browser verification, actual diff inspection, and fresh review for persistence/public-interface risk.

## Exact inputs and settings

- Repository: local DevTax working tree (absolute user path intentionally omitted)
- Baseline commit: `82c530e`
- User-selected grouping interaction: same numeric group value; special groups for private use and exclusion.
- Planned verification: repository scripts discovered from `package.json`, targeted unit/API tests, full tests, typecheck/build, and local browser inspection.
- Worker routing: bounded settled implementation may use fresh `gpt-5.6-terra`; primary retains architecture and acceptance. Fresh `gpt-5.6-sol` review is required after implementation because persistence and scan behavior are affected.

## Execution and artifacts

| Kind | Durable path or identity | Hash/version | Coverage | Verified |
|---|---|---|---:|---|
| Baseline | Git HEAD | `82c530e` | repository | yes |
| Plan | this entry | working tree | requested scope | yes |
| Candidate grouping | `src/client/candidateGrouping.ts`, onboarding UI | working tree | all history candidates; product/private/learning/later destinations; stable existing-unit reuse | unit, component, full-suite, and browser checks passed |
| Filing scenarios | `src/core/filingScenarios.ts`, onboarding final step, main dashboard | working tree | miscellaneous, business-white, business-blue views over the same factual buckets | unit, component, full-suite, and browser checks passed |
| Dated charges | `src/core/chargePeriods.ts`, database/API/dashboard, onboarding editor | working tree | exact service period, bill date, amount, cross-month and mid-month preservation | unit and integration checks passed |
| Incremental scan | adapters, `src/server/historySources.ts`, database/API | working tree | sanitized file cache, explicit full mode, duplicate-event stability | unit, API, database, and full-suite checks passed |

## Direct observations

- `Onboarding.tsx` ranks all products but renders only `slice(0, 12)`.
- Existing project rules can map multiple project keys to one tax unit and can split one key by effective dates.
- Existing source scans discover and read every JSONL file on repeat scans.
- Numeric grouping uses a gesture-independent destination record; identical normalized numbers create one tax unit and multiple default project rules.
- Later effective-dated project rules are preserved when a candidate default rule is materialized.
- Filing method and income category inputs were removed from onboarding; diagnosis no longer treats a prior income-category answer as readiness evidence.
- Cross-month charge allocation preserves the exact billed yen total and supports multiple plan rows within one month.
- Mid-month charge slices are allocated only to sessions whose exact dates fall in each slice.
- Existing charge-period rows survive legacy API updates that omit the new field.
- Duplicate normalized Claude events remain available if either duplicate source file is removed after caching.
- Saving the fee step refreshes persisted dashboard data before the onboarding result screen is shown.
- Browser verification showed 265 history candidates, numeric grouping controls, special private/learning/later destinations, and three comparable filing-result cards.

## Gains

- All history candidates are visible in a searchable scroll surface instead of being capped at 12.
- Private and general-learning history can be classified without creating a product.
- Filing scenarios are visible as results rather than prior requirements.
- Dated plan changes can be recorded with exact start/end and billing dates without flattening a month.
- Repeat scans reuse unchanged sanitized file contributions; users can request a full rescan explicitly.

## Losses and regressions

- Drag-and-drop remains deferred; number entry is the current interaction.
- An initial cache fill for multi-gigabyte history files can still take substantial time; the real first-fill run was not claimed complete.
- Incremental identity uses file metadata, so an unusual share-side rewrite that preserves both size and mtime needs an explicit full rescan.

## Interpretation and alternatives

- Current explanation: The data model has useful primitives, but onboarding and scan orchestration do not expose or exploit them at the correct level.
- Competing explanations: A drag-and-drop-only redesign could solve discoverability but would add interaction complexity without addressing persistence or accessibility.
- Evidence that distinguishes them: Numeric grouping can be tested deterministically and later rendered as drag-and-drop without changing group identity.

## Contemporaneous decision

- Decision at this time: Accept the local implementation. Numeric grouping is the accessible deterministic interaction; its destination model can support a later drag-and-drop presentation.
- Action now allowed: Local inspection, implementation, tests, documentation, and browser verification.
- Action still prohibited: Push, deploy, publish, remote mutation, destructive migration, or claiming completion before fresh review.
- Coverage and confidence limit: 41 test files / 312 tests, production build, lint, format, privacy, diff checks, browser inspection, and two rounds of fresh risk review passed. Performance of the first cache fill on multi-gigabyte files remains an operational limit.
- Revision trigger: Existing persistence or scanner boundaries cannot safely support the planned delta without a broader migration.

## Knowledge disposition

- Candidate knowledge: Candidate normalization should precede per-product tax facts; group identity must not be encoded as a drag gesture.
- Promoted to: none
- Demoted or withdrawn from: none
- Supporting iteration IDs: `2026-08-22-candidate-grouping-and-incremental-scan`
- Reusable bad use, if causally supported: none yet

## Corrections and later history

- Fresh review found that existing product IDs could be remapped, mid-month charges could be flattened, filing cards used non-comparable totals, the later destination did not clear the default mapping, cached duplicate events could disappear, legacy API payloads could erase dated charges, and impossible calendar dates were accepted. Each issue was corrected with regression coverage.
- A second fresh review found a numeric group collision during hydration and stale values on the onboarding result screen. Group numbers now reserve generated numeric IDs first, and the fee step saves and refreshes before showing results; focused regression tests pass.
- Final repository verification: 41 test files / 312 tests passed; build, lint (warnings only in the pre-existing export-only rule), formatting, privacy, and `git diff --check` passed.
- Final fresh read-only review of the two last corrections reported no P0, P1, or P2 findings and a `ship` verdict.
