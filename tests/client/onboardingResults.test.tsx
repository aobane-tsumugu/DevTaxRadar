// @vitest-environment jsdom

import { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { demoDashboard, demoPlanning } from '../../src/client/dashboard.ts'
import Onboarding from '../../src/client/pages/Onboarding.tsx'
import type { LocalConfiguration, RuntimeData } from '../../src/client/types.ts'

const configuration: LocalConfiguration = {
  charges: { claude: 0, codex: 0 },
  monthlyCharges: [],
  contracts: { claude: {}, codex: {} },
  chargePeriods: [
    {
      id: 'charge-preview',
      provider: 'claude',
      planName: 'Preview plan',
      serviceStartedOn: '2026-07-01',
      serviceEndedOn: '2026-07-31',
      amountJpy: 31_000,
    },
  ],
  unobservedRatio: 0,
}

const runtime = {
  providers: {
    claude: { detected: true },
    codex: { detected: false },
  },
  retention: { claude: {}, codex: {} },
} as RuntimeData

describe('onboarding result refresh', () => {
  let container: HTMLDivElement | undefined

  Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
    configurable: true,
    value: vi.fn(),
  })
  ;(
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true

  afterEach(() => {
    container?.remove()
    container = undefined
  })

  it('saves draft inputs before showing the recalculated filing scenarios', async () => {
    const savedConfiguration = vi.fn(async () => {})
    const savedPlanning = vi.fn(async (_planning: typeof demoPlanning) => {})

    function Harness() {
      const [step, setStep] = useState(3)
      const [data, setData] = useState({
        ...demoDashboard,
        meta: { ...demoDashboard.meta, source: 'local' as const },
      })
      return (
        <Onboarding
          step={step}
          data={data}
          runtime={runtime}
          runtimeLoading={false}
          historySources={[]}
          configuration={configuration}
          planning={demoPlanning}
          unassignedFolderCount={0}
          onStep={setStep}
          onScan={async () => ({
            completedAt: '2026-07-31T00:00:00.000Z',
            providers: {},
            sources: [],
          })}
          onSaveHistorySource={async () => {}}
          onTestHistorySource={async () => ({ availability: 'available', filesDiscovered: 0 })}
          onRemoveHistorySource={async () => {}}
          onSave={savedConfiguration}
          onSaveRetention={async (days) => ({ days })}
          onSavePlanning={async (planning) => {
            await savedPlanning(planning)
            setData((current) => ({
              ...current,
              months: [{ label: '2026年7月', current: 12_345, future: 18_000, review: 655 }],
            }))
          }}
          onClose={() => {}}
        />
      )
    }

    container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => root.render(<Harness />))

    const resultButton = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === '保存して結果を見る',
    )
    expect(resultButton).toBeTruthy()
    await act(async () => {
      resultButton!.click()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(savedConfiguration).toHaveBeenCalledOnce()
    expect(savedPlanning).toHaveBeenCalledOnce()
    expect(container.textContent).toContain('いまの整理結果です')
    expect(container.textContent).toContain('￥12,345')
    expect(container.textContent).toContain('￥18,000')
    expect(container.textContent).toContain('￥655')

    await act(async () => root.unmount())
  })
})
