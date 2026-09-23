import type { AnnualCostProjection } from '../accounting/costs.js'
import type {
  BalanceCostAllocation,
  BalanceMovement,
  BalanceSnapshot,
} from '../accounting/types.js'
import type { PlanningSnapshot } from '../planning/types.js'
import { validateBalanceSnapshot } from './annualBalances.js'
import { checkBalanceFlowLinks } from './balanceFlowLinks.js'
import { traceBalanceLots, type BalanceLotTrace } from './balanceLotTrace.js'
import { decisionIsConfirmed } from './decisionConfirmation.js'

export type BalanceUseInput = {
  requestId: string
  sourceKind: 'opening' | 'movement'
  sourceId: string
  kind: 'expense' | 'reduction' | 'transfer'
  occurredOn: string
  /** Omission selects the remaining amount, never zero or an unknown amount. */
  amountJpy?: number
  toAccountId?: string
  decisionId: string
  reason: string
  evidenceIds?: string[]
  /** Required when a partial use would otherwise choose between different lots. */
  costAllocations?: BalanceCostAllocation[]
}

export type BalanceUseSource = BalanceLotTrace['remaining'][number] & {
  name: string
  availableOn: string
  sourceIds: string[]
}

function dateYear(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('移動日を確認してください。')
  const parsed = new Date(`${value}T00:00:00.000Z`)
  const year = Number(value.slice(0, 4))
  if (
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value ||
    year < 1900 ||
    year > 9999
  )
    throw new Error('移動日は実在する1900年から9999年の年月日で指定してください。')
  return year
}

function positiveAmount(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new Error('使用額は1円以上の安全な整数円で指定してください。')
  return value
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, item]) => JSON.stringify(key) + ':' + canonical(item))
        .join(',') +
      '}'
    )
  return JSON.stringify(value) ?? 'null'
}

/** Reserve already entered future uses as well; do not overbook tomorrow's remainder. */
export function balanceUseSources(
  snapshot: BalanceSnapshot,
  costs: AnnualCostProjection[],
  occurredOn: string,
): BalanceUseSource[] {
  const year = dateYear(occurredOn)
  const lastYear = Math.max(year, ...snapshot.movements.map((row) => dateYear(row.occurredOn)))
  const flow = checkBalanceFlowLinks(snapshot, lastYear)
  const unresolvedAccounts = new Set(
    flow.uses
      .filter((row) => row.unlinkedJpy > 0)
      .map((row) => {
        const movement = snapshot.movements.find((item) => item.id === row.movementId)!
        return movement.kind === 'transfer' ? movement.fromAccountId : movement.accountId
      }),
  )
  const trace = traceBalanceLots(snapshot, costs, lastYear)
  if (trace.status === 'invalid')
    throw new Error('既存の原価対応に不整合があります。根拠と重複使用を先に確認してください。')
  return trace.remaining.flatMap((row) => {
    const account = snapshot.accounts.find((item) => item.id === row.accountId)!
    const movement =
      row.sourceKind === 'movement'
        ? snapshot.movements.find((item) => item.id === row.sourceId)
        : undefined
    const availableOn = movement?.occurredOn ?? `${account.openingYear}-01-01`
    if (availableOn > occurredOn || row.amountJpy === 0) return []
    // An external opening is an existing question/evidence record, not a second addition.
    const openingEvidence = snapshot.pendingDecisions
      .filter(
        (item) =>
          item.id.startsWith('external-opening:') &&
          item.accountIds.length === 1 &&
          item.accountIds[0] === account.id,
      )
      .flatMap((item) => item.sourceIds)
    return [
      {
        ...row,
        ...(unresolvedAccounts.has(account.id) ? { amountJpy: null, untracedJpy: null } : {}),
        name: account.name,
        availableOn,
        sourceIds: [...new Set(movement?.sourceIds ?? openingEvidence)].sort(),
      },
    ]
  })
}

