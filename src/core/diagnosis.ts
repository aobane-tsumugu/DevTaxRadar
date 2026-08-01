import type {
  ActionItem,
  Diagnosis,
  LifecycleEventType,
  PlanningSnapshot,
  TaxUnitRecord,
} from '../planning/types.js'

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

function hasEvent(
  snapshot: PlanningSnapshot,
  taxUnitId: string,
  eventType: LifecycleEventType,
): boolean {
  return snapshot.lifecycleEvents.some((event) => (
    event.taxUnitId === taxUnitId && event.eventType === eventType
  ))
}

function lifecyclePosition(unit: TaxUnitRecord): string {
  const labels: Record<TaxUnitRecord['lifecycleStatus'], string> = {
    idea: '構想中',
    prototype: '試作中',
    developing: '開発中',
    evaluating: '評価中',
    'in-use': '正式利用中',
    maintaining: '保守中',
    improving: '改良中',
    retired: '廃止済み',
    abandoned: '開発中止',
  }
  return `${unit.name}は${labels[unit.lifecycleStatus]}です。`
}

function addAction(
  target: ActionItem[],
  action: ActionItem,
): void {
  if (!target.some((existing) => existing.id === action.id)) target.push(action)
}

/**
 * Turns facts already recorded by the user into a neutral preparation checklist.
 * It deliberately avoids recommending artificial timing, splitting or spending.
 */
