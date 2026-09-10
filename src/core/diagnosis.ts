import type { ActionItem, Diagnosis, LifecycleEventType, PlanningSnapshot, TaxUnitRecord } from '../planning/types.js'
import { assessCostPresence, costPresenceRecordsSchema } from '../planning/costPresence.js'

type DiagnosisContext = { hasRelevantAiUsage?: boolean }
const unique = (values: string[]) => [...new Set(values)]
const lifecycleLabels: Record<TaxUnitRecord['lifecycleStatus'], string> = {
  idea: '構想中', prototype: '試作中', developing: '開発中', evaluating: '評価中',
  'in-use': '正式利用中', maintaining: '保守中', improving: '改良中', retired: '廃止済み', abandoned: '開発中止',
}

/** Findings describe recorded facts and applicable omissions, never a readiness score. */
export function diagnosePlanning(snapshot: PlanningSnapshot, context: DiagnosisContext = {}): Diagnosis {
  const year = snapshot.profile.taxYear
  const retrospective = snapshot.taxUnits.filter((unit) => (unit.journeyMode ?? snapshot.profile.journeyMode) === 'retrospective').length
  const currentPosition = snapshot.taxUnits.length
    ? [`制作物ごとに診断します。早期準備${snapshot.taxUnits.length - retrospective}件、過去整理${retrospective}件です。`]
    : ['制作物を登録すると、それぞれの現在地に合わせて診断します。通常業務の費用だけなら架空の制作物は必要ありません。']
  const immediateActions: ActionItem[] = [], eventTriggeredActions: ActionItem[] = [], missingFacts: string[] = []
  const hasEvent = (id: string, type: LifecycleEventType) => snapshot.lifecycleEvents.some((event) =>
    event.taxUnitId === id && event.eventType === type && event.occurredOn <= `${year}-12-31`,
  )
  const add = (id: string, title: string, reason: string, priority: ActionItem['priority'] = 'medium', taxUnitId?: string, trigger: ActionItem['trigger'] = 'now') => {
    const target = trigger === 'now' ? immediateActions : eventTriggeredActions
    if (!target.some((item) => item.id === id)) target.push({ id, title, reason, priority, trigger, ...(taxUnitId ? { taxUnitId } : {}) })
  }
  const declarations = costPresenceRecordsSchema.safeParse(snapshot.costPresence ?? [])
  if (!declarations.success) missingFacts.push('年度別の費用項目確認の理由・日時・重複')
  else if (Number.isInteger(year) && year >= 2000 && year <= 2100) {
    for (const row of assessCostPresence(snapshot, declarations.data)) {
      if (row.status !== 'deferred' && row.status !== 'conflict') continue
      const title = `${row.taxYear}年の${row.label}: ${row.status === 'conflict' ? '該当なしと登録内容の不一致を確認する' : '保留した確認を続ける'}`
      missingFacts.push(title)
      add(`cost-presence-${row.category}`, title, `${row.explanation} 理由: ${row.declaration?.reason ?? ''}`, row.status === 'conflict' ? 'high' : 'medium')
    }
  }
  if (context.hasRelevantAiUsage && snapshot.projectRules.length === 0) {
    add('register-project-period-rules', 'AI履歴と制作物の期間対応を登録する', '対象年に取得した利用があります。実際の作業目的と期間を対応付けます。', 'high')
    missingFacts.push('AI履歴と税務単位を結ぶ期間付き分類ルール')
  }
  for (const unit of snapshot.taxUnits) {
    currentPosition.push(`${unit.name}は${lifecycleLabels[unit.lifecycleStatus]}です。`)
    const journey = unit.journeyMode ?? snapshot.profile.journeyMode
    const monetization = unit.monetizationStatus ?? snapshot.profile.monetizationStatus
    if (journey === 'retrospective' && !hasEvent(unit.id, 'development-started')) {
      add(`reconstruct-history:${unit.id}`, `${unit.name}の過去の節目を復元する`, 'ファイル・販売・デプロイ等の記録から、記録日時と実際の出来事の日を分けて残します。', 'high', unit.id)
      missingFacts.push(`${unit.name}の開発開始日`)
    }
    if (monetization === 'earning') {
      currentPosition.push(`${unit.name}は売上発生済みです。`)
      if (!hasEvent(unit.id, 'first-sale')) {
        add(`first-sale:${unit.id}`, `${unit.name}の初回売上日を記録する`, '公開予定と実際の売上発生を区別します。', 'high', unit.id)
        missingFacts.push(`${unit.name}の初回売上日`)
      }
    } else if (monetization === 'planned') currentPosition.push(`${unit.name}はこれから収益化する予定です。`)
    if (unit.usageMode === 'undecided') {
      add(`usage-mode:${unit.id}`, `${unit.name}を誰が使うか整理する`, '自己利用・外部提供・両方のいずれかを確認します。', 'high', unit.id)
      missingFacts.push(`${unit.name}の利用形態`)
    } else {
      currentPosition.push(`${unit.name}は${unit.usageMode === 'internal' ? '自己利用' : unit.usageMode === 'external' ? '外部公開・提供' : '自己利用と外部提供の両方'}を目的としています。`)
      if (unit.usageMode === 'mixed' && (!unit.sameAsExternalVersion || unit.sameAsExternalVersion === 'undecided')) missingFacts.push(`${unit.name}の自己利用版と外部提供版の資産境界`)
    }
    if (['prototype', 'developing', 'evaluating', 'improving'].includes(unit.lifecycleStatus) && !unit.completionCriteria?.trim()) {
      add(`completion:${unit.id}`, `${unit.name}の完成・正式採用条件を記録する`, '試験と正式利用を区別できるよう、実際の開発判断を残します。', 'high', unit.id)
      missingFacts.push(`${unit.name}の完成・正式採用条件`)
    }
    for (const [mode, event, id, title, missing] of [
      ['internal', 'internal-use-started', 'internal-use', '実作業へ正式採用した日', '自己利用開始日と証拠'],
      ['external', 'external-released', 'external-release', '外部公開・提供した日', '外部提供開始日と証拠'],
    ] as const) {
      if ((unit.usageMode !== mode && unit.usageMode !== 'mixed') || hasEvent(unit.id, event)) continue
      if (unit.lifecycleStatus !== 'abandoned' && unit.lifecycleStatus !== 'retired') add(`${id}:${unit.id}`, `${unit.name}の${title}を記録する`, '予定・試験と実際の利用開始を区別します。', 'high', unit.id, 'event')
      if (['in-use', 'maintaining', 'improving', 'retired'].includes(unit.lifecycleStatus)) missingFacts.push(`${unit.name}の${missing}`)
    }
    if (unit.unitType === 'improvement-plan' && !hasEvent(unit.id, 'improvement-started')) {
      add(`improvement-start:${unit.id}`, `${unit.name}の改良開始を記録する`, '稼働版とは別に、一つの改良計画の対象期間を記録します。', 'medium', unit.id)
      missingFacts.push(`${unit.name}の改良開始日`)
    }
    if (unit.predecessorId) {
      currentPosition.push(`${unit.name}には前身の制作物があります。旧版の継続利用・終了と原価承継は別の事実であり、自動で終了・振替しません。`)
    }
  }
  const equipment = snapshot.equipment.filter((item) => item.acquiredOn <= `${year}-12-31`)
  const home = snapshot.homeCosts.filter((item) => item.month.startsWith(`${year}-`))
  const direct = snapshot.directCosts.filter((item) => item.incurredOn.startsWith(`${year}-`))
  for (const item of equipment) {
    if (!item.evidenceIds.length) missingFacts.push(`${item.name}の購入・転用証拠`)
    if (item.convertedFromPrivate && item.openingUnamortizedBalanceJpy === undefined) missingFacts.push(`${item.name}の業務転用時未償却残高`)
    if (!snapshot.equipmentMethods?.some((method) => method.equipmentId === item.id && method.taxYear === year)) missingFacts.push(`${item.name}の${year}年の計算方法・条件`)
  }
  for (const item of home) {
    if (!item.basis.trim() || !item.rationale.trim()) missingFacts.push(`${item.month} ${item.category}の按分根拠`)
    if (!item.evidenceIds.length) missingFacts.push(`${item.month} ${item.category}の証拠`)
  }
  const hasRelevantRecords = equipment.length > 0 || home.length > 0 || direct.length > 0 || Boolean(context.hasRelevantAiUsage) || snapshot.lifecycleEvents.some((event) => event.occurredOn.startsWith(`${year}-`))
  if (hasRelevantRecords && !snapshot.profile.hasBookkeeping) {
    add('start-bookkeeping', '月次の帳簿と証拠保存を始める', '記録した支払・配分・出来事と、対応する根拠を継続して残します。', 'high')
    missingFacts.push('月次帳簿')
  }
  if (hasRelevantRecords && snapshot.evidence.length === 0) {
    add('register-evidence', 'Git以外も含めて証拠を登録する', '請求書、カード明細、デプロイ、スクリーンショット、作業メモ等を利用できます。', 'high')
    missingFacts.push('根拠資料')
  }
  return { currentPosition: unique(currentPosition), immediateActions, eventTriggeredActions, missingFacts: unique(missingFacts) }
}
