import type { BalanceSnapshot } from '../accounting/types.js'
import { ANNUAL_METHOD_RULE, compareAnnualMethods, type AnnualMethodFacts, type MethodYear } from './annualMethodComparison.js'

export type SoftwareBlueSpecial = {
  version: 1
  ruleVersion: '2026-09-19'
  filingType: 'blue'
  incomeCategory: 'business'
  eligibleSmallBusiness: true
  annualSpecialUsedJpy: number
  businessMonths: number
  statementReady: true
}

/** Persisted with the existing asset account, not a separate accounting ledger. */
export type SoftwareMethod = {
  version: 1
  engineVersion: 'annual-method-comparison/2'
  acquisitionMovementId: string
  acquisitionBasis: string
  method: 'straight-line' | 'immediate-expense' | 'three-year-pool' | 'blue-special'
  usedOn: string
  usefulLifeYears: 3 | 5 | null
  businessOnly: true
  ordinaryConditions: true
  rentalUse: 'none' | 'primary-business' | 'other'
  roundingConfirmed: boolean
  blueSpecial?: SoftwareBlueSpecial
  allocationPolicy: 'proportional-largest-remainder'
  evidenceIds: string[]
  evidenceBasis: string
  /** Explicitly end ordinary automation; prior records remain unchanged. */
  ordinaryThroughYear?: number
  terminationReason?: string
  reason: string
  confirmedAt: string
}
export type SoftwareExpense = {
  version: 1
  accountId: string
  year: number
  methodBasis: string
  ordinaryYearConfirmed: true
}

