import { attachCostTreatments } from './costTreatments.js'
import { createSourceAdjuster, adjustSubscriptionScope } from './adjustedCostSources.js'
import { allocateBusinessTargets } from './businessAllocation.js'
import type {
  CostBasis,
  CostPeriod,
  CostSnapshot,
  CostTarget,
  ExpenseSource,
} from '../accounting/costs.js'
import type { PlanningSnapshot } from '../planning/types.js'
import type { MonthlyAllocationResult } from './types.js'
import { projectAnnualCosts } from './costProjection.js'
import { inspectEquipmentAnnualCalculation } from './equipmentAnnualCalculation.js'
import { allocateEquipmentBusiness } from './equipmentBusinessAllocation.js'
import { validIsoCalendarDate } from './chargePeriods.js'

export type SubscriptionCostScope = {
  source: ExpenseSource
  basisId: string
  period: CostPeriod
  result: MonthlyAllocationResult | null
  targets: Record<string, CostTarget>
  sourceWarnings?: string[]
  basisUnknownReasons?: string[]
}

export function calendarMonthPeriod(month: string): CostPeriod {
  const [year, monthNumber] = month.split('-').map(Number)
  if (
    !Number.isInteger(year) ||
    year < 1900 ||
    year > 9999 ||
    !Number.isInteger(monthNumber) ||
    monthNumber < 1 ||
    monthNumber > 12
  )
    throw new Error('対象月を確認してください。')
  const end = new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0, 10)
  return { startedOn: `${month}-01`, endedOn: end }
}

function ratio(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 1)
    throw new Error('割合は0から1の範囲で指定してください。')
  return value
}