export function diagnosePlanning(snapshot: PlanningSnapshot): Diagnosis {
  const retrospectiveUnits = snapshot.taxUnits.filter((unit) => (
    (unit.journeyMode ?? snapshot.profile.journeyMode) === 'retrospective'
  ))
  const earlyUnits = snapshot.taxUnits.length - retrospectiveUnits.length
  const currentPosition: string[] = snapshot.taxUnits.length === 0
    ? ['制作物を登録すると、それぞれの現在地に合わせて診断します。']
    : [`制作物ごとに診断します。早期準備${earlyUnits}件、過去整理${retrospectiveUnits.length}件です。`]
  const immediateActions: ActionItem[] = []
  const eventTriggeredActions: ActionItem[] = []
  const missingFacts: string[] = []

  if (snapshot.taxUnits.length === 0) {
    addAction(immediateActions, {
      id: 'register-tax-unit',
      priority: 'high',
      title: '制作物・改良計画を登録する',
      reason: 'AI利用や直接費を集計する単位がまだありません。',
      trigger: 'now',
    })
    missingFacts.push('制作物・改良計画')
  } else {
    currentPosition.push(`${snapshot.taxUnits.length}件の制作物・改良計画が登録されています。`)
  }

  if (snapshot.taxUnits.length > 0 && snapshot.projectRules.length === 0) {
    addAction(immediateActions, {
      id: 'register-project-period-rules',
      priority: 'high',
      title: 'AI履歴と制作物の期間対応を登録する',
      reason: '同じ作業フォルダでも、開発・保守・改良は時期によって変わります。',
      trigger: 'now',
    })
    missingFacts.push('AI履歴と税務単位を結ぶ期間付き分類ルール')
  }

  for (const unit of snapshot.taxUnits) {
    currentPosition.push(lifecyclePosition(unit))
    const journeyMode = unit.journeyMode ?? snapshot.profile.journeyMode
    const monetizationStatus = unit.monetizationStatus ?? snapshot.profile.monetizationStatus

    if (journeyMode === 'retrospective' && !hasEvent(snapshot, unit.id, 'development-started')) {
      addAction(immediateActions, {
        id: `reconstruct-history:${unit.id}`,
        priority: 'high',
        title: `${unit.name}の過去の節目を復元する`,
        reason: 'デプロイ、販売、ファイル、AIセッション等から、履歴上の日時と実際の開始日を分けて残します。',
        trigger: 'now',
        taxUnitId: unit.id,
      })
      missingFacts.push(`${unit.name}の開発開始日`)
    }

    if (monetizationStatus === 'earning') {
      currentPosition.push(`${unit.name}は売上発生済みです。`)
      if (!hasEvent(snapshot, unit.id, 'first-sale')) {
        addAction(immediateActions, {
          id: `first-sale:${unit.id}`,
          priority: 'high',
          title: `${unit.name}の初回売上日を記録する`,
          reason: '制作・公開段階と実際に売上が生じた段階を区別するためです。',
          trigger: 'now',
          taxUnitId: unit.id,
        })
        missingFacts.push(`${unit.name}の初回売上日`)
      }
    } else if (monetizationStatus === 'planned') {
      currentPosition.push(`${unit.name}はこれから収益化する予定です。`)
    } else {
      currentPosition.push(`${unit.name}の収益化方針は未定です。`)
    }

    if (unit.usageMode === 'undecided') {
      addAction(immediateActions, {
        id: `usage-mode:${unit.id}`,
        priority: 'high',
        title: `${unit.name}を誰が使うか整理する`,
        reason: '自己利用、外部提供、両方のいずれかが未確認です。',
        trigger: 'now',
        taxUnitId: unit.id,
      })
      missingFacts.push(`${unit.name}の利用形態`)
    } else if (unit.usageMode === 'internal') {
      currentPosition.push(`${unit.name}は自己利用を目的としています。`)
    } else if (unit.usageMode === 'external') {
      currentPosition.push(`${unit.name}は外部公開・提供を目的としています。`)
    } else {
      currentPosition.push(`${unit.name}は自己利用と外部提供の両方を目的としています。`)
      if (unit.sameAsExternalVersion === 'undecided' || !unit.sameAsExternalVersion) {
        missingFacts.push(`${unit.name}の自己利用版と外部提供版の資産境界`)
      }
    }

    if (
      ['prototype', 'developing', 'evaluating', 'improving'].includes(unit.lifecycleStatus)
      && !unit.completionCriteria?.trim()
    ) {
      addAction(immediateActions, {
        id: `completion:${unit.id}`,
        priority: 'high',
        title: `${unit.name}の完成・正式採用条件を記録する`,
        reason: 'テストと正式利用を区別できるよう、実際の開発判断を言語化します。',
        trigger: 'now',
        taxUnitId: unit.id,
      })
      missingFacts.push(`${unit.name}の完成・正式採用条件`)
    }

    const needsInternalEvent = unit.usageMode === 'internal' || unit.usageMode === 'mixed'
    if (needsInternalEvent && !hasEvent(snapshot, unit.id, 'internal-use-started')) {
      addAction(eventTriggeredActions, {
        id: `internal-use:${unit.id}`,
        priority: 'high',
        title: `${unit.name}を実作業へ正式採用した日を記録する`,
        reason: '評価利用と自己業務での正式利用を区別するためです。',
        trigger: 'event',
        taxUnitId: unit.id,
      })
      if (['in-use', 'maintaining', 'improving', 'retired'].includes(unit.lifecycleStatus)) {
        missingFacts.push(`${unit.name}の自己利用開始日と証拠`)
      }
    }

    const needsExternalEvent = unit.usageMode === 'external' || unit.usageMode === 'mixed'
    if (needsExternalEvent && !hasEvent(snapshot, unit.id, 'external-released')) {
      addAction(eventTriggeredActions, {
        id: `external-release:${unit.id}`,
        priority: 'high',
        title: `${unit.name}を外部公開・提供した日を記録する`,
        reason: '公開予定と実際の提供開始を区別するためです。',
        trigger: 'event',
        taxUnitId: unit.id,
      })
      if (['in-use', 'maintaining', 'improving', 'retired'].includes(unit.lifecycleStatus)) {
        missingFacts.push(`${unit.name}の外部提供開始日と証拠`)
      }
    }

    if (unit.unitType === 'improvement-plan' && !hasEvent(snapshot, unit.id, 'improvement-started')) {
      addAction(immediateActions, {
        id: `improvement-start:${unit.id}`,
        priority: 'medium',
        title: `${unit.name}の改良開始を記録する`,
        reason: '一つの改良計画として集計する期間を明確にします。',
        trigger: 'now',
        taxUnitId: unit.id,
      })
      missingFacts.push(`${unit.name}の改良開始日`)
    }

    if (unit.predecessorId && !hasEvent(snapshot, unit.predecessorId, 'retired')) {
      addAction(eventTriggeredActions, {
        id: `predecessor-retirement:${unit.id}`,
        priority: 'medium',
        title: `${unit.name}への移行時に旧版の利用終了を記録する`,
        reason: '旧版を実際に使い続けるかどうかと、二重処理がないことを確認するためです。',
        trigger: 'event',
        taxUnitId: unit.id,
      })
    }
  }

  if (snapshot.profile.incomeCategory === 'undecided') {
    addAction(immediateActions, {
      id: 'income-facts',
      priority: 'medium',
      title: '所得区分の判断材料を整理する',
      reason: '販売、継続、帳簿、改善活動等の事実を記録し、区分そのものは自動確定しません。',
      trigger: 'now',
    })
    missingFacts.push('所得区分の判断材料')
  }

  if (!snapshot.profile.hasBookkeeping) {
    addAction(immediateActions, {
      id: 'start-bookkeeping',
      priority: 'high',
      title: '月次の帳簿と証拠保存を始める',
      reason: '支払額、配賦、直接費、供用等を同じ基準で継続記録するためです。',
      trigger: 'now',
    })
    missingFacts.push('月次帳簿')
  }

  if (snapshot.equipment.length === 0) {
    addAction(immediateActions, {
      id: 'review-equipment',
      priority: 'medium',
      title: 'PC・GPU・DGX等の利用状況を確認する',
      reason: '該当する設備があれば、購入、転用、利用割合と役割を記録します。',
      trigger: 'now',
    })
    missingFacts.push('開発に使用する設備の有無')
  } else {
    for (const item of snapshot.equipment) {
      if (!item.usefulLifeYears) missingFacts.push(`${item.name}の耐用年数候補`)
      if (!item.evidenceIds.length) missingFacts.push(`${item.name}の購入・転用証拠`)
      if (item.convertedFromPrivate && item.openingUnamortizedBalanceJpy === undefined) {
        missingFacts.push(`${item.name}の業務転用時未償却残高`)
      }
    }
  }

  if (snapshot.homeCosts.length === 0) {
    addAction(immediateActions, {
      id: 'review-home-costs',
      priority: 'medium',
      title: '家賃・電気・通信の業務利用を確認する',
      reason: '該当する費用があれば、面積・時間・消費電力等の一貫した根拠を記録します。',
      trigger: 'now',
    })
    missingFacts.push('自宅関連費の有無と按分根拠')
  } else {
    for (const cost of snapshot.homeCosts) {
      if (!cost.basis.trim() || !cost.rationale.trim()) missingFacts.push(`${cost.month} ${cost.category}の按分根拠`)
      if (!cost.evidenceIds.length) missingFacts.push(`${cost.month} ${cost.category}の証拠`)
    }
  }

  if (snapshot.evidence.length === 0) {
    addAction(immediateActions, {
      id: 'register-evidence',
      priority: 'high',
      title: 'Git以外も含めて証拠を登録する',
      reason: '請求書、カード明細、デプロイ、ファイル、スクリーンショット、作業メモ等を利用できます。',
      trigger: 'now',
    })
    missingFacts.push('根拠資料')
  }

  const readinessChecks = [
    snapshot.taxUnits.length > 0,
    snapshot.taxUnits.length === 0 || snapshot.projectRules.length > 0,
    snapshot.taxUnits.length > 0 && snapshot.taxUnits.every((unit) => unit.usageMode !== 'undecided'),
    snapshot.taxUnits.length > 0 && snapshot.taxUnits.every((unit) => (
      !['prototype', 'developing', 'evaluating', 'improving'].includes(unit.lifecycleStatus)
      || Boolean(unit.completionCriteria?.trim())
    )),
    snapshot.taxUnits.length > 0 && snapshot.taxUnits.every((unit) => {
      if (!['in-use', 'maintaining', 'improving', 'retired'].includes(unit.lifecycleStatus)) return true
      const internalReady = !['internal', 'mixed'].includes(unit.usageMode)
        || hasEvent(snapshot, unit.id, 'internal-use-started')
      const externalReady = !['external', 'mixed'].includes(unit.usageMode)
        || hasEvent(snapshot, unit.id, 'external-released')
      return internalReady && externalReady
    }),
    snapshot.profile.incomeCategory !== 'undecided',
    snapshot.profile.hasBookkeeping,
    snapshot.equipment.length > 0 && snapshot.equipment.every((item) => (
      Boolean(item.usefulLifeYears)
      && item.evidenceIds.length > 0
      && (!item.convertedFromPrivate || item.openingUnamortizedBalanceJpy !== undefined)
    )),
    snapshot.homeCosts.length > 0 && snapshot.homeCosts.every((cost) => (
      Boolean(cost.basis.trim()) && Boolean(cost.rationale.trim()) && cost.evidenceIds.length > 0
    )),
    snapshot.evidence.length > 0,
  ]

  return {
    currentPosition: unique(currentPosition),
    immediateActions,
    eventTriggeredActions,
    missingFacts: unique(missingFacts),
    readiness: {
      confirmed: readinessChecks.filter(Boolean).length,
      total: readinessChecks.length,
    },
  }
}
