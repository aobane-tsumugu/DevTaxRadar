import type { BalanceReview } from '../accounting/balanceWorkspace.js'
import { accountantZip } from './accountantZip.js'

type Cell = string | number | null | undefined
export type AccountantFile = { name: string; content: string }
export const ACCOUNTANT_CSV_VERSION = 'devtax-accountant/1'

/** Numeric cells originate only from saved numeric fields. All text is quoted and guarded. */
export function accountantCsvCell(value: Cell): string {
  if (value == null) return ''
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new Error('CSVに安全な整数でない数値があります。')
    return String(value)
  }
  // Ignore leading whitespace/control/format marks when testing spreadsheet formula prefixes.
  const guarded =
    /^[\s\p{Cc}\p{Cf}]*[=+\-@]/u.test(value) || /^[\t\r\n]/.test(value) ? "'" + value : value
  return '"' + guarded.replaceAll('"', '""') + '"'
}
const list = (values: readonly string[] | undefined) => JSON.stringify(values ?? [])
const status = (value: number | null | undefined) => (value == null ? 'unknown' : 'known')

/** Pure projection of one frozen review. No current configuration, logs, or calculation calls. */
export function accountantCsvFiles(review: BalanceReview): AccountantFile[] {
  if (review.schemaVersion !== 1 || (review.materials && review.materials.schemaVersion !== 1))
    throw new Error('未対応の保存版です。CSVを補完・再計算しません。')
  const files: AccountantFile[] = []
  const common = ['schema_version', 'review_id', 'review_year']
  function table(name: string, headers: string[], rows: Cell[][]) {
    files.push({
      name: name + '.csv',
      content:
        '\ufeff' +
        [
          [...common, ...headers],
          ...rows.map((row) => [ACCOUNTANT_CSV_VERSION, review.id, review.year, ...row]),
        ]
          .map((row) => row.map(accountantCsvCell).join(','))
          .join('\r\n') +
        '\r\n',
    })
  }
  const unresolved: Cell[][] = []
  const issue = (
    year: number,
    kind: string,
    id: string,
    amount: number | null,
    reasons: string[],
  ) => unresolved.push([year, kind, id, status(amount), amount, list(reasons)])
  table(
    'review',
    [
      'draft_revision',
      'created_at',
      'engine_version',
      'corrects_review_id',
      'previous_review_id',
      'reason',
      'materials_status',
      'tax_treatment_verified',
    ],
    [
      [
        review.draftRevision,
        review.createdAt,
        review.engineVersion,
        review.correctsReviewId,
        review.previousReviewId,
        review.reason,
        review.materials ? 'stored' : 'not-recorded',
        'false',
      ],
    ],
  )
  const materials = review.materials
  // costLinks contains historical lots; use them once per saved year, not in addition to costs.
  const costs = materials ? [...(materials.costLinks?.costs ?? [])] : []
  if (materials && !costs.some((row) => row.year === materials.costs.year))
    costs.push(materials.costs)
  if (new Set(costs.map((row) => row.year)).size !== costs.length)
    throw new Error('保存版に同じ年の費用資料が重複しています。合算しません。')
  if (!materials)
    issue(review.year, 'materials', review.id, null, ['not-recorded-in-legacy-review'])
  const sources: Cell[][] = [],
    adjustments: Cell[][] = [],
    bases: Cell[][] = [],
    allocations: Cell[][] = [],
    treatments: Cell[][] = []
  for (const cost of costs) {
    for (const row of cost.sources) {
      const fact = row.originalChargeFact
      sources.push([
        cost.year,
        row.id,
        row.kind,
        row.label,
        status(row.originalAmountJpy),
        row.originalAmountJpy,
        list(row.unknownOriginalAmountReasons),
        fact?.id,
        fact?.correctsId,
        fact?.correctionReason,
        fact?.original.currency ?? (fact ? null : row.currency),
        fact?.original.amount ?? (fact ? null : row.originalAmountJpy?.toString()),
        fact
          ? fact.original.amount === null
            ? 'unknown'
            : 'known'
          : status(row.originalAmountJpy),
        fact?.original.unknownAmountReason,
        fact?.original.fx?.jpyPerUnit,
        fact?.original.fx?.convertedOn,
        fact?.original.fx?.rounding,
        fact?.original.fx?.reference,
        list(fact?.original.conversionEvidenceIds),
        fact?.servicePeriod?.startedOn ?? row.servicePeriod?.startedOn,
        fact?.servicePeriod?.endedOn ?? row.servicePeriod?.endedOn,
        fact?.dates?.billedOn ?? row.billedOn,
        fact?.dates?.paidOn ?? row.paidOn,
        fact?.dates?.acquiredOn ?? row.acquiredOn,
        fact?.dates?.incurredOn ?? row.incurredOn,
        row.contractId,
        fact?.contract?.reference,
        list(row.evidenceIds),
      ])
      if (row.originalAmountJpy === null)
        issue(
          cost.year,
          'source',
          row.id,
          null,
          row.unknownOriginalAmountReasons ?? ['not-recorded'],
        )
      for (const adjustment of row.adjustments ?? [])
        adjustments.push([
          cost.year,
          row.id,
          adjustment.id,
          adjustment.sourceYear,
          adjustment.kind,
          adjustment.amountJpy,
          adjustment.occurredOn,
          adjustment.effect,
          adjustment.balanceMovementId,
          adjustment.reason,
          list(adjustment.evidenceIds),
        ])
    }
    for (const row of cost.bases) {
      bases.push([
        cost.year,
        row.id,
        row.sourceId,
        list(row.parentContributionIds),
        list(row.affectedTaxUnitIds),
        row.period.startedOn,
        row.period.endedOn,
        row.amount.status,
        row.amount.amountJpy,
        row.amount.status === 'unknown' ? list(row.amount.reasons) : '[]',
        row.method.id,
        row.method.version,
        row.method.explanation,
        list(row.warnings),
      ])
      if (row.amount.status === 'unknown')
        issue(cost.year, 'basis', row.id, null, row.amount.reasons)
    }
    for (const row of cost.contributions) {
      const unit = row.target.kind === 'tax-unit' ? row.target.taxUnitId : undefined
      allocations.push([
        cost.year,
        row.id,
        row.basisId,
        list(row.sourceIds),
        row.target.kind,
        unit,
        cost.byTaxUnit.find((value) => value.taxUnitId === unit)?.name,
        row.consumedByBasisId ? 'intermediate-consumed' : 'terminal',
        row.consumedByBasisId,
        'known',
        row.amountJpy,
        row.reason,
        list(row.evidenceIds),
      ])
    }
    if (!cost.treatments)
      issue(cost.year, 'annual-treatment', String(cost.year), null, ['not-recorded-in-review'])
    for (const row of cost.treatments?.items ?? []) {
      const fact = materials?.planning.costTreatmentFacts?.find(
        (value) => value.id === row.factsId && value.costYear === cost.year,
      )
      treatments.push([
        cost.year,
        row.contributionId,
        row.basisId,
        list(row.sourceIds),
        row.taxUnitId,
        row.label,
        row.factsId,
        fact?.workPurpose ?? 'unknown',
        row.status,
        row.candidate,
        row.amountJpy,
        status(row.currentYearExpenseJpy),
        row.currentYearExpenseJpy,
        status(row.futureCostJpy),
        row.futureCostJpy,
        list(row.reasons),
        list(row.missingFacts),
        list(row.appliedRuleIds),
        list(fact?.evidenceIds),
        'conditional-not-posted',
      ])
      if (!['conditional', 'excluded'].includes(row.status))
        issue(cost.year, 'treatment', row.contributionId, row.amountJpy, [
          ...row.reasons,
          ...row.missingFacts,
        ])
    }
  }
  table(
    'sources',
    [
      'cost_year',
      'source_id',
      'kind',
      'label',
      'adopted_original_jpy_status',
      'adopted_original_jpy',
      'unknown_reasons_json',
      'original_fact_id',
      'corrects_fact_id',
      'correction_reason',
      'original_currency',
      'original_amount_decimal_text',
      'original_amount_status',
      'original_unknown_reason',
      'fx_rate_decimal_text',
      'fx_date',
      'fx_rounding',
      'fx_reference',
      'conversion_evidence_ids_json',
      'period_start',
      'period_end',
      'billed_on',
      'paid_on',
      'acquired_on',
      'incurred_on',
      'contract_id',
      'original_contract_reference',
      'evidence_ids_json',
    ],
    sources,
  )
  table(
    'source_adjustments',
    [
      'cost_year',
      'source_id',
      'adjustment_id',
      'source_year',
      'kind',
      'adjustment_jpy',
      'occurred_on',
      'effect',
      'movement_id',
      'reason',
      'evidence_ids_json',
    ],
    adjustments,
  )
  table(
    'bases',
    [
      'cost_year',
      'basis_id',
      'source_id',
      'parent_contribution_ids_json',
      'tax_unit_ids_json',
      'period_start',
      'period_end',
      'amount_status',
      'amount_jpy',
      'unknown_reasons_json',
      'method_id',
      'method_version',
      'method_explanation',
      'warnings_json',
    ],
    bases,
  )
  table(
    'allocations',
    [
      'cost_year',
      'contribution_id',
      'basis_id',
      'source_ids_json',
      'target_kind',
      'tax_unit_id',
      'product_name',
      'allocation_status',
      'consumed_by_basis_id',
      'amount_status',
      'amount_jpy',
      'reason',
      'evidence_ids_json',
    ],
    allocations,
  )
  table(
    'annual_treatments',
    [
      'cost_year',
      'contribution_id',
      'basis_id',
      'source_ids_json',
      'tax_unit_id',
      'label',
      'facts_id',
      'purpose',
      'status',
      'candidate',
      'contribution_jpy',
      'expense_candidate_status',
      'expense_candidate_jpy',
      'future_candidate_status',
      'future_candidate_jpy',
      'reasons_json',
      'missing_facts_json',
      'rule_ids_json',
      'evidence_ids_json',
      'posting_status',
    ],
    treatments,
  )
  table(
    'balances',
    [
      'account_id',
      'tax_unit_id',
      'name',
      'kind',
      'opening_review_id',
      'opening_status',
      'opening_jpy',
      'opening_reasons_json',
      'additions_jpy',
      'transfers_in_jpy',
      'transfers_out_jpy',
      'expenses_jpy',
      'reductions_jpy',
      'closing_status',
      'closing_jpy',
      'closing_reasons_json',
      'movement_ids_json',
      'method',
      'method_engine',
      'method_evidence_ids_json',
    ],
    review.projection.accounts.map((row) => {
      const method = review.snapshot.accounts.find(
        (value) => value.id === row.accountId,
      )?.softwareMethod
      for (const [kind, amount] of [
        ['opening', row.opening],
        ['closing', row.closing],
      ] as const)
        if (amount.status === 'unknown')
          issue(review.year, kind, row.accountId, null, amount.reasons)
      return [
        row.accountId,
        row.taxUnitId,
        row.name,
        row.kind,
        row.openingRevisionId,
        row.opening.status,
        row.opening.amountJpy,
        row.opening.status === 'unknown' ? list(row.opening.reasons) : '[]',
        row.additionsJpy,
        row.transfersInJpy,
        row.transfersOutJpy,
        row.expensesJpy,
        row.reductionsJpy,
        row.closing.status,
        row.closing.amountJpy,
        row.closing.status === 'unknown' ? list(row.closing.reasons) : '[]',
        list(row.movementIds),
        method?.method,
        method?.engineVersion,
        list(method?.evidenceIds),
      ]
    }),
  )
  const links: Cell[][] = []
  table(
    'balance_movements',
    [
      'movement_id',
      'movement_year',
      'in_review_year',
      'occurred_on',
      'kind',
      'account_id',
      'from_account_id',
      'to_account_id',
      'amount_status',
      'amount_jpy',
      'source_ids_json',
      'decision_id',
      'reason',
      'software_expense_year',
    ],
    review.snapshot.movements.map((row) => {
      if (row.kind === 'addition')
        for (const link of row.costAllocations ?? [])
          links.push([
            row.id,
            'cost-addition',
            null,
            null,
            link.costYear,
            link.contributionId,
            link.amountJpy,
          ])
      for (const link of row.balanceAllocations ?? []) {
        links.push([
          row.id,
          'balance-consumption',
          link.sourceKind,
          link.sourceId,
          null,
          null,
          link.amountJpy,
        ])
        for (const cost of link.costAllocations ?? [])
          links.push([
            row.id,
            'consumption-cost-detail',
            link.sourceKind,
            link.sourceId,
            cost.costYear,
            cost.contributionId,
            cost.amountJpy,
          ])
      }
      return [
        row.id,
        Number(row.occurredOn.slice(0, 4)),
        String(row.occurredOn.startsWith(review.year + '-')),
        row.occurredOn,
        row.kind,
        row.kind === 'transfer' ? null : row.accountId,
        row.kind === 'transfer' ? row.fromAccountId : null,
        row.kind === 'transfer' ? row.toAccountId : null,
        'known',
        row.amountJpy,
        list(row.sourceIds),
        row.decisionId,
        row.reason,
        row.softwareExpense?.year,
      ]
    }),
  )
  table(
    'movement_links',
    [
      'movement_id',
      'link_kind',
      'source_kind',
      'source_id',
      'cost_year',
      'contribution_id',
      'amount_jpy',
    ],
    links,
  )
  for (const row of review.projection.pendingDecisions)
    issue(row.taxYear, 'pending-decision', row.id, row.amount.amountJpy, [
      ...row.reasons,
      ...(row.amount.status === 'unknown' ? row.amount.reasons : []),
    ])
  table(
    'pending_decisions',
    [
      'pending_id',
      'active_in_review',
      'amount_reasons_json',
      'tax_year',
      'tax_unit_id',
      'amount_status',
      'amount_jpy',
      'source_ids_json',
      'account_ids_json',
      'reasons_json',
      'resolution_year',
      'resolution_decision_id',
      'resolution_reason',
    ],
    review.snapshot.pendingDecisions.map((row) => [
      row.id,
      String(review.projection.pendingDecisions.some((pending) => pending.id === row.id)),
      row.amount.status === 'unknown' ? list(row.amount.reasons) : '[]',
      row.taxYear,
      row.taxUnitId,
      row.amount.status,
      row.amount.amountJpy,
      list(row.sourceIds),
      list(row.accountIds),
      list(row.reasons),
      row.resolution?.taxYear,
      row.resolution?.decisionId,
      row.resolution?.reason,
    ]),
  )
  table(
    'unresolved',
    ['item_year', 'item_kind', 'item_id', 'amount_status', 'amount_jpy', 'reasons_json'],
    unresolved,
  )
  files.push({ name: 'README.txt', content: accountantCsvSchema })
  return files
}

