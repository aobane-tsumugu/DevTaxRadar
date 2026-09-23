import type { Diagnosis, PlanningSnapshot } from '../planning/types.js'

const text = (value: unknown) => String(value ?? '').replace(/[\r\n\t]/g, ' ').replace(/([\\`*_[\]<>#|])/g, '\\$1')
const amount = (value: number | null) => value === null ? '不明' : value.toLocaleString('ja-JP') + '円'

// A consultation handout is read by people, not parsers: stored codes print as Japanese, and a
// code without a label still prints as itself rather than disappearing.
const labels: Record<string, string> = {
  undecided: '未定', miscellaneous: '雑所得（検討中）', business: '事業所得（検討中）',
  white: '白色申告', blue: '青色申告', none: '売上なし', planned: '収益化予定', earning: '売上あり',
  early: 'これからの記録を準備', retrospective: '過去の履歴を整理',
  'new-software': '新規ソフトウェア', 'improvement-plan': '改良計画', 'sales-production': '販売用制作',
  internal: '自分の実作業で使う', external: '外部へ公開・提供', mixed: '自分利用と外部提供',
  sales: '販売', subscription: '定期課金', advertising: '広告', affiliate: 'アフィリエイト',
  efficiency: '業務効率化', oss: 'OSS', other: 'その他',
  idea: '構想中', prototype: '試作中', developing: '開発中', evaluating: '評価中', 'in-use': '実作業で利用中',
  maintaining: '保守中', improving: '改良中', retired: '利用終了', abandoned: '開発中止',
  'new-development': '新規開発', maintenance: '保守・バグ修正', 'feature-addition': '機能の大きな追加',
  'general-learning': '一般的な学習', private: '趣味・私用', unclassified: '未分類',
}
const label = (value: unknown) => text(typeof value === 'string' ? labels[value] ?? value : value)

/** Shared by the server and synthetic demo; no old ledger calculations or local paths. */
export function planningMarkdown(snapshot: PlanningSnapshot, diagnosis?: Diagnosis): string {
  const lines = [
    '# DevTax 計画・原価資料', '', `対象年: ${snapshot.profile.taxYear}年`,
    `所得区分候補: ${label(snapshot.profile.incomeCategory)}`, `申告方式: ${label(snapshot.profile.filingType)}`,
    '', '入力した事実・本人の判断記録です。年度採用版や、税務適用の確認完了を意味しません。',
    '名称・相談内容・自由記述はそのまま含まれます。第三者へ渡す前に確認してください。証拠のローカル保存場所は含めません。',
  ]
  if (snapshot.profile.notes) lines.push('', `計画のメモ: ${text(snapshot.profile.notes)}`)
  lines.push('', '## 制作物・改良計画', '')
  for (const unit of snapshot.taxUnits) {
    lines.push(`- ${text(unit.name)} / ID: ${text(unit.id)} / ${label(unit.unitType)} / ${label(unit.usageMode)} / ${label(unit.lifecycleStatus)}`,
      `  - 収益形態: ${label(unit.revenueModel)} / 売上状況: ${label(unit.monetizationStatus ?? snapshot.profile.monetizationStatus)}`,
      `  - 整理方法: ${label(unit.journeyMode ?? snapshot.profile.journeyMode)} / 完成条件: ${text(unit.completionCriteria) || '未記入'}`)
    if (unit.predecessorId) lines.push(`  - 前身の制作物: ${text(unit.predecessorId)}（利用終了・原価振替を意味しません）`)
    if (unit.notes) lines.push(`  - メモ: ${text(unit.notes)}`)
  }
  lines.push('', '## 期間付き分類ルール', '')
  for (const rule of snapshot.projectRules) lines.push(`- ${text(rule.id)} / ${text(rule.projectKey)} / ${text(rule.provider) || '両サービス'} / ${text(rule.effectiveFrom)} ～ ${text(rule.effectiveTo) || '終了未指定'} / ${label(rule.classification)} / 制作物 ${text(rule.taxUnitId) || '未指定'} / 理由 ${text(rule.reason) || '未記入'}`)
  lines.push('', '## 年度別の費用項目の確認', '', '本人の記録です。未登録は「該当なし」を意味しません。')
  for (const item of snapshot.costPresence ?? []) lines.push(`- ${item.taxYear}年 ${{ equipment: '設備', home: '自宅費用', direct: '直接費' }[item.category]}: ${item.status === 'not-applicable' ? '該当なし' : '保留'} / 理由: ${text(item.reason)} / 記録日時: ${text(item.recordedAt)} / ID: ${text(item.id)}`)
  if (!snapshot.costPresence?.length) lines.push('確認記録なし。')
  lines.push('', '## 設備', '')
  for (const item of snapshot.equipment) {
    lines.push(`- ${text(item.name)} / ID ${text(item.id)} / 購入原額 ${amount(item.acquisitionCostJpy)} / 取得日 ${text(item.acquiredOn)}`,
      `  - 業務利用開始日 ${text(item.businessUseStartedOn) || '未確認'} / 私用転用 ${item.convertedFromPrivate ? 'あり' : 'なし'}`,
      `  - 業務割合 ${item.businessUseRatio * 100}% / 役割 ${text(item.role)} / 証拠 ${item.evidenceIds.map(text).join('、') || '未登録'}`)
    if (item.unknownAmountReason) lines.push(`  - 原額不明の理由: ${text(item.unknownAmountReason)}`)
    if (item.openingUnamortizedBalanceJpy !== undefined) lines.push(`  - 入力した転用時残高 ${amount(item.openingUnamortizedBalanceJpy)}（適用条件の自動検証ではありません）`)
  }
  lines.push('', '### 設備の年度別計算条件', '', '実計算と前年照合の結果は共通費用資料・年度資料を参照してください。')
  for (const method of snapshot.equipmentMethods ?? []) {
    lines.push(`- ${method.taxYear}年 / 設備 ${text(method.equipmentId)} / 方法 ${text(method.method)} / 耐用年数 ${text(method.usefulLifeYears) || '未確認'}`,
      `  - 理由 ${text(method.methodReason)} / 記録日時 ${text(method.recordedAt)}`)
    if (method.priorClosing) lines.push(`  - 前年残高 ${method.priorClosing.taxYear}年 ${amount(method.priorClosing.amountJpy)} / ${text(method.priorClosing.reference)}`)
    if (method.priorReviewId) lines.push(`  - 前年資料ID ${text(method.priorReviewId)}`)
    if (method.allocation) lines.push(`  - 年度別の配分条件: ${text(JSON.stringify(method.allocation))}`)
  }
  lines.push('', '## 家賃・電気・通信費', '')
  for (const item of snapshot.homeCosts) {
    lines.push(`- ${text(item.month)} ${text(item.category)} / ID ${text(item.id)} / 原額 ${amount(item.amountJpy)} / 業務割合 ${item.businessUseRatio * 100}%`,
      `  - 方法 ${text(item.method)} / 計測 ${text(item.basis)} / 理由 ${text(item.rationale)}`,
      `  - 処理区分 ${text(item.treatment)} / 制作物 ${text(item.taxUnitId) || '未指定'} / 配分条件 ${text(item.targets === undefined ? item.projectAllocationRatio : JSON.stringify(item.targets))}`,
      `  - 証拠 ${item.evidenceIds.map(text).join('、') || '未登録'}`)
    if (item.unknownAmountReason) lines.push(`  - 原額不明の理由: ${text(item.unknownAmountReason)}`)
  }
  lines.push('', '## 直接費', '')
  for (const item of snapshot.directCosts) {
    lines.push(`- ${text(item.incurredOn)} ${text(item.costType)} / ID ${text(item.id)} / 原額 ${amount(item.amountJpy)}`,
      `  - 直接対応 ${item.directlyAttributable ? 'あり' : '未確認・直接対応なし'} / ${text(item.treatment)} / 制作物 ${text(item.taxUnitId) || '未指定'}`,
      `  - 証拠 ${item.evidenceIds.map(text).join('、') || '未登録'}`)
    if (item.targets !== undefined) lines.push(`  - 配分条件 ${text(JSON.stringify(item.targets))}`)
    if (item.unknownAmountReason) lines.push(`  - 原額不明の理由: ${text(item.unknownAmountReason)}`)
    if (item.note) lines.push(`  - メモ: ${text(item.note)}`)
  }
  if (snapshot.sourceAdjustments?.length) {
    lines.push(
      '', '## 返金・訂正の登録記録', '',
      '登録された事実と選択した扱いを出力します。元費用の原額を上書きせず、返金額をこの資料の費用・残高から再度差し引きません。',
      '元費用を確認する年、受領・訂正日、税務処理の対象年は同じとは限りません。この記録の存在だけでは、費用基礎への反映や残高減少との照合の完了を示しません。',
    )
    const effects = {
      'restate-original-cost': '元費用の訂正を指定',
      'balance-reduction': '残高減少との対応を指定',
      undetermined: '扱いを保留',
    } as const
    for (const item of snapshot.sourceAdjustments) {
      const basis = item.sourceBasis
      lines.push(
        `- ${item.kind === 'refund' ? '返金' : '訂正'} / ID ${text(item.id)} / 記録額 ${amount(item.amountJpy)}`,
        `  - 元費用ID ${text(item.sourceId)} / 元費用を確認する年 ${item.sourceYear}年`,
        `  - 受領・訂正日 ${text(item.occurredOn)} / 記録日時 ${text(item.recordedAt)}`,
        `  - 選択した扱い: ${effects[item.effect]} / 理由: ${text(item.reason)}`,
        `  - 記録時の元費用: ${text(basis.kind)} / 原額 ${amount(basis.originalAmountJpy)}`,
        `  - 証拠参照ID: ${item.evidenceIds.map(text).join('、') || '未登録'}`,
      )
      if (basis.servicePeriod) lines.push(`  - 記録時の対象期間: ${text(basis.servicePeriod.startedOn)} ～ ${text(basis.servicePeriod.endedOn)}`)
      if (basis.acquiredOn) lines.push(`  - 記録時の取得日: ${text(basis.acquiredOn)}`)
      if (basis.contractId) lines.push(`  - 記録時の契約ID: ${text(basis.contractId)}`)
      if (item.balanceMovementId) lines.push(`  - 対応させた残高減少ID: ${text(item.balanceMovementId)}（この一覧だけでは金額・原価の一致は未検証）`)
      if (item.conversion) {
        const conversion = item.conversion
        const rounding = {
          'nearest-yen': '円未満四捨五入',
          'floor-yen': '円未満切捨て',
          'ceiling-yen': '円未満切上げ',
        } as const
        lines.push(
          `  - 換算根拠: ${text(conversion.foreignAmount)} ${text(conversion.currency)} × ${text(conversion.jpyPerUnit)} 円/通貨単位 / ${rounding[conversion.rounding]}`,
          `  - 換算日 ${text(conversion.convertedOn)} / 確認先 ${text(conversion.reference)}`,
        )
      }
    }
  }
  lines.push('', '## ライフサイクルと証拠', '')
  for (const event of snapshot.lifecycleEvents) lines.push(`- ${text(event.occurredOn)} / ${text(event.eventType)} / 制作物 ${text(event.taxUnitId)} / ID ${text(event.id)} / 証拠 ${event.evidenceIds.map(text).join('、') || '未登録'} / ${text(event.note)}`)
  for (const evidence of snapshot.evidence) lines.push(`- ${text(evidence.occurredOn ?? evidence.recordedAt)} / ${text(evidence.evidenceType)} (${text(evidence.strength)}) / ID ${text(evidence.id)} / ${text(evidence.note)}`)
  lines.push('', '## 扱いを判断した記録', '')
  for (const decision of snapshot.decisions) lines.push(`- ${decision.taxYear}年 / 制作物 ${text(decision.taxUnitId)} / ID ${text(decision.id)} / ${text(decision.status)} / 検討 ${text(decision.candidate)} / 選択 ${text(decision.selectedCandidate) || '未選択'} / 理由 ${text(decision.reason) || '未記入'} / 確認日時 ${text(decision.confirmedAt) || '未確認'}`)
  if (diagnosis) {
    lines.push('', '## 次に確認すること', '')
    for (const action of diagnosis.immediateActions) lines.push(`- [${action.priority}] ${text(action.title)}: ${text(action.reason)}`)
    if (diagnosis.missingFacts.length) lines.push(`不足情報: ${diagnosis.missingFacts.map(text).join('、')}`)
  }
  lines.push('', '> 採用・申告に使う際は、事実・根拠・対象年・適用条件を確認してください。', '')
  return lines.join('\n')
}