/** Normalize legacy inputs explicitly; none of the old tax estimates are silently adopted. */
export function buildWorkspaceCostSnapshot(
  planning: PlanningSnapshot,
  subscriptions: SubscriptionCostScope[],
): CostSnapshot {
  const year = planning.profile.taxYear
  const adjustSource = createSourceAdjuster(planning.sourceAdjustments ?? [], new Set(planning.evidence.map((row) => row.id)), year)
  const snapshot: CostSnapshot = {
    version: 1,
    taxUnits: planning.taxUnits.map((unit) => ({ id: unit.id, name: unit.name })),
    sources: [],
    bases: [],
    contributions: [],
  }
  const sourceMap = new Map<string, ExpenseSource>()
  const contributionCounts = new Map<string, number>()
  const addSource = (source: ExpenseSource) => {
    const old = sourceMap.get(source.id)
    if (old && JSON.stringify(old) !== JSON.stringify(source))
      throw new Error('同じ費用源の原額・期間が一致しません。')
    if (!old) {
      snapshot.sources.push(source)
      sourceMap.set(source.id, source)
    }
  }
  function addContribution(
    basis: CostBasis,
    target: CostTarget,
    amountJpy: number,
    reason: string,
    evidenceIds: string[] = [],
  ) {
    if (amountJpy === 0) return
    const index = contributionCounts.get(basis.id) ?? 0
    contributionCounts.set(basis.id, index + 1)
    snapshot.contributions.push({
      id: `${basis.id}:contribution:${index}`,
      basisId: basis.id,
      target,
      amountJpy,
      reason,
      evidenceIds,
    })
  }
  function rootBasis(
    source: ExpenseSource,
    period: CostPeriod,
    method: CostBasis['method'],
    amountJpy: number | null,
    warnings: string[] = [],
  ): CostBasis {
    const adjusted = adjustSource(source)
    source = adjusted.source
    if (source.adjustments?.length) {
      if (source.kind === 'home' || source.kind === 'direct') amountJpy = adjusted.evaluation.costAmountJpy
      else if (adjusted.evaluation.costAmountJpy === null) amountJpy = null
      warnings = [...new Set([...warnings, ...adjusted.evaluation.reasons, ...adjusted.evaluation.rows.flatMap((row) => row.reasons)])]
      method = { ...method, explanation: method.explanation + ` 原額 ${source.originalAmountJpy ?? '不明'}円を保持。返金・訂正後の元費用基礎 ${adjusted.evaluation.costAmountJpy ?? '未算定'}円。` }
    }
    addSource(source)
    const basis: CostBasis = {
      id: `${source.id}:basis:${period.startedOn}:${period.endedOn}`,
      sourceId: source.id,
      parentContributionIds: [],
      affectedTaxUnitIds: [],
      period,
      amount:
        amountJpy === null
          ? {
              status: 'unknown',
              amountJpy: null,
              reasons: adjusted.evaluation.reasons.length ? adjusted.evaluation.reasons : source.unknownOriginalAmountReasons ?? ['原額が未確認です。'],
            }
          : { status: 'known', amountJpy },
      method,
      warnings,
    }
    snapshot.bases.push(basis)
    return basis
  }
  for (const originalScope of subscriptions) {
    const scope = adjustSubscriptionScope(originalScope, adjustSource)
    addSource(scope.source)
    const basis: CostBasis = {
      id: scope.basisId,
      sourceId: scope.source.id,
      parentContributionIds: [],
      affectedTaxUnitIds: [],
      period: scope.period,
      amount: scope.result
        ? { status: 'known', amountJpy: scope.result.monthlyFeeJpy }
        : {
            status: 'unknown',
            amountJpy: null,
            reasons: scope.basisUnknownReasons ?? scope.source.unknownOriginalAmountReasons ?? ['請求額が未確認です。'],
          },
      method: {
        id: 'subscription-period-allocation',
        version: '1',
        explanation:
          '請求の利用期間を暦月に分け、同じ請求・月の利用量をAIサービスごとに重み付けして配分します。履歴の日付の精度と取得範囲を確認してください。',
      },
      warnings: [
        ...(scope.result?.warnings ?? []),
        ...(scope.sourceWarnings ?? []),
        ...scope.source.evidenceIds
          .filter((id) => !planning.evidence.some((row) => row.id === id))
          .map((id) => `請求の証拠参照が現在の記録にありません：${id}`),
        ...(scope.source.origin === 'legacy-monthly'
          ? ['旧月額設定から生成した原額です。実請求・契約との対応を確認してください。']
          : []),
      ],
    }
    snapshot.bases.push(basis)
    if (!scope.result) {
      basis.affectedTaxUnitIds = [
        ...new Set(
          Object.values(scope.targets).flatMap((target) =>
            target.kind === 'tax-unit' ? [target.taxUnitId] : [],
          ),
        ),
      ]
      continue
    }
    if (scope.result.status === 'pending') {
      addContribution(
        basis,
        { kind: 'unallocated' },
        scope.result.pendingAmountJpy,
        scope.result.warnings.join(' '),
        scope.source.evidenceIds,
      )
    } else {
      for (const line of scope.result.lines) {
        const target: CostTarget =
          line.kind === 'unobserved'
            ? { kind: 'unobserved' }
            : line.kind === 'rounding-adjustment'
              ? { kind: 'rounding' }
              : line.sourceId && scope.targets[line.sourceId]
                ? scope.targets[line.sourceId]
                : { kind: 'unallocated' }
        addContribution(
          basis,
          target,
          line.allocatedAmountJpy,
          line.kind === 'rounding-adjustment'
            ? '1円未満の切捨て差額。'
            : '請求・月内の配分結果。処理方法や資産計上の採用を意味しません。',
          scope.source.evidenceIds,
        )
      }
    }
  }
  for (const item of planning.equipment.filter(
    (item) => !validIsoCalendarDate(item.acquiredOn) || item.acquiredOn <= `${year}-12-31`,
  )) {
    const selectedMethod = planning.equipmentMethods?.find(
      (row) => row.equipmentId === item.id && row.taxYear === year,
    )
    const equipmentTaxUnitId =
      selectedMethod?.allocation?.taxUnitId === undefined
        ? item.taxUnitId
        : selectedMethod.allocation.taxUnitId
    const equipmentTargetIds =
      selectedMethod?.allocation?.targets?.map((target) => target.taxUnitId) ??
      (equipmentTaxUnitId ? [equipmentTaxUnitId] : [])
    const source: ExpenseSource = {
      id: `equipment:${item.id}`,
      kind: 'equipment',
      label: item.name,
      originalAmountJpy: item.acquisitionCostJpy,
      ...(item.acquisitionCostJpy === null
        ? { unknownOriginalAmountReasons: [item.unknownAmountReason ?? '購入額が未確認です。'] }
        : {}),
      currency: 'JPY',
      ...(validIsoCalendarDate(item.acquiredOn) ? { acquiredOn: item.acquiredOn } : {}),
      evidenceIds: [...item.evidenceIds],
      origin: 'legacy-planning',
    }
    const basis = rootBasis(
      source,
      { startedOn: `${year}-01-01`, endedOn: `${year}-12-31` },
      {
        id: 'equipment-method-required',
        version: '1',
        explanation:
          '取得額と当年の費用基礎を分離。採用する方法・適用条件・開始日・前年残高を接続して算定する。',
      },
      0,
    )
    if (basis.amount.status === 'unknown' && sourceMap.get(source.id)?.adjustments?.length) {
      basis.affectedTaxUnitIds = equipmentTargetIds
      continue
    }
    const dateProblems = [
      ...(!validIsoCalendarDate(item.acquiredOn) ? ['取得日が実在する年月日ではありません。'] : []),
      ...(item.businessUseStartedOn !== undefined &&
      !validIsoCalendarDate(item.businessUseStartedOn)
        ? ['業務利用開始日が実在する年月日ではありません。']
        : []),
    ]
    if (dateProblems.length) {
      basis.amount = { status: 'unknown', amountJpy: null, reasons: dateProblems }
      basis.warnings = [...dateProblems]
      basis.affectedTaxUnitIds = equipmentTargetIds
      continue
    }

    if (selectedMethod) {
      const { allocation } = selectedMethod
      const inspected = inspectEquipmentAnnualCalculation(item, selectedMethod)
      const calculation = inspected.result
      if (!calculation) {
        basis.amount = { status: 'unknown', amountJpy: null, reasons: inspected.inputIssues }
        basis.affectedTaxUnitIds = equipmentTargetIds
        continue
      }
      basis.method = {
        id: calculation.engineVersion,
        version: '1',
        explanation: calculation.calculation?.explanation ?? calculation.reasons.join(' / '),
      }
      basis.warnings = [
        ...basis.warnings,
        ...calculation.reasons,
        ...(item.evidenceIds.length ? [] : ['設備の証拠参照が未登録です。']),
        ...(selectedMethod.priorClosing
          ? ['入力した前年末残高の参照先・採用版との一致は未検証です。']
          : []),
      ]
      basis.affectedTaxUnitIds = equipmentTargetIds
      if (!calculation.calculation) {
        basis.amount = { status: 'unknown', amountJpy: null, reasons: calculation.reasons }
        continue
      }
      const annual = calculation.calculation.depreciationJpy
      basis.amount = { status: 'known', amountJpy: annual }
      const businessRatio = allocation ? allocation.businessUseRatio : item.businessUseRatio
      const projectRatio = allocation
        ? allocation.projectAllocationRatio
        : item.projectAllocationRatio
      if (!allocation)
        basis.warnings.push('年度別の配分条件は未登録です。旧設備の共通割合を使用しています。')
      if (allocation && allocation.targets === undefined && allocation.taxUnitId === undefined)
        basis.warnings.push(
          '年度別の制作物対応先は未登録です。旧設備の共通対応先を使用しています。',
        )
      if (!equipmentTaxUnitId && allocation?.targets === undefined)
        basis.warnings.push(
          'この年度の制作物対応先が未確認のため、業務分を未配分として保持します。',
        )
      if (allocation && (businessRatio === null || !allocation.reason.trim())) {
        const reason =
          '年度別の業務割合または配分根拠が未確認のため、設備年額全体を配分未算定として保持します。'
        basis.warnings.push(reason)
        addContribution(basis, { kind: 'unallocated' }, annual, reason, item.evidenceIds)
        continue
      }
      const business = Math.round(annual * ratio(businessRatio!))
      if (allocation?.targets) {
        const explanation = `設備年額 ${annual}円 × 年度別業務割合 ${businessRatio} を四捨五入して業務額 ${business}円。制作物割合は0.01%単位、未配分を含め円未満を切捨て後、残余の大きい順（同値は対象ID順）に1円を配分。根拠：${allocation.reason}`
        basis.method.explanation +=
          ' ' +
          explanation +
          ' 配分指定：' +
          allocation.targets
            .slice()
            .sort((a, b) => (a.taxUnitId < b.taxUnitId ? -1 : a.taxUnitId > b.taxUnitId ? 1 : 0))
            .map(
              (target) =>
                `${target.taxUnitId} ${target.shareBps === null ? '未確認' : target.shareBps / 100 + '%'}`,
            )
            .join(' / ')
        basis.affectedTaxUnitIds = allocation.targets.map((target) => target.taxUnitId)
        basis.warnings = basis.warnings.filter(
          (warning) =>
            !warning.includes('旧設備の共通対応先') &&
            !warning.includes('この年度の制作物対応先が未確認'),
        )
        if (allocation.targets.some((target) => target.shareBps === null))
          basis.warnings.push('未確認の制作物割合は配分せず、残額を未配分に保持しています。')
        addContribution(
          basis,
          { kind: 'private' },
          annual - business,
          explanation,
          item.evidenceIds,
        )
        for (const target of allocateEquipmentBusiness(business, allocation.targets))
          addContribution(
            basis,
            target.taxUnitId
              ? { kind: 'tax-unit', taxUnitId: target.taxUnitId }
              : { kind: 'unallocated' },
            target.amountJpy,
            explanation,
            item.evidenceIds,
          )
        continue
      }
      const allocated =
        equipmentTaxUnitId && projectRatio !== null ? Math.round(business * ratio(projectRatio)) : 0
      if (projectRatio === null)
        basis.warnings.push('年度別の制作物割合が未確認のため、業務分を未配分として保持します。')
      const annualLabel = calculation.engineVersion === 'jp-individual-small-equipment/1'
        ? '少額設備の供用年費用基礎' : '普通償却額'
      const reason = `設備全体の${annualLabel} ${annual}円 × 業務割合 ${businessRatio} を円単位で四捨五入して業務額 ${business}円。${allocation ? ` ${year}年の配分根拠：${allocation.reason}` : ''}`
      basis.method.explanation += ` ${reason}`
      addContribution(
        basis,
        { kind: 'private' },
        annual - business,
        `${reason} 私用分 ${annual - business}円。`,
        item.evidenceIds,
      )
      if (equipmentTaxUnitId)
        addContribution(
          basis,
          { kind: 'tax-unit', taxUnitId: equipmentTaxUnitId },
          allocated,
          `${reason} 業務額 × 制作物割合 ${projectRatio} を円単位で四捨五入して対応額 ${allocated}円。`,
          item.evidenceIds,
        )
      addContribution(
        basis,
        { kind: 'unallocated' },
        business - allocated,
        `${reason} 業務額から制作物対応額を除いた未配分 ${business - allocated}円。`,
        item.evidenceIds,
      )
      continue
    }
    const reasons = [
      ...(source.unknownOriginalAmountReasons ?? []),
      'この版では設備の年額をまだ計算できません。方法・適用条件・前年残高の確認が必要です。取得額を当年費用の代用にしていません。',
    ]
    if (!item.businessUseStartedOn) reasons.push('業務利用開始日が未確認です。取得日で補いません。')
    if (!item.usefulLifeYears) reasons.push('耐用年数・方法が未確認です。')
    if (item.convertedFromPrivate && item.openingUnamortizedBalanceJpy === undefined)
      reasons.push('私用から転用した時点の未償却残高が未確認です。')
    basis.amount = { status: 'unknown', amountJpy: null, reasons }
    basis.affectedTaxUnitIds = equipmentTaxUnitId ? [equipmentTaxUnitId] : []
  }
  for (const item of planning.homeCosts.filter((item) => item.month.startsWith(`${year}-`))) {
    const period = calendarMonthPeriod(item.month)
    const source: ExpenseSource = {
      id: `home:${item.id}`,
      kind: 'home',
      label: `${item.month} ${{ rent: '家賃', electricity: '電気', internet: '通信' }[item.category]}`,
      originalAmountJpy: item.amountJpy,
      ...(item.amountJpy === null
        ? { unknownOriginalAmountReasons: [item.unknownAmountReason ?? '支払額が未確認です。'] }
        : {}),
      currency: 'JPY',
      servicePeriod: period,
      evidenceIds: [...item.evidenceIds],
      origin: 'legacy-planning',
    }
    const basis = rootBasis(
      source,
      period,
      {
        id: `home-${item.method}`,
        version: '1',
        explanation:
          item.basis.trim() && item.rationale.trim()
            ? `${item.basis} / ${item.rationale}`
            : '按分の基準と採用理由の確認待ち。',
      },
      item.amountJpy,
      item.evidenceIds.length ? [] : ['請求または按分の証拠が未登録です。'],
    )
    const costAmountJpy = basis.amount.status === 'known' ? basis.amount.amountJpy : null
    if (costAmountJpy === null) {
      basis.affectedTaxUnitIds =
        item.targets !== undefined
          ? item.targets.map((target) => target.taxUnitId)
          : item.taxUnitId
            ? [item.taxUnitId]
            : []
      continue
    }
    if (!item.basis.trim() || !item.rationale.trim()) {
      addContribution(
        basis,
        { kind: 'unallocated' },
        costAmountJpy,
        '業務割合の計算根拠が不足しているため、私用額も推定せず配分を保留。',
        item.evidenceIds,
      )
      continue
    }
    const business = Math.round(costAmountJpy * ratio(item.businessUseRatio))
    const amountLabel = sourceMap.get(source.id)?.adjustments?.length ? '訂正後の費用基礎' : '支払額'
    const businessCalculation = `${amountLabel} ${costAmountJpy}円 × 業務割合 ${item.businessUseRatio} を円単位で四捨五入して、業務額 ${business}円（割合1は100%）。`
    basis.method.explanation += ` ${businessCalculation}`
    addContribution(
      basis,
      { kind: 'private' },
      costAmountJpy - business,
      `${businessCalculation} 私用分は${amountLabel} ${costAmountJpy}円 − 業務額 ${business}円 = ${costAmountJpy - business}円。`,
      item.evidenceIds,
    )
    if (item.targets !== undefined && item.treatment !== 'general') {
      basis.method.version = '2'
      basis.method.explanation +=
        ' 業務分の制作物別配分: ' +
        [...item.targets]
          .sort((a, b) => (a.taxUnitId < b.taxUnitId ? -1 : a.taxUnitId > b.taxUnitId ? 1 : 0))
          .map(
            (target) =>
              target.taxUnitId +
              ': ' +
              (target.shareBps === null ? '未確認' : target.shareBps / 100 + '%'),
          )
          .join(' / ')
      if (item.targets.some((target) => target.shareBps === null))
        basis.warnings.push('未確認の制作物割合を推定せず、残りの業務額を未配分として保持します。')
      for (const part of allocateBusinessTargets(business, item.targets))
        addContribution(
          basis,
          part.taxUnitId === null
            ? { kind: 'unallocated' }
            : { kind: 'tax-unit', taxUnitId: part.taxUnitId },
          part.amountJpy,
          businessCalculation +
            ' 業務額を入力した割合で配分し、端数は最大剰余法・同率は対応先ID順で調整。未確認分と残余は未配分。',
          item.evidenceIds,
        )
    } else if (item.treatment === 'general') {
      addContribution(
        basis,
        { kind: 'general' },
        business,
        `${businessCalculation} 業務額 ${business}円を一般業務へ対応。制作物への配分とは分離。`,
        item.evidenceIds,
      )
    } else {
      const allocated = item.taxUnitId
        ? Math.round(business * ratio(item.projectAllocationRatio))
        : 0
      if (item.taxUnitId)
        addContribution(
          basis,
          { kind: 'tax-unit', taxUnitId: item.taxUnitId },
          allocated,
          `${businessCalculation} 業務額 ${business}円 × 制作物への対応割合 ${item.projectAllocationRatio} を円単位で四捨五入して、対応額 ${allocated}円。`,
          item.evidenceIds,
        )
      addContribution(
        basis,
        { kind: 'unallocated' },
        business - allocated,
        `${businessCalculation} ${item.taxUnitId ? `業務額 ${business}円 − 制作物への対応額 ${allocated}円 = 未配分 ${business - allocated}円。` : `制作物の対応先が未登録のため、業務額 ${business}円を未配分として保持。入力された制作物割合は適用していません。`}`,
        item.evidenceIds,
      )
    }
  }
  for (const item of planning.directCosts.filter(
    (item) => !validIsoCalendarDate(item.incurredOn) || item.incurredOn.startsWith(`${year}-`),
  )) {
    const affected =
      item.targets !== undefined
        ? item.targets.map((target) => target.taxUnitId)
        : item.taxUnitId
          ? [item.taxUnitId]
          : []
    const source: ExpenseSource = {
      id: `direct:${item.id}`,
      kind: item.costType === 'old-version-balance' ? 'opening-balance' : 'direct',
      label: {
        outsource: '外注費',
        material: '材料費',
        cloud: 'クラウド利用料',
        domain: 'ドメイン',
        license: 'ライセンス',
        'old-version-balance': '旧版から引き継ぐ残高',
        other: 'その他の直接費',
      }[item.costType],
      originalAmountJpy: item.amountJpy,
      ...(item.amountJpy === null ? { unknownOriginalAmountReasons: [item.unknownAmountReason ?? '原額が未確認です。'] } : {}),
      currency: 'JPY',
      ...(validIsoCalendarDate(item.incurredOn) ? { incurredOn: item.incurredOn } : {}),
      evidenceIds: [...item.evidenceIds],
      origin: 'legacy-planning',
    }
    const basis = rootBasis(
      source,
      validIsoCalendarDate(item.incurredOn)
        ? { startedOn: item.incurredOn, endedOn: item.incurredOn }
        : { startedOn: `${year}-01-01`, endedOn: `${year}-12-31` },
      {
        id: 'entered-direct-cost',
        version: '1',
        explanation: '入力した発生日と原額。複数期間・前払等の処理条件を別途確認する。',
      },
      item.amountJpy,
      item.evidenceIds.length ? [] : ['支払または対応関係の証拠が未登録です。'],
    )
    const costAmountJpy = basis.amount.status === 'known' ? basis.amount.amountJpy : null
    if (!validIsoCalendarDate(item.incurredOn)) {
      const reason = `発生日 ${item.incurredOn} が実在する年月日ではないため、年度帰属は未確認です。表示期間は確認対象年であり、利用期間ではありません。`
      basis.amount = { status: 'unknown', amountJpy: null, reasons: [reason] }
      basis.method.explanation = reason
      basis.warnings.push(reason)
      basis.affectedTaxUnitIds = affected
      continue
    }
    if (costAmountJpy === null) {
      basis.amount = {
        status: 'unknown',
        amountJpy: null,
        reasons: basis.amount.status === 'unknown' ? basis.amount.reasons : source.unknownOriginalAmountReasons ?? ['訂正後の費用基礎が未確認です。'],
      }
      basis.affectedTaxUnitIds = affected
      continue
    }
    if (item.costType === 'old-version-balance') {
      basis.amount = {
        status: 'unknown',
        amountJpy: null,
        reasons: [
          '旧版残高は新規の支払ではありません。元の採用版と振替先を照合するまで当年の費用基礎へ加算しません。',
        ],
      }
      basis.affectedTaxUnitIds = affected
      continue
    }
    if (item.targets !== undefined && item.treatment !== 'general') {
      basis.method.version = '2'
      basis.method.explanation +=
        ' 制作物別の配分: ' +
        [...item.targets]
          .sort((a, b) => (a.taxUnitId < b.taxUnitId ? -1 : a.taxUnitId > b.taxUnitId ? 1 : 0))
          .map(
            (target) =>
              target.taxUnitId +
              ': ' +
              (target.shareBps === null ? '未確認' : target.shareBps / 100 + '%'),
          )
          .join(' / ')
      if (item.targets.some((target) => target.shareBps === null))
        basis.warnings.push('未確認の制作物割合を推定せず、残額を未配分として保持します。')
      for (const part of allocateBusinessTargets(costAmountJpy, item.targets))
        addContribution(
          basis,
          part.taxUnitId === null
            ? { kind: 'unallocated' }
            : { kind: 'tax-unit', taxUnitId: part.taxUnitId },
          part.amountJpy,
          '入力した制作物別割合で配分。端数は最大剰余法・同率は対応先ID順。未確認分と残余は未配分。税務上の当年費用の採用を意味しません。',
          item.evidenceIds,
        )
      continue
    }
    const target: CostTarget =
      item.treatment === 'general'
        ? { kind: 'general' }
        : item.directlyAttributable && item.treatment === 'direct' && item.taxUnitId
          ? { kind: 'tax-unit', taxUnitId: item.taxUnitId }
          : { kind: 'unallocated' }
    addContribution(
      basis,
      target,
      costAmountJpy,
      target.kind === 'unallocated'
        ? '直接対応または対応先が未確認。'
        : '入力した費用の対応先。税務上の当年費用の採用を意味しません。',
      item.evidenceIds,
    )
  }
  return snapshot
}

export function projectWorkspaceCosts(
  planning: PlanningSnapshot,
  subscriptions: SubscriptionCostScope[],
) {
  const costs = projectAnnualCosts(
    buildWorkspaceCostSnapshot(planning, subscriptions),
    planning.profile.taxYear,
  )
  return attachCostTreatments(costs, planning)
}