export function canonicalSoftwareValue(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonicalSoftwareValue).join(',') + ']'
  if (value && typeof value === 'object') return '{' + Object.entries(value)
    .filter(([, item]) => item !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, item]) => JSON.stringify(key) + ':' + canonicalSoftwareValue(item)).join(',') + '}'
  return JSON.stringify(value) ?? 'null'
}
const nonempty = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= max
function exactFields(value: unknown, fields: string[], label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).sort().join(',') !== [...fields].sort().join(','))
    throw new Error(label + 'の形式が不正です。未知の項目を削って読み取りません。')
}
function calendarDate(value: string): boolean {
  const date = new Date(value + 'T00:00:00Z')
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}
function validateBlueSpecial(value: unknown): asserts value is SoftwareBlueSpecial {
  exactFields(value, ['version','ruleVersion','filingType','incomeCategory','eligibleSmallBusiness',
    'annualSpecialUsedJpy','businessMonths','statementReady'], '青色少額資産特例の確認条件')
  if (value.version !== 1 || value.ruleVersion !== ANNUAL_METHOD_RULE.version ||
      value.filingType !== 'blue' || value.incomeCategory !== 'business' ||
      value.eligibleSmallBusiness !== true || value.statementReady !== true ||
      !Number.isSafeInteger(value.annualSpecialUsedJpy) || Number(value.annualSpecialUsedJpy) < 0 ||
      !Number.isInteger(value.businessMonths) || Number(value.businessMonths) < 1 || Number(value.businessMonths) > 12)
    throw new Error('青色少額資産特例の事業者条件・他資産使用額・事業月数・明細準備を確認してください。')
}
export function validateSoftwareMethod(value: unknown): asserts value is SoftwareMethod {
  exactFields(value, ['version','engineVersion','acquisitionMovementId','acquisitionBasis','method','usedOn',
    'usefulLifeYears','businessOnly','ordinaryConditions','rentalUse','roundingConfirmed','allocationPolicy',
    'evidenceIds','evidenceBasis','reason','confirmedAt',
    ...(value && typeof value === 'object' && 'blueSpecial' in value ? ['blueSpecial'] : []),
    ...(value && typeof value === 'object' && 'ordinaryThroughYear' in value ? ['ordinaryThroughYear'] : []),
    ...(value && typeof value === 'object' && 'terminationReason' in value ? ['terminationReason'] : []),
  ], 'ソフトウェアの方法記録')
  if (value.version !== 1 || value.engineVersion !== 'annual-method-comparison/2' ||
      !nonempty(value.acquisitionMovementId, 200) || !nonempty(value.acquisitionBasis, 524288) ||
      !['straight-line','immediate-expense','three-year-pool','blue-special'].includes(String(value.method)) ||
      typeof value.usedOn !== 'string' || !calendarDate(value.usedOn) ||
      ![null, 3, 5].includes(value.usefulLifeYears as null | number) || value.businessOnly !== true ||
      value.ordinaryConditions !== true || !['none','primary-business','other'].includes(String(value.rentalUse)) ||
      typeof value.roundingConfirmed !== 'boolean' || value.allocationPolicy !== 'proportional-largest-remainder' ||
      !Array.isArray(value.evidenceIds) || !value.evidenceIds.length || value.evidenceIds.length > 100 ||
      value.evidenceIds.some((id) => !nonempty(id, 120)) || new Set(value.evidenceIds).size !== value.evidenceIds.length ||
      !nonempty(value.evidenceBasis, 524288) || !nonempty(value.reason, 1800) || !nonempty(value.confirmedAt, 40) ||
      !/^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/.test(value.confirmedAt) ||
      !calendarDate(value.confirmedAt.slice(0, 10)) || !Number.isFinite(Date.parse(value.confirmedAt)))
    throw new Error('ソフトウェアの方法・供用日・原価・根拠を確認してください。')
  if (value.method === 'straight-line') {
    if (![3, 5].includes(value.usefulLifeYears as number) || value.blueSpecial !== undefined)
      throw new Error('定額法の耐用年数と方法固有条件を確認してください。')
  } else if (value.usefulLifeYears !== null) {
    throw new Error('定額法以外へ耐用年数を混在させません。')
  }
  if (value.method === 'blue-special') {
    validateBlueSpecial(value.blueSpecial)
    if (value.roundingConfirmed !== false)
      throw new Error('青色少額資産特例に、定額法・一括償却用の端数仮定を混在させません。')
  } else if (value.blueSpecial !== undefined) {
    throw new Error('青色少額資産特例の条件は、その方法を選んだ資産だけに保存します。')
  }
  if (value.ordinaryThroughYear !== undefined || value.terminationReason !== undefined) {
    if (!Number.isInteger(value.ordinaryThroughYear) || Number(value.ordinaryThroughYear) < Number(value.usedOn.slice(0, 4)) - 1 ||
        Number(value.ordinaryThroughYear) > 2151 || !nonempty(value.terminationReason, 1800))
      throw new Error('通常計算を終える年度と、以後の別処理の理由を確認してください。')
  }
  let evidence: unknown
  try { evidence = JSON.parse(value.evidenceBasis) } catch { throw new Error('方法の根拠記録が不正です。') }
  if (!Array.isArray(evidence) || canonicalSoftwareValue(evidence) !== value.evidenceBasis)
    throw new Error('方法の根拠記録を確認してください。')
  let basis: unknown
  try { basis = JSON.parse(value.acquisitionBasis) } catch { throw new Error('取得原価の確認元が不正です。') }
  if (!basis || typeof basis !== 'object' || Array.isArray(basis) || canonicalSoftwareValue(basis) !== value.acquisitionBasis)
    throw new Error('取得原価の確認元を正規化した形式で指定してください。')
}
export function validateSoftwareExpense(value: unknown): asserts value is SoftwareExpense {
  exactFields(value, ['version','accountId','year','methodBasis','ordinaryYearConfirmed'], 'ソフトウェア年額の記録')
  if (value.version !== 1 || !nonempty(value.accountId, 200) || !Number.isInteger(value.year) ||
      Number(value.year) < 2007 || Number(value.year) > 2151 || !nonempty(value.methodBasis, 600000) ||
      value.ordinaryYearConfirmed !== true) throw new Error('ソフトウェア年額の確認元が不正です。')
}