function selectLots(
  source: BalanceUseSource,
  amount: number,
  selected?: BalanceCostAllocation[],
): BalanceCostAllocation[] | undefined {
  if (source.amountJpy === null)
    throw new Error('不明な残高から使用額を生成できません。0円として扱っていません。')
  const known = source.lots.filter((lot) => lot.remainingJpy !== 0)
  if (selected !== undefined) {
    if (selected.length > 100) throw new Error('原価内訳は100件までです。')
    const ids = new Set<string>()
    let total = 0n
    for (const lot of selected) {
      positiveAmount(lot.amountJpy)
      const id = JSON.stringify([lot.costYear, lot.contributionId])
      if (ids.has(id)) throw new Error('同じ原価を重複指定できません。')
      ids.add(id)
      const original = known.find(
        (item) => item.costYear === lot.costYear && item.contributionId === lot.contributionId,
      )
      if (!original || original.remainingJpy === null || lot.amountJpy > original.remainingJpy)
        throw new Error('原価の使用額を確認できないか、未使用額を超えています。')
      total += BigInt(lot.amountJpy)
    }
    if (total !== BigInt(amount))
      throw new Error('選択した原価内訳の合計と使用額を一致させてください。')
    return structuredClone(selected).sort(
      (a, b) =>
        a.costYear - b.costYear ||
        (a.contributionId < b.contributionId ? -1 : a.contributionId > b.contributionId ? 1 : 0),
    )
  }
  if (!known.length) {
    // Known external opening with no reconstructed cost lots stays untraced.
    // Do not manufacture a link to an unrelated current-year cost.
    return undefined
  }
  if (source.untracedJpy !== 0 || known.some((lot) => lot.remainingJpy === null))
    throw new Error('原価未確認分を含みます。使用する原価内訳を確認してから指定してください。')
  if (amount === source.amountJpy)
    return known.map((lot) => ({
      costYear: lot.costYear,
      contributionId: lot.contributionId,
      amountJpy: lot.remainingJpy!,
    }))
  if (known.length === 1)
    return [
      { costYear: known[0]!.costYear, contributionId: known[0]!.contributionId, amountJpy: amount },
    ]
  throw new Error(
    '複数の原価から一部を使用します。先入先出や比例配分は自動選択しません。使用する内訳を指定してください。',
  )
}

