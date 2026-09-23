import type { BalanceReview } from '../accounting/balanceWorkspace.js'

export function softwareMethodMarkdown(review: BalanceReview): string {
  const accounts = review.snapshot.accounts.filter((account) => account.softwareMethod)
  if (!accounts.length) return ''
  const text = (value: string) =>
    value.replace(/[\r\n\t]/g, ' ').replace(/([\\`*_[\]<>#|])/g, '\\$1')
  const amount = (value: number) => value.toLocaleString('ja-JP') + '円'
  const labels = {
    'straight-line': '通常の定額法',
    'immediate-expense': '供用年の全額費用',
    'three-year-pool': '3年一括償却',
    'blue-special': '青色申告の少額資産特例',
  }
  const lines = [
    '## 保存したソフトウェアの方法と年額',
    '',
    '以下は保存時の方法と実際に記録された費用化です。新しい入力・計算規則で再計算せず、未記録の年額を補完しません。',
    '',
  ]
  for (const account of accounts) {
    const selection = account.softwareMethod!,
      origin = review.snapshot.movements.find((row) => row.id === selection.acquisitionMovementId)
    lines.push(
      '### ' + text(account.name),
      '',
      '- 方法: ' + labels[selection.method] + ' / 計算版: ' + text(selection.engineVersion),
      '- 供用日: ' +
        text(selection.usedOn) +
        ' / 耐用年数: ' +
        (selection.usefulLifeYears ?? 'この方法では使用しない'),
      '- 取得価額: ' +
        (origin ? amount(origin.amountJpy) : '対応元未収録') +
        ' / 原価振替ID: ' +
        text(selection.acquisitionMovementId),
      '- 確認理由: ' + text(selection.reason),
      '- 根拠ID: ' + selection.evidenceIds.map(text).join('、'),
      '- 原価内訳への配分: 残額比例・最大剰余法（同率は原価ID順）。取得額と年額を重ねて加算しない。',
    )
    if (selection.blueSpecial)
      lines.push(
        '- 青色特例の確認条件: 事業所得・青色申告 / 他資産使用済額 ' +
          amount(selection.blueSpecial.annualSpecialUsedJpy) +
          ' / 事業月数 ' +
          selection.blueSpecial.businessMonths +
          ' / 明細準備済み / 規則版 ' +
          text(selection.blueSpecial.ruleVersion),
      )
    if (selection.ordinaryThroughYear !== undefined)
      lines.push(
        '- 通常計算の最終年: ' +
          selection.ordinaryThroughYear +
          ' / 以後の別処理: ' +
          text(selection.terminationReason ?? '未収録'),
      )
    const entries = review.snapshot.movements.filter(
      (row) =>
        row.kind === 'expense' &&
        row.accountId === account.id &&
        row.softwareExpense &&
        row.softwareExpense.year <= review.year,
    )
    for (const entry of entries) {
      lines.push(
        '- 記録した年額: ' +
          entry.softwareExpense!.year +
          '年 ' +
          amount(entry.amountJpy) +
          ' / 移動ID: ' +
          text(entry.id) +
          ' / 判断ID: ' +
          text(entry.decisionId),
      )
      for (const link of entry.balanceAllocations ?? [])
        for (const lot of link.costAllocations ?? [])
          lines.push(
            '  - 原価: ' +
              lot.costYear +
              '年 / ' +
              text(lot.contributionId) +
              ' / 使用額 ' +
              amount(lot.amountJpy),
          )
    }
    if (!entries.length)
      lines.push('- 対象年までの方法由来の費用化は未収録です。0円や確認済みに補完しません。')
    lines.push('')
  }
  return lines.join('\n')
}