/** Seal only acquisition ancestry. Unrelated assets and future display horizons do not invalidate it. */
export function softwareAcquisitionBasis(snapshot: BalanceSnapshot, accountId: string, movementId: string): string {
  const account = snapshot.accounts.find((row) => row.id === accountId)
  const incoming = snapshot.movements.filter((row) => row.kind === 'transfer' ? row.toAccountId === accountId : row.kind === 'addition' && row.accountId === accountId)
  const origin = incoming[0]
  if (!account || account.kind !== 'asset' || account.opening.status !== 'known' || account.opening.amountJpy !== 0 ||
      incoming.length !== 1 || !origin || origin.id !== movementId || origin.kind !== 'transfer' ||
      !origin.balanceAllocations?.length || !Number.isSafeInteger(origin.amountJpy) || origin.amountJpy <= 0)
    throw new Error('C01でまとめた一つの取得原価と、既知の期首0の資産残高を指定してください。既存の残価から原額を推定しません。')
  const source = snapshot.accounts.find((row) => row.id === origin.fromAccountId)
  if (source?.kind !== 'construction' || source.taxUnitId !== account.taxUnitId)
    throw new Error('同じソフトウェアの制作中原価からの振替が必要です。')
  const movements = new Map<string, unknown>(), openings = new Map<string, unknown>(), visiting = new Set<string>()
  function visit(id: string) {
    if (visiting.has(id)) throw new Error('取得原価の対応が循環しています。')
    if (movements.has(id)) return
    const matches = snapshot.movements.filter((row) => row.id === id)
    const row = matches[0]
    if (matches.length !== 1 || !row || !['addition','transfer'].includes(row.kind))
      throw new Error('取得原価の対応元が欠けています。')
    visiting.add(id)
    for (const link of row.balanceAllocations ?? []) {
      if (link.sourceKind === 'movement') visit(link.sourceId)
      else {
        const opening = snapshot.accounts.find((item) => item.id === link.sourceId)
        if (!opening) throw new Error('取得原価が参照する期首がありません。')
        openings.set(opening.id, { id: opening.id, taxUnitId: opening.taxUnitId, kind: opening.kind,
          openingYear: opening.openingYear, opening: opening.opening, openingRevisionId: opening.openingRevisionId })
      }
    }
    visiting.delete(id)
    movements.set(id, row)
  }
  visit(origin.id)
  const ordered = (map: Map<string, unknown>) => [...map].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, row]) => row)
  return canonicalSoftwareValue({ version: 1, accountId, taxUnitId: account.taxUnitId,
    openingYear: account.openingYear, origin: origin.id, movements: ordered(movements), openings: ordered(openings) })
}

/** Reuse the corrected eligibility and arithmetic; no second depreciation formula. */
export function softwareMethodSchedule(snapshot: BalanceSnapshot, accountId: string, selection: SoftwareMethod, throughYear: number): MethodYear[] {
  validateSoftwareMethod(selection)
  if (softwareAcquisitionBasis(snapshot, accountId, selection.acquisitionMovementId) !== selection.acquisitionBasis)
    throw new Error('取得価額・原価内訳・確認した振替が変わっています。方法と年額を再確認してください。')
  const origin = snapshot.movements.find((row) => row.id === selection.acquisitionMovementId)!
  const acquiredYear = Number(origin.occurredOn.slice(0, 4))
  const usedYear = Number(selection.usedOn.slice(0, 4))
  const special = selection.blueSpecial
  const facts: AnnualMethodFacts = {
    assetKind: 'software', contributionIds: [origin.id], scopeBasis: '', completeCostConfirmed: true,
    businessOnly: selection.businessOnly, acquiredOn: origin.occurredOn, usedOn: selection.usedOn,
    usefulLifeYears: selection.usefulLifeYears, taxpayer: 'individual', ordinaryConditions: selection.ordinaryConditions,
    rentalUse: selection.rentalUse, throughYear: Math.max(throughYear, usedYear),
    eligibleSmallBusiness: special?.eligibleSmallBusiness ?? null,
    annualSpecialUsedJpy: special?.annualSpecialUsedJpy ?? null,
    businessMonths: special?.businessMonths ?? null,
    statementReady: special?.statementReady ?? null,
    roundingConfirmed: selection.roundingConfirmed, reason: selection.reason,
  }
  const result = compareAnnualMethods(origin.amountJpy, facts,
    special ? { filingType: special.filingType, incomeCategory: special.incomeCategory }
      : { filingType: 'undecided', incomeCategory: 'undecided' },
    accountId, acquiredYear)
  const scenario = result.scenarios.find((row) => row.method === selection.method)
  if (result.status !== 'compared' || !scenario?.years || scenario.status !== 'conditional')
    throw new Error([...result.reasons, ...(scenario?.reasons ?? [])].join(' / '))
  return scenario.years
}

