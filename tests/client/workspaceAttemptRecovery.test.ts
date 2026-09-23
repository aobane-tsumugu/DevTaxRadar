// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import {
  decodeWorkspaceAttempt,
  encodeWorkspaceAttempt,
  retainWorkspaceAttempt,
  writeWorkspaceAttempt,
  type WorkspaceAttempt,
} from '../../src/client/workspaceAttempt'
import { emptyPlanningSnapshot } from '../../src/planning/types'

function fixture(): WorkspaceAttempt {
  const configuration = {
    charges: { claude: 0, codex: 0 },
    monthlyCharges: [],
    contracts: { claude: {}, codex: {} },
    chargePeriods: [],
    unobservedRatio: null,
  }
  const planning = emptyPlanningSnapshot(2026)
  return {
    version: 1,
    datasetId: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    base: { revision: 1, configuration, planning },
    request: { requestId: crypto.randomUUID(), expectedRevision: 1, configuration, planning },
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
  localStorage.clear()
})

it('round-trips a valid recovery record larger than the old two-million-code-unit limit', () => {
  const record = fixture()
  record.base.planning.evidence = Array.from({ length: 270 }, (_, index) => ({
    id: `receipt-${index}`,
    evidenceType: 'receipt',
    strength: 'external',
    recordedAt: '2026-07-01T00:00:00Z',
    note: 'a'.repeat(4000),
  }))
  record.request.planning = structuredClone(record.base.planning)
  const raw = encodeWorkspaceAttempt(record)
  expect(raw.length).toBeGreaterThan(2_000_000)
  expect(decodeWorkspaceAttempt(raw)).toEqual(record)
})

it('does not turn a changed request ID payload into a quota fallback', () => {
  const record = fixture()
  writeWorkspaceAttempt(localStorage, record)
  const confirm = vi.spyOn(window, 'confirm')
  expect(() =>
    retainWorkspaceAttempt({
      ...record,
      request: { ...record.request, previewHash: 'b'.repeat(64) },
    }),
  ).toThrow('同じ保存要求')
  expect(confirm).not.toHaveBeenCalled()
})

it.each([true, false])(
  'offers a private file copy only on quota failure; confirm=%s',
  (accepted) => {
    vi.useFakeTimers()
    const record = fixture()
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError')
    })
    const createObjectURL = vi.fn(() => 'blob:private-recovery')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(accepted)
    if (accepted) expect(retainWorkspaceAttempt(record)).toBeNull()
    else expect(() => retainWorkspaceAttempt(record)).toThrow('送信していません')
    expect(createObjectURL).toHaveBeenCalledOnce()
    expect(click).toHaveBeenCalledOnce()
    expect(confirm).toHaveBeenCalledOnce()
    expect(localStorage.length).toBe(0)
    vi.runOnlyPendingTimers()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:private-recovery')
  },
)
