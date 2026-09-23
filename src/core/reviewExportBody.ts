import { consultationResolutionMatches } from './consultationResolution.js'
import type { BalanceReview } from '../accounting/balanceWorkspace.js'
import type { AmountState } from '../accounting/types.js'
import { costProjectionMarkdown } from './costExport.js'
import { costLotLabel, describeCostLots } from './costLotLabel.js'
import { treatmentCandidateName } from './costTreatmentFacts.js'

const text = (value: string) => value.replace(/[\r\n\t]/g, ' ').replace(/([\\`*_[\]<>#|])/g, '\\$1')
const yen = (value: number) => value.toLocaleString('ja-JP') + '円'
const amount = (value: AmountState) =>
  value.status === 'known'
    ? yen(value.amountJpy)
    : '不明（' + value.reasons.map(text).join(' / ') + '）'

/** Export only the stored record. Never fetch, merge or recalculate current workspace inputs. */
export function reviewExportJson(review: BalanceReview): string {
  return JSON.stringify({ exportVersion: 1, kind: 'stored-year-review', review }, null, 2) + '\n'
}

export function reviewExportMarkdown(review: BalanceReview): string {
  const descriptions = describeCostLots(
    review.materials ? (review.materials.costLinks?.costs ?? [review.materials.costs]) : [],
  )
  const lines = [
    '# ' + review.year + '年の保存済み年度資料',
    '',
    '- 資料ID: ' + text(review.id),
    '- 記録日時: ' + text(review.createdAt),
    '- 残高の入力版: ' + review.draftRevision,
    '- 計算版: ' + text(review.engineVersion),
    '- 記録・訂正の理由: ' + text(review.reason),
    '- 訂正元の資料ID: ' + (review.correctsReviewId ? text(review.correctsReviewId) : 'なし'),
    '- 前年の資料ID: ' + (review.previousReviewId ? text(review.previousReviewId) : 'なし'),
    '',
    'このファイルは指定した保存版の内容です。最新の入力や後の訂正版へ置き換えていません。税務上の適用条件・金額の由来の検証完了を意味しません。',
    '',
    '不明な額を0円として集計しません。記録した期首・増減による結果であり、費用基礎と残高を足し合わせません。',
    '',
  ]
  const kinds = { construction: '制作中', asset: '資産', prepaid: '前払' }
  const carry = review.materials?.openingLotCarry
  lines.push('## 前年からの原価繰越し', '')
  if (!carry) lines.push('この資料には原価繰越しの照合が未収録です。現在の資料から補完しません。')
  else {
    lines.push(
      '前年資料ID: ' + text(carry.previousReviewId ?? '未接続'),
      '状態: ' +
        {
          consistent: '記録した原価の繰越しに不整合なし',
          incomplete: '原価未追跡・未収録あり',
          invalid: '繰越し不整合あり',
          'not-linked': '直前年度の採用資料が未接続',
        }[carry.status],
      '過去の増減を保持した台帳の期首説明です。新しい支払・増加の追加や税務上の適用確認ではありません。名称は前年採用時の資料によります。',
    )
    for (const row of carry.accounts) {
      lines.push(
        '- ' +
          text(row.name) +
          ' / 残高ID ' +
          text(row.accountId) +
          ' / 前年期末 ' +
          amount(row.previousClosing) +
          ' / 当年期首 ' +
          amount(row.opening) +
          ' / 原価未追跡 ' +
          (row.untracedJpy === null ? '未確定' : row.untracedJpy.toLocaleString('ja-JP') + '円'),
      )
      for (const lot of row.lots)
        lines.push(
          '  - ' + text(lot.label) + ' / 繰越額 ' + lot.amountJpy.toLocaleString('ja-JP') + '円',
        )
    }
    for (const issue of carry.issues) lines.push('- 確認事項: ' + text(issue))
  }
  lines.push('', '## 種類別残高', '')
  for (const row of review.projection.accounts)
    lines.push(
      '### ' + text(row.name),
      '',
      '- 残高ID: ' +
        text(row.accountId) +
        ' / 制作物ID: ' +
        text(row.taxUnitId) +
        ' / 種類: ' +
        kinds[row.kind],
      '- 期首: ' + amount(row.opening),
      '- 増加: ' +
        yen(row.additionsJpy) +
        ' / 振替受入: ' +
        yen(row.transfersInJpy) +
        ' / 振替払出: ' +
        yen(row.transfersOutJpy),
      '- 費用化: ' + yen(row.expensesJpy) + ' / その他減少: ' + yen(row.reductionsJpy),
      '- 期末: ' + amount(row.closing),
      '',
    )
  if (!review.projection.accounts.length)
    lines.push('この年の残高は未登録です。残高なしと確認したことを意味しません。', '')
  lines.push(
    '## 増減・振替の記録',
    '',
    '固定した入力の全期間を記載します。当年の集計範囲は上の年次結果を参照してください。',
    '',
  )
  const movementNames = {
    addition: '増加',
    expense: '費用化',
    reduction: 'その他減少',
    transfer: '振替',
  }
  for (const row of review.snapshot.movements) {
    lines.push(
      '- ' +
        text(row.occurredOn) +
        ' / ' +
        movementNames[row.kind] +
        ' / ' +
        row.amountJpy +
        '円 / ID: ' +
        text(row.id),
      '  - 対象: ' +
        (row.kind === 'transfer'
          ? text(row.fromAccountId) + ' → ' + text(row.toAccountId)
          : text(row.accountId)),
      '  - 理由: ' + text(row.reason),
      '  - 判断ID: ' + text(row.decisionId) + ' / 根拠参照: ' + row.sourceIds.map(text).join('、'),
    )
    for (const link of row.balanceAllocations ?? []) {
      lines.push(
        '  - 残高対応元: ' +
          (link.sourceKind === 'opening' ? '期首' : '増加・振替受入') +
          ' / ' +
          text(link.sourceId) +
          ' / 使用額 ' +
          link.amountJpy +
          '円',
      )
      if (link.costAllocations !== undefined) {
        lines.push('    - 原価内訳: 明示指定（未指定の残りは原価未追跡）')
        for (const lot of link.costAllocations)
          lines.push(
            '    - ' + text(costLotLabel(lot, descriptions)) + ' / 使用額 ' + lot.amountJpy + '円',
          )
      }
    }
    if (row.kind === 'addition')
      for (const link of row.costAllocations ?? [])
        lines.push(
          '  - 費用配分との対応: ' +
            link.costYear +
            '年 / ' +
            text(link.contributionId) +
            ' / ' +
            link.amountJpy +
            '円',
        )
  }
  lines.push('', '## 残高移動の対応元の照合', '')
  const flow = review.materials?.balanceFlowCheck
  if (!flow) lines.push('この保存版には照合結果が未収録です。現在の入力から再計算・補完しません。')
  else {
    const yen = (value: number | null) =>
      value === null ? '照合不能' : value.toLocaleString('ja-JP') + '円'
    lines.push(
      '対象年: ' + flow.year + ' / 計算版: ' + text(flow.engineVersion),
      '状態: ' +
        {
          consistent: '記録した対応に不整合なし',
          incomplete: '未対応額あり',
          invalid: '不整合あり',
        }[flow.status],
      '残高段階間の明示的な対応の照合です。期首の原価内訳・税務条件は検証せず、複数原価の一部消費の内訳を推測しません。',
    )
    for (const row of flow.uses)
      lines.push(
        '- 移動ID ' +
          text(row.movementId) +
          ': 移動額 ' +
          yen(row.amountJpy) +
          ' / 対応額 ' +
          yen(row.linkedJpy) +
          ' / 未対応額 ' +
          yen(row.unlinkedJpy),
      )
    for (const source of flow.sources)
      lines.push(
        '- ' +
          text(
            review.snapshot.accounts.find((row) => row.id === source.accountId)?.name ||
              '名称未収録',
          ) +
          ' / 残高ID ' +
          text(source.accountId) +
          ' / ' +
          (source.sourceKind === 'opening' ? '期首' : '増加・振替受入') +
          ' / 対応元ID ' +
          text(source.sourceId) +
          ' / 元額 ' +
          yen(source.amountJpy) +
          ' / 使用額 ' +
          yen(source.claimedJpy) +
          ' / 残り ' +
          yen(source.remainingJpy),
      )
    for (const issue of flow.issues)
      lines.push('- 確認事項: ' + text(issue.movementId) + ' / ' + text(issue.message))
  }
  lines.push('', '## 残高から元費用への追跡', '')
  const trace = review.materials?.balanceLotTrace
  if (!trace) lines.push('この保存版には原価追跡が未収録です。現在の入力から補完しません。')
  else {
    const yen = (n: number | null) => (n === null ? '内訳未確定' : n.toLocaleString('ja-JP') + '円')
    lines.push(
      '対象年: ' + trace.year + ' / 計算版: ' + text(trace.engineVersion),
      '状態: ' +
        {
          consistent: '記録範囲の原価内訳を追跡',
          incomplete: '原価未追跡あり',
          invalid: '不整合のため追跡不可',
        }[trace.status],
      '明示された原価内訳と、一意に決まる単一原価の一部使用・内訳全体の移動を追跡します。未指定の混在原価・期首の原価由来・税務上の扱いは自動確定しません。段階ごとの金額を足し合わせないでください。',
    )
    for (const row of trace.movements) {
      lines.push(
        '- 移動ID ' +
          text(row.movementId) +
          ' / 移動額 ' +
          yen(row.amountJpy) +
          ' / 原価未追跡 ' +
          yen(row.untracedJpy),
      )
      for (const lot of row.lots)
        lines.push('  - ' + text(costLotLabel(lot, descriptions)) + ' / ' + yen(lot.amountJpy))
    }
    for (const row of trace.remaining) {
      lines.push(
        '- ' +
          (row.sourceKind === 'opening' ? '期首' : '増加・振替受入') +
          ' / 対応元ID ' +
          text(row.sourceId) +
          ' / 残高ID ' +
          text(row.accountId) +
          ' / 残額 ' +
          yen(row.amountJpy) +
          ' / 原価未追跡 ' +
          yen(row.untracedJpy),
      )
      for (const lot of row.lots)
        lines.push(
          '  - ' +
            text(costLotLabel(lot, descriptions)) +
            ' / 受入時 ' +
            yen(lot.amountJpy) +
            ' / 残り ' +
            yen(lot.remainingJpy),
        )
    }
    for (const issue of trace.issues)
      lines.push('- 確認事項: ' + text(issue.movementId) + ' / ' + text(issue.message))
  }
  if (review.materials?.costLinks) {
    const check = review.materials.costLinks.check
    lines.push(
      '',
      '## 費用と残高増加の金額照合',
      '',
      '状態: ' + check.status,
      '増加額の費用配分への対応だけを確認します。期首の由来・減少後の個別原価・税務条件の確認ではありません。',
    )
    for (const row of check.additions)
      lines.push(
        '- ' +
          text(row.movementId) +
          ': 増加 ' +
          row.amountJpy +
          '円 / 対応 ' +
          row.linkedJpy +
          '円 / 未対応 ' +
          row.unlinkedJpy +
          '円',
      )
    for (const row of check.contributions)
      lines.push(
        '- ' +
          row.costYear +
          '年 / ' +
          text(row.contributionId) +
          ': 配分 ' +
          row.availableJpy +
          '円 / 指定対応 ' +
          (row.claimedJpy ?? '整数範囲外') +
          ' / 未使用 ' +
          (row.remainingJpy ?? '上限超過・未算定') +
          ' / 増加記録 ' +
          row.movementIds.map(text).join('、'),
      )
    for (const issue of check.issues)
      lines.push('- 確認事項: ' + text(issue.movementId) + ' / ' + text(issue.message))
  }
  lines.push('', '## 未判断・確認待ち', '')
  if (!review.projection.pendingDecisions.length)
    lines.push(
      'この保存版の年次結果に未判断の登録はありません。すべての費用の確認完了を意味しません。',
    )
  for (const row of review.projection.pendingDecisions)
    lines.push(
      '- ' +
        text(row.id) +
        ' / ' +
        row.taxYear +
        '年 / ' +
        amount(row.amount) +
        ' / ' +
        row.reasons.map(text).join('、'),
    )
  const resolved = review.snapshot.pendingDecisions.filter(
    (row) =>
      row.resolution && row.resolution.taxYear <= review.year && consultationResolutionMatches(row),
  )
  lines.push('', '## 確認事項に対する相談回答', '')
  for (const pending of review.snapshot.pendingDecisions) {
    if (
      pending.resolution &&
      pending.resolution.taxYear <= review.year &&
      !consultationResolutionMatches(pending)
    )
      lines.push(
        '- 確認事項 ' +
          text(pending.id) +
          '：解消時の問い・対象額・回答・判断の対応が未記録または現在と異なるため、解消の再確認が必要です。',
      )
  }
  let answerCount = 0
  for (const pending of review.snapshot.pendingDecisions) {
    for (const answer of pending.answers ?? []) {
      if (answer.taxYear > review.year) continue
      answerCount++
      lines.push(
        '- 確認事項 ' +
          text(pending.id) +
          ' / 制作物 ' +
          text(pending.taxUnitId) +
          ' / 元の問い: ' +
          pending.reasons.map(text).join('、'),
        '  - 回答ID ' +
          text(answer.id) +
          ' / ' +
          (answer.kind === 'fact' ? '事実の回答' : '方法の回答') +
          ' / 対象年 ' +
          answer.taxYear +
          ' / 受領日 ' +
          text(answer.receivedOn),
        '  - 確認先・根拠: ' + text(answer.source),
        '  - 回答内容: ' + text(answer.answer),
      )
    }
  }
  if (!answerCount)
    lines.push('この対象年までの回答は未収録です。相談不要・確認完了の意味ではありません。')
  lines.push(
    '回答の登録だけでは残高や扱いを変更しません。解消した項目は、解消の判断IDと理由を参照してください。',
  )
  if (resolved.length) {
    lines.push('', '## 解消した確認事項', '')
    for (const row of resolved)
      lines.push(
        '- ' +
          text(row.id) +
          ' / 元の問い: ' +
          row.reasons.map(text).join('、') +
          ' / 解消年: ' +
          row.resolution!.taxYear +
          ' / 判断: ' +
          text(row.resolution!.decisionId) +
          ' / 理由: ' +
          text(row.resolution!.reason),
      )
  }
  if (review.materials) {
    const material = review.materials
    lines.push('', '## 固定した直接費の制作物別配分', '')
    for (const cost of material.planning.directCosts) {
      if (!cost.incurredOn.startsWith(review.year + '-') || cost.targets === undefined) continue
      lines.push(
        `- ${text(cost.incurredOn)} / ${text(cost.costType)} / 費用ID ${text(cost.id)} / メモ ${text(cost.note ?? '')}`,
      )
      for (const target of cost.targets)
        lines.push(
          `  - ${text(material.planning.taxUnits.find((unit) => unit.id === target.taxUnitId)?.name || '名称未収録')} / 制作物ID ${text(target.taxUnitId)} / ${target.shareBps === null ? '割合未確認' : target.shareBps / 100 + '%'}`,
        )
      lines.push('  - 未確認の割合は推定せず、残額は未配分。金額は固定した費用明細を参照。')
    }
    lines.push('', '## 固定した自宅費用の制作物別配分', '')
    for (const cost of material.planning.homeCosts) {
      if (!cost.month.startsWith(review.year + '-') || cost.targets === undefined) continue
      lines.push(
        `- ${text(cost.month)} / ${text(cost.category)} / 費用ID ${text(cost.id)} / 業務割合 ${cost.businessUseRatio * 100}% / 根拠 ${text(cost.basis)} / 理由 ${text(cost.rationale)}`,
      )
      for (const target of cost.targets)
        lines.push(
          `  - ${text(material.planning.taxUnits.find((unit) => unit.id === target.taxUnitId)?.name || '名称未収録')} / 制作物ID ${text(target.taxUnitId)} / 業務分の ${target.shareBps === null ? '割合未確認' : target.shareBps / 100 + '%'}`,
        )
      lines.push(
        '  - 未確認の割合は推定せず、残りの業務額は未配分として保持。金額は固定した費用明細を参照。',
      )
    }
    lines.push('', '## 固定した設備の制作物別配分', '')
    for (const method of material.planning.equipmentMethods ?? []) {
      if (method.taxYear !== review.year || method.allocation?.targets === undefined) continue
      lines.push(
        `- ${text(material.planning.equipment.find((item) => item.id === method.equipmentId)?.name || '名称未収録')} / 設備ID ${text(method.equipmentId)} / ${method.taxYear}年 / 業務割合 ${method.allocation.businessUseRatio === null ? '未確認' : method.allocation.businessUseRatio * 100 + '%'} / 根拠 ${text(method.allocation.reason)}`,
      )
      for (const target of method.allocation.targets)
        lines.push(
          `  - ${text(material.planning.taxUnits.find((item) => item.id === target.taxUnitId)?.name || '名称未収録')} / 制作物ID ${text(target.taxUnitId)} / 業務分の ${target.shareBps === null ? '割合未確認' : target.shareBps / 100 + '%'}`,
        )
      lines.push(
        '  - 空欄の割合は未確認。配分されなかった業務額は未配分。円未満の調整と算定額は固定した費用明細を参照。',
      )
    }
    if (material.equipmentCarryCheck) {
      lines.push(
        '',
        '## 設備の前年残高との照合',
        '',
        '前年資料ID: ' + text(material.equipmentCarryCheck.previousReviewId ?? '未登録'),
      )
      for (const row of material.equipmentCarryCheck.rows)
        lines.push(
          `- 設備ID ${text(row.equipmentId)} / 入力 ${row.enteredJpy}円 / 前年計算 ${row.previousClosingJpy === null ? '未収録' : row.previousClosingJpy + '円'} / ${text(row.reason)}`,
        )
    }
    lines.push(
      '',
      '## 設備全体の年次計算',
      '',
      '業務割合を掛ける前の条件付き計算です。採用済みの税務残高ではなく、種類別残高へ加算しません。',
      '',
    )
    if (!material.equipmentCalculations)
      lines.push('この保存版に構造化した設備計算はありません。現在の入力から補完しません。')
    else if (!material.equipmentCalculations.length)
      lines.push('この年度の設備計算条件は未登録です。設備なしの確認を意味しません。')
    for (const row of material.equipmentCalculations ?? []) {
      const calculation = row.result?.calculation
      lines.push(
        `- 設備ID ${text(row.equipmentId)} / ${row.taxYear}年 / 条件ID ${text(row.methodRecordId)}`,
      )
      if (calculation)
        lines.push(
          `  - 設備全体の期首・当年取得基礎 ${calculation.openingBasisJpy}円 / 普通償却 ${calculation.depreciationJpy}円 / 期末 ${calculation.closingBasisJpy}円`,
        )
      else lines.push('  - 未算定')
      lines.push(
        '  - ' + [...row.inputIssues, ...(row.result?.reasons ?? [])].map(text).join(' / '),
      )
    }
    lines.push(
      '',
      '## 同時に固定した根拠資料',
      '',
      '- 料金・計画の版: ' + material.workspaceRevision,
      '- 時間帯: ' + text(material.timeZone),
      '- 資料作成方式: ' + text(material.engineVersion),
      '- 数値利用記録: ' + material.observations.length + '件（固定入力の全期間）',
      '- 直近の走査記録: ' + material.recentScans.length + '件（完全な走査履歴ではありません）',
      '- 税務適用条件の検証: 未完了',
      '',
      costProjectionMarkdown(material.costs, 'recorded'),
      '## 処理の判断記録',
      '',
    )
    for (const row of material.planning.decisions)
      lines.push(
        '- ' + text(row.id) + ' / ' + row.taxYear + '年 / 制作物ID: ' + text(row.taxUnitId),
        '  - 検討した扱い: ' +
          text(treatmentCandidateName(row.candidate)) +
          ' / 確認した扱い: ' +
          text(row.selectedCandidate ? treatmentCandidateName(row.selectedCandidate) : '未登録'),
        '  - 状態: ' + text(row.status) + ' / 確認日時: ' + text(row.confirmedAt ?? '未確認'),
        '  - 根拠・確認先: ' + text(row.reason ?? '未登録'),
      )
    lines.push(
      '',
      '## 年度別の費用項目の確認',
      '',
      '本人の記録です。費用の不存在や税務上の適用条件を検証したものではありません。',
      '',
    )
    for (const row of material.planning.costPresence ?? [])
      lines.push(
        '- ' +
          row.taxYear +
          '年 / ' +
          text(row.category) +
          ' / ' +
          (row.status === 'not-applicable' ? '該当なし' : '保留') +
          ' / 理由: ' +
          text(row.reason) +
          ' / 記録日時: ' +
          text(row.recordedAt) +
          ' / ID: ' +
          text(row.id),
      )
    if (!material.planning.costPresence?.length)
      lines.push('確認記録なし。該当なしを意味しません。')
    lines.push('', '## 固定した費用項目の年度別判定', '')
    if (material.costPresenceCheck) {
      lines.push('判定方式: ' + text(material.costPresenceCheck.engineVersion))
      for (const row of material.costPresenceCheck.items)
        lines.push(
          '- ' +
            row.taxYear +
            '年 / ' +
            text(row.label) +
            ' / ' +
            text(row.status) +
            ': ' +
            text(row.explanation) +
            ' / 対象記録: ' +
            row.recordIds.map(text).join('、'),
        )
    } else
      lines.push('この旧版または対象年には判定が含まれていません。現在の入力で補完していません。')
    lines.push('', '## 証拠の記録', '', '原本の所在やファイル本体は含みません。', '')
    for (const row of material.planning.evidence)
      lines.push('- ' + text(row.id) + ' / ' + text(row.evidenceType) + ' / ' + text(row.note))
    lines.push('', '## 固定時の参照確認', '')
    for (const issue of material.referenceCheck.issues)
      lines.push(
        '- ' + text(issue.recordId) + ' / ' + text(issue.referenceId) + ': ' + text(issue.message),
      )
    if (!material.referenceCheck.issues.length)
      lines.push(
        '参照の不一致は記録されていません。根拠の内容・適用条件を検証したことを意味しません。',
      )
  } else
    lines.push(
      '',
      '## この旧版に含まれない資料',
      '',
      'この版は残高のみを保存しています。当時の費用・判断・利用量は含まれません。現在の資料で補完していません。',
    )
  const json = reviewExportJson(review)
  let longest = 0
  for (const match of json.matchAll(/`+/g)) longest = Math.max(longest, match[0].length)
  const fence = '`'.repeat(Math.max(3, longest + 1))
  lines.push(
    '',
    '## 完全な保存データ（JSON）',
    '',
    '上の説明に加えて、全入力・計算結果・参照を省略せず添付します。自由記述に含まれる情報は自動匿名化していません。',
    '',
    fence + 'json',
    json.trimEnd(),
    fence,
    '',
  )
  return lines.join('\n')
}