/** Called by the ordinary balance validator, including HTTP saves and adoption. */
export function validateSoftwareMethodHistory(snapshot: BalanceSnapshot): void {
  for (const account of snapshot.accounts) if (account.softwareMethod !== undefined && account.softwareMethod !== null) {
    const selection = account.softwareMethod
    validateSoftwareMethod(selection)
    const expenses = snapshot.movements.filter((row) => row.kind === 'expense' && row.accountId === account.id)
    const tagged = expenses.filter((row) => row.softwareExpense).sort((a, b) => a.occurredOn < b.occurredOn ? -1 : a.occurredOn > b.occurredOn ? 1 : 0)
    const endYear = Math.max(Number(selection.usedOn.slice(0, 4)), ...tagged.map((row) => Number(row.occurredOn.slice(0, 4))))
    const schedule = softwareMethodSchedule(snapshot, account.id, selection, endYear)
    const methodBasis = softwareMethodPostingBasis(selection)
    const origin = snapshot.movements.find((row) => row.id === selection.acquisitionMovementId)!
    const remaining = new Map<string, { costYear: number; contributionId: string; remainingJpy: number }>()
    for (const link of origin.balanceAllocations ?? []) for (const lot of link.costAllocations ?? []) {
      const key = JSON.stringify([lot.costYear, lot.contributionId])
      const amount = (remaining.get(key)?.remainingJpy ?? 0) + lot.amountJpy
      if (!Number.isSafeInteger(amount)) throw new Error('取得原価内訳の合計が安全な整数を超えています。')
      remaining.set(key, { costYear: lot.costYear, contributionId: lot.contributionId, remainingJpy: amount })
    }
    const known = [...remaining.values()].reduce((sum, lot) => sum + BigInt(lot.remainingJpy), 0n)
    if (tagged.length && known !== 0n && known !== BigInt(origin.amountJpy))
      throw new Error('原価内訳のある部分と未収録部分が混在しています。通常の比例費用化に置き換えません。')
    for (const expense of tagged) {
      const proof = expense.softwareExpense!
      validateSoftwareExpense(proof)
      const year = Number(expense.occurredOn.slice(0, 4))
      const expected = schedule.find((row) => row.year === year)
      const sameYear = expenses.filter((row) => Number(row.occurredOn.slice(0, 4)) === year)
      if (proof.accountId !== account.id || proof.year !== year ||
          (selection.ordinaryThroughYear !== undefined && year > selection.ordinaryThroughYear) || proof.methodBasis !== methodBasis ||
          proof.ordinaryYearConfirmed !== true || expense.occurredOn !== `${year}-12-31` ||
          !expected || expected.expenseJpy <= 0 || expense.amountJpy !== expected.expenseJpy || sameYear.length !== 1)
        throw new Error('方法から作った年額と費用化記録が一致しません。変更・二重計上を確認してください。')
      const usedLots = remaining.size ? allocateSoftwareExpense(expected.expenseJpy, [...remaining.values()]) : []
      const expectedLink = { sourceKind: 'movement', sourceId: origin.id, amountJpy: expected.expenseJpy, costAllocations: usedLots }
      const actualLinks = (expense.balanceAllocations ?? []).map((link) => ({ ...link, costAllocations: link.costAllocations ?? [] }))
      if (canonicalSoftwareValue(actualLinks) !== canonicalSoftwareValue([expectedLink]))
        throw new Error('記録した配分方法と費用化の原価内訳が一致しません。元の年額案を再確認してください。')
      for (const lot of usedLots) remaining.get(JSON.stringify([lot.costYear, lot.contributionId]))!.remainingJpy -= lot.amountJpy

      for (const prior of schedule.filter((row) => row.year < year && row.expenseJpy > 0)) {
        const rows = expenses.filter((row) => Number(row.occurredOn.slice(0, 4)) === prior.year)
        if (rows.length !== 1 || !rows[0]!.softwareExpense || rows[0]!.amountJpy !== prior.expenseJpy ||
            rows[0]!.softwareExpense!.methodBasis !== methodBasis)
          throw new Error(`${prior.year}年の方法に基づく費用化が未記録または変更されています。過去実績を推定して翌年へ進みません。`)
      }
    }
  }
  for (const row of snapshot.movements) if (row.softwareExpense !== undefined) {
    validateSoftwareExpense(row.softwareExpense)
    if (row.kind !== 'expense' || row.accountId !== row.softwareExpense.accountId ||
        !snapshot.accounts.find((a) => a.id === row.accountId)?.softwareMethod)
      throw new Error('年額記録に対応するソフトウェアの方法がありません。確認元だけを削除できません。')
  }
}

/** End-date control does not retrospectively change the method used by prior years. */
export function softwareMethodPostingBasis(selection: SoftwareMethod): string {
  // The full acquisition and evidence records live once on the account. Do not
  // duplicate potentially large ancestry snapshots in every annual posting.
  // Ancestry is rechecked by softwareMethodSchedule, evidence at adoption, and
  // historical account selections by the existing previous-year comparison.
  const { ordinaryThroughYear: _end, terminationReason: _reason,
    acquisitionBasis: _ancestry, evidenceBasis: _evidence, ...used } = selection
  return canonicalSoftwareValue(used)
}

/** Future-only termination does not alter an already closed ordinary year. */
export function softwareMethodHistoryValue(selection: SoftwareMethod | null, year: number): SoftwareMethod | null {
  if (!selection || selection.ordinaryThroughYear === undefined || selection.ordinaryThroughYear < year) return selection
  const { ordinaryThroughYear: _end, terminationReason: _reason, ...historical } = selection
  return historical
}

