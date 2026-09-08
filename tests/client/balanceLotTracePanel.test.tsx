import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import BalanceLotTracePanel from '../../src/client/pages/BalanceLotTracePanel'

describe('frozen balance lot display', () => {
  it('distinguishes missing results, unknown composition, known zero and escaped IDs', () => {
    expect(renderToStaticMarkup(<BalanceLotTracePanel />)).toContain('未収録')
    const html = renderToStaticMarkup(
      <BalanceLotTracePanel
        trace={{
          engineVersion: 'balance-lot-trace/1',
          year: 2026,
          scope: 'uniquely-determined-cost-lots',
          status: 'incomplete',
          movements: [{ movementId: '<script>', amountJpy: 40, lots: [], untracedJpy: 40 }],
          remaining: [
            {
              sourceKind: 'movement',
              sourceId: 't',
              accountId: 'a',
              amountJpy: 60,
              lots: [{ costYear: 2026, contributionId: 'c', amountJpy: 60, remainingJpy: null }],
              untracedJpy: null,
            },
            {
              sourceKind: 'opening',
              sourceId: 'a',
              accountId: 'a',
              amountJpy: 0,
              lots: [],
              untracedJpy: 0,
            },
          ],
          issues: [],
        }}
      />,
    )
    expect(html).toContain('内訳未確定')
    expect(html).toContain('原価未追跡 0円')
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('<script>')
  })
})
