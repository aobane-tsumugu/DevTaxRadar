import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import BalanceFlowPanel from '../../src/client/pages/BalanceFlowPanel'
import type { BalanceSnapshot } from '../../src/accounting/types'
import type { BalanceFlowCheck } from '../../src/core/balanceFlowLinks'

it('shows frozen links, unavailable amounts and escaped historical names without reconstructing missing checks', () => {
  const snapshot: BalanceSnapshot = {
    version: 1,
    accounts: [
      {
        id: 'a',
        taxUnitId: 'u',
        name: '当時の残高<img>',
        kind: 'asset',
        openingYear: 2026,
        opening: { status: 'unknown', amountJpy: null, reasons: ['未確認'] },
      },
    ],
    pendingDecisions: [],
    movements: [
      {
        id: 'expense',
        kind: 'expense',
        accountId: 'a',
        occurredOn: '2026-07-01',
        amountJpy: 100,
        sourceIds: ['e'],
        decisionId: 'd',
        reason: '確認',
        balanceAllocations: [{ sourceKind: 'opening', sourceId: 'a', amountJpy: 100 }],
      },
    ],
  }
  const check: BalanceFlowCheck = {
    engineVersion: 'balance-flow-links/1',
    year: 2026,
    scope: 'recorded-balance-flows',
    status: 'invalid',
    sources: [
      {
        sourceKind: 'opening',
        sourceId: 'a',
        accountId: 'a',
        availableOn: '2026-01-01',
        amountJpy: null,
        claimedJpy: 100,
        remainingJpy: null,
      },
    ],
    uses: [{ movementId: 'expense', amountJpy: 100, linkedJpy: 0, unlinkedJpy: 100 }],
    issues: [{ movementId: 'expense', message: '期首を確認してください' }],
  }
  const html = renderToStaticMarkup(<BalanceFlowPanel check={check} snapshot={snapshot} />)
  expect(html).toContain('修正するまで採用できません')
  expect(html).toContain('当時の残高&lt;img&gt;')
  expect(html).not.toContain('<img>')
  expect(html).toContain('元額 照合不能 / 使用額 100円 / 残り 照合不能')
  expect(html).toContain('移動額 100円 / 対応額 0円 / 未対応額 100円')
  expect(html).toContain('期首 / 対応元ID a / 100円')
  expect(renderToStaticMarkup(<BalanceFlowPanel snapshot={snapshot} />)).toContain(
    '現在の入力から補完しません',
  )
})