export function softwareEvidenceBasis(evidence: readonly { id: string; localReference?: string }[], ids: readonly string[]): string {
  return canonicalSoftwareValue([...ids].sort().map((id) => {
    const matches = evidence.filter((row) => row.id === id)
    if (matches.length !== 1) throw new Error('方法の根拠を一意に確認できません。')
    const { localReference: _private, ...record } = matches[0]!
    return record
  }))
}

/** Reuse the existing annual-adoption boundary, not a new approval workflow. */
export function softwareMethodAdoptionIssues(
  snapshot: BalanceSnapshot, year: number,
  planning?: { evidence: readonly { id: string; localReference?: string }[];
    lifecycleEvents?: readonly { taxUnitId: string; eventType: string; occurredOn: string }[];
    profile?: { filingType: string; incomeCategory: string } },
): { accountId: string; message: string }[] {
  const issues: { accountId: string; message: string }[] = []
  for (const account of snapshot.accounts) {
    const selection = account.softwareMethod
    if (!selection || Number(selection.usedOn.slice(0, 4)) > year ||
        (selection.ordinaryThroughYear !== undefined && year > selection.ordinaryThroughYear)) continue
    try {
      if (selection.blueSpecial && planning?.profile &&
          (planning.profile.filingType !== selection.blueSpecial.filingType ||
           planning.profile.incomeCategory !== selection.blueSpecial.incomeCategory))
        throw new Error('青色申告・所得区分が方法確認時から変わっています。')
      if (planning?.lifecycleEvents?.some((event) => event.taxUnitId === account.taxUnitId &&
          ['retired','abandoned'].includes(event.eventType) && event.occurredOn <= `${year}-12-31`))
        throw new Error('終了・中止の記録があります。通常計算の年額と別の処理を確認してください。')
      if (planning && softwareEvidenceBasis(planning.evidence, selection.evidenceIds) !== selection.evidenceBasis)
        throw new Error('方法の根拠が確認時から変わっています。')
      const expected = softwareMethodSchedule(snapshot, account.id, selection, year).find((row) => row.year === year)!
      const entries = snapshot.movements.filter((row) => row.kind === 'expense' && row.accountId === account.id && row.occurredOn.startsWith(year + '-'))
      if (expected.expenseJpy === 0 ? entries.length !== 0 : entries.length !== 1 ||
          !entries[0]!.softwareExpense || entries[0]!.amountJpy !== expected.expenseJpy)
        throw new Error('選択した方法の年額を、既存の費用化入力へ反映して確認してください。')
    } catch (error) { issues.push({ accountId: account.id, message: account.name + ': ' + (error instanceof Error ? error.message : '方法の確認が必要です。') }) }
  }
  return issues
}

/** The user chooses this policy; known cost lots are never implicitly FIFO'd. */
export function allocateSoftwareExpense(amount: number, lots: readonly { costYear: number; contributionId: string; remainingJpy: number | null }[]) {
  if (!Number.isSafeInteger(amount) || amount < 0 || !lots.length || lots.some((lot) =>
    lot.remainingJpy === null || !Number.isSafeInteger(lot.remainingJpy) || lot.remainingJpy < 0))
    throw new Error('費用化額と残っている原価内訳を確認してください。')
  const ids = lots.map((lot) => JSON.stringify([lot.costYear, lot.contributionId]))
  if (new Set(ids).size !== ids.length) throw new Error('同じ原価が重複しています。')
  const total = lots.reduce((sum, lot) => sum + BigInt(lot.remainingJpy!), 0n)
  if (total === 0n || BigInt(amount) > total) throw new Error('原価の残額を超えて費用化できません。')
  const allocated = lots.map((lot, index) => ({
    ...lot, key: ids[index]!, amount: BigInt(amount) * BigInt(lot.remainingJpy!) / total,
    remainder: BigInt(amount) * BigInt(lot.remainingJpy!) % total,
  }))
  let rest = BigInt(amount) - allocated.reduce((sum, row) => sum + row.amount, 0n)
  allocated.sort((a, b) => a.remainder === b.remainder ? a.key < b.key ? -1 : a.key > b.key ? 1 : a.remainder > b.remainder ? -1 : 1)
  for (const row of allocated) if (rest > 0n) { row.amount++; rest-- }
  if (rest !== 0n) throw new Error('原価への費用化配分が一致しません。')
  return allocated.filter((row) => row.amount > 0n).sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
    .map((row) => ({ costYear: row.costYear, contributionId: row.contributionId, amountJpy: Number(row.amount) }))
}