export const accountantCsvSchema = `DevTax accountant transfer schema: devtax-accountant/1
Generic explanation material only; NOT a journal import for freee, Yayoi or any vendor.
Not a tax return, verified deductible expense ledger, or original-document archive.
One immutable adopted review. No live drafts/logs, re-calculation or later versions are merged.
review.csv identifies its revision, year, correction predecessor and previous-year review.
cost_year is the saved cost projection's year; historical linked years are included once.
Keys: (review_id,cost_year,source_id/basis_id/contribution_id); movement_id within review.
Sources are original charges; bases are calculation bases; allocations are destinations.
NEVER sum these tables together. Intermediate consumed allocations are not terminal costs.
annual_treatments contains conditional candidates, NOT posted expenses. balances contains
saved annual results; balance_movements contains ALL saved years, with in_review_year flag.
Transfers are one row, never two expenses. movement_links are trace detail, not extra costs.
source_adjustments are signed saved corrections/refunds, not automatically deductible.
No account names/counteraccounts/tax codes for an accounting vendor are invented.
Unknown amounts are empty with status/reasons; known zero is 0. Missing legacy sections
produce unresolved rows, not current-data reconstruction. Empty optional references mean
not recorded or not applicable; [] denotes an empty reference/reason list.
CSV: UTF-8 BOM, comma delimiter, CRLF record separators, doubled embedded quotes.
All text is double-quoted; embedded newlines are retained. Text that could start a formula
(including after Unicode whitespace/control/format marks) receives a leading apostrophe.
Apostrophe guarding intentionally changes presentation text; exact originals remain in the
saved JSON export. Do not remove guards before opening in a spreadsheet. Treat every text
column as text on import (IDs and decimal text especially); quoting alone does not prevent
spreadsheet date/number conversion. *_json cells encode arrays, not separate amounts.
Numeric cells are validated safe integer saved fields (JPY/years/revisions), unquoted;
negative numeric corrections are legitimate numbers, not untrusted formula expressions.
ZIP uses fixed flat filenames and uncompressed UTF-8 entries, deterministic timestamps.
Includes labels, reasons and free text. No automatic anonymization. Inspect preview before
saving or sharing. Structured local paths, prompts, raw receipts and observations excluded;
users can still put private information in free text. This download sends nothing externally.
For full evidence/method facts and scenarios, use the same review's JSON/Markdown alongside
this intentionally tabular subset. Never join current draft facts to this export.
`
export function accountantCsvPreview(review: BalanceReview): string {
  return accountantCsvFiles(review)
    .map((file) => '=== ' + file.name + ' ===\n' + file.content)
    .join('\n')
}
export function accountantCsvZip(review: BalanceReview): Uint8Array<ArrayBuffer> {
  return accountantZip(accountantCsvFiles(review))
}
