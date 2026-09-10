import { expect, it } from 'vitest'
import { planningMarkdown } from '../../src/core/planningExport.js'
import { emptyPlanningSnapshot } from '../../src/planning/types.js'

it('shares one explanatory export, strips private locations and escapes document injection', () => {
  const planning = emptyPlanningSnapshot(2026)
  planning.profile.notes = '\n# fake heading\n<script>unsafe()</script>'
  planning.evidence = [{ id: 'e', evidenceType: 'receipt', strength: 'external', recordedAt: '2026-09-10T00:00:00Z', note: '残す説明', localReference: 'C:/PRIVATE_CANARY/receipt.pdf' }]
  const result = planningMarkdown(planning)
  expect(result).toContain('残す説明')
  expect(result).not.toContain('PRIVATE_CANARY')
  expect(result).not.toContain('\n# fake heading')
  expect(result).not.toContain('<script>')
  expect(planning.evidence[0]!.localReference).toContain('PRIVATE_CANARY')
})
it('distinguishes unknown money from a known zero and preserves the reason', () => {
  const planning = emptyPlanningSnapshot(2026)
  planning.directCosts = [
    { id: 'unknown', incurredOn: '2026-09-01', costType: 'other', amountJpy: null, unknownAmountReason: '請求待ち', directlyAttributable: true, treatment: 'direct', evidenceIds: [] },
    { id: 'zero', incurredOn: '2026-09-01', costType: 'other', amountJpy: 0, directlyAttributable: true, treatment: 'direct', evidenceIds: [] },
  ]
  const result = planningMarkdown(planning)
  expect(result).toContain('ID unknown / 原額 不明')
  expect(result).toContain('ID zero / 原額 0円')
  expect(result).toContain('請求待ち')
})