/** Creates one ordinary draft movement. It neither saves nor adopts a tax treatment. */
export function draftBalanceUse(
  snapshot: BalanceSnapshot,
  planning: PlanningSnapshot,
  costs: AnnualCostProjection[],
  input: BalanceUseInput,
): BalanceSnapshot {
  validateBalanceSnapshot(snapshot)
  const year = dateYear(input.occurredOn)
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.requestId))
    throw new Error('入力要求IDを確認してください。')
  if (!['expense', 'reduction', 'transfer'].includes(input.kind))
    throw new Error('費用化・その他減少・振替から選択してください。')
  if (!['opening', 'movement'].includes(input.sourceKind))
    throw new Error('対応元の種類を確認してください。')
  if (!input.reason.trim() || input.reason.length > 2000)
    throw new Error('2000文字以内の判断理由を入力してください。')
  if (input.kind !== 'transfer' && input.toAccountId !== undefined)
    throw new Error('振替以外には受入先を指定できません。')
  const movementId = `balance-use:${input.requestId}`
  const previous = snapshot.movements.find((row) => row.id === movementId)
  if (previous) {
    const link = previous.balanceAllocations?.[0]
    const lots = (rows: BalanceCostAllocation[]) =>
      rows
        .slice()
        .sort(
          (a, b) =>
            a.costYear - b.costYear ||
            (a.contributionId < b.contributionId
              ? -1
              : a.contributionId > b.contributionId
                ? 1
                : 0),
        )
    if (
      previous.kind !== input.kind ||
      previous.occurredOn !== input.occurredOn ||
      previous.decisionId !== input.decisionId ||
      previous.reason !== input.reason.trim() ||
      previous.amountJpy !== (input.amountJpy ?? previous.amountJpy) ||
      previous.balanceAllocations?.length !== 1 ||
      link?.sourceKind !== input.sourceKind ||
      link?.sourceId !== input.sourceId ||
      (previous.kind === 'transfer' && previous.toAccountId !== input.toAccountId) ||
      (input.evidenceIds ?? []).some((id) => !previous.sourceIds.includes(id)) ||
      (input.costAllocations !== undefined &&
        canonical(lots(input.costAllocations)) !== canonical(lots(link?.costAllocations ?? [])))
    )
      throw new Error('同じ入力要求IDで内容を変更できません。')
    // A replay does not remove its original posting: downstream transfers may
    // already refer to it. Return the original history without another write.
    return structuredClone(snapshot)
  }
  const source = balanceUseSources(snapshot, costs, input.occurredOn).find(
    (row) => row.sourceKind === input.sourceKind && row.sourceId === input.sourceId,
  )
  if (!source)
    throw new Error(
      '移動日までに使える対応元がありません。使用済み・将来の記録を確認してください。',
    )
  if (source.amountJpy === null) throw new Error('残高が不明なため使用額を生成できません。')
  const amount = positiveAmount(input.amountJpy ?? source.amountJpy)
  if (amount > source.amountJpy)
    throw new Error('入力済みの後年度の使用分も含めると、残額を超えています。')
  const from = snapshot.accounts.find((row) => row.id === source.accountId)!
  const to =
    input.kind === 'transfer' ? snapshot.accounts.find((row) => row.id === input.toAccountId) : from
  if (!to || to.openingYear > year) throw new Error('振替先の残高と記録開始年を確認してください。')
  if (input.kind === 'transfer' && from.id === to.id)
    throw new Error('同じ残高へ振り替えることはできません。')
  const decision = planning.decisions.find((row) => row.id === input.decisionId)
  if (
    !decision ||
    !decisionIsConfirmed(decision) ||
    decision.taxYear !== year ||
    decision.taxUnitId !== to.taxUnitId
  )
    throw new Error('対象年・受入側制作物に対応する確認済みの判断を選んでください。')
  const unit = planning.taxUnits.find((row) => row.id === to.taxUnitId)
  if (!unit || !planning.taxUnits.some((row) => row.id === from.taxUnitId))
    throw new Error('対応する制作物が現在の計画にありません。')
  if (
    from.taxUnitId !== to.taxUnitId &&
    (input.kind !== 'transfer' || unit.predecessorId !== from.taxUnitId)
  )
    throw new Error('異なる制作物への振替には、受入側の前身・後継関係が必要です。')
  const evidence = input.evidenceIds ?? []
  if (evidence.some((id) => !planning.evidence.some((row) => row.id === id)))
    throw new Error('追加の根拠資料が登録されていません。')
  const sourceIds = [...new Set([...source.sourceIds, ...evidence])].sort()
  if (!sourceIds.length || sourceIds.length > 100)
    throw new Error('対応元の費用・期首に結び付く根拠を1件以上100件以内で選択してください。')
  const lots = selectLots(source, amount, input.costAllocations)
  if (lots && lots.length > 100)
    throw new Error('一回の原価内訳は100件までです。対応元ごとに確認してください。')
  if (snapshot.movements.length >= 10_000)
    throw new Error('残高移動の保存上限10000件に達しています。')
  const shared = {
    id: movementId,
    occurredOn: input.occurredOn,
    amountJpy: amount,
    sourceIds,
    decisionId: input.decisionId,
    reason: input.reason.trim(),
    balanceAllocations: [
      {
        sourceKind: input.sourceKind,
        sourceId: input.sourceId,
        amountJpy: amount,
        ...(lots === undefined ? {} : { costAllocations: lots }),
      },
    ],
  }
  const movement: BalanceMovement =
    input.kind === 'transfer'
      ? { ...shared, kind: 'transfer', fromAccountId: from.id, toAccountId: to.id }
      : { ...shared, kind: input.kind, accountId: from.id }
  const next = structuredClone(snapshot)
  next.movements.push(movement)
  validateBalanceSnapshot(next)
  const lastYear = Math.max(year, ...next.movements.map((row) => dateYear(row.occurredOn)))
  const trace = traceBalanceLots(next, costs, lastYear)
  if (trace.status === 'invalid')
    throw new Error('原価の対応元・残額・二重使用に不整合があるため、入力へ反映していません。')
  return next
}
