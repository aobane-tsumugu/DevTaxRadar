// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ObservationRecordsPanel from '../../src/client/pages/ObservationRecordsPanel'
import type {
  ObservationRecord,
  ObservationRecordSummary,
} from '../../src/accounting/observationRecord'
import { emptyPlanningSnapshot } from '../../src/planning/types'
import { projectWorkspaceCosts } from '../../src/core/workspaceCosts'

vi.mock('../../src/client/dashboard', () => ({ isLocalRuntime: () => true }))
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const summary: ObservationRecordSummary = {
  id: 'synthetic-record',
  createdAt: '2026-09-01T00:00:00Z',
  reason: 'after-scan',
  year: 2026,
  workspaceRevision: 1,
  observationCount: 2,
  deferredPrevious: 0,
  deferredMissing: 0,
  incompleteSources: 1,
}
const planning = emptyPlanningSnapshot(2026)
const record: ObservationRecord = {
  id: summary.id,
  createdAt: summary.createdAt,
  reason: summary.reason,
  payload: {
    version: 1,
    kind: 'numeric-observation',
    datasetId: 'synthetic-dataset',
    timeZone: 'UTC',
    scanTimeZones: {},
    workspace: {
      revision: 1,
      configuration: {
        charges: { claude: 0, codex: 0 },
        contracts: { claude: {}, codex: {} },
        monthlyCharges: [],
        chargePeriods: [],
        unobservedRatio: null,
      },
      planning,
    },
    observations: [],
    sources: [{ sourceId: 'local-codex', provider: 'codex', enabled: true }],
    captures: [
      {
        sourceId: 'local-codex',
        provider: 'codex',
        checkedAt: summary.createdAt,
        timeZone: 'unknown',
        mode: 'full',
        status: 'complete',
        observationsHash: 'a'.repeat(64),
        accountCoverage: 'unknown',
        matchesCurrentValues: true,
        files: [
          {
            fileKey: 'a'.repeat(64),
            state: 'missing-retained',
            adapter: 'codex',
            schemaVersion: '1',
            eventCount: 1,
          },
          {
            fileKey: 'b'.repeat(64),
            state: 'unverified-retained',
            adapter: 'legacy-summary',
            schemaVersion: '1',
            eventCount: 0,
          },
        ],
      },
    ],
    costs: projectWorkspaceCosts(planning, []),
    originalFilesIncluded: false,
    taxTreatmentAdopted: false,
  },
}

describe('retained numerical observation display', () => {
  let root: Root | undefined
  let container: HTMLDivElement
  afterEach(async () => {
    if (root) await act(async () => root!.unmount())
    root = undefined
    container?.remove()
    vi.unstubAllGlobals()
  })

  async function render(row: ObservationRecordSummary) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => ({
        ok: true,
        json: async () =>
          url.includes('?offset=') ? { records: [row], unreadable: 0 } : { record },
      })),
    )
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => root!.render(<ObservationRecordsPanel />))
    await click('保存した数値記録を表示')
  }
  async function click(label: string) {
    const button = [...container.querySelectorAll('button')].find(
      (value) => value.textContent === label,
    )!
    await act(async () => button.click())
  }

  it('defaults new counts to zero for older listing responses', async () => {
    await render(summary)
    expect(container.textContent).toContain('原本が見つからず数値を保持したファイル 0件')
    expect(container.textContent).toContain('原本との対応未確認で数値を保持したセッション 0件')
    expect(container.textContent).not.toContain('undefined')
  })

  it('shows retained counts and saved-time warnings before the personal JSON export', async () => {
    await render({ ...summary, missingRetained: 1, unverifiedRetained: 1 })
    expect(container.textContent).toContain('原本が見つからず数値を保持したファイル 1件')
    expect(container.textContent).toContain('原本との対応未確認で数値を保持したセッション 1件')
    await click('この数値記録を開く')
    const warnings = container.querySelector('[aria-label="保存時点の取得状態"]')!.textContent
    expect(warnings).toContain('新しく確認した利用量ではありません')
    expect(warnings).toContain('削除されたのか、まだ見えていないのかは判定できず')
    expect(warnings).toContain('取り込み前に削除された履歴は復元できません')
    const preview = JSON.parse(container.querySelector('pre')!.textContent!) as ObservationRecord
    expect(preview.payload.captures[0]!.files.map((file) => file.state)).toEqual([
      'missing-retained',
      'unverified-retained',
    ])
    expect(preview.payload.originalFilesIncluded).toBe(false)
  })
})
