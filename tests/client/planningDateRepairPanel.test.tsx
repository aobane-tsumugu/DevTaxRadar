// @vitest-environment jsdom
import { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it } from 'vitest'
import PlanningDateRepairPanel from '../../src/client/pages/PlanningDateRepairPanel'
import { emptyPlanningSnapshot } from '../../src/planning/types'
import { planningDateIssues, repairPlanningDate } from '../../src/planning/calendarDates'

it('shows the original invalid date and applies a valid correction without changing unrelated input', async () => {
  const initial = emptyPlanningSnapshot(2026)
  initial.profile.activityStartedOn = '2026-02-30'
  initial.profile.notes = '保持する入力'
  let latest = initial
  function Harness() {
    const [planning, setPlanning] = useState(initial)
    latest = planning
    return <PlanningDateRepairPanel planning={planning} onChange={setPlanning} />
  }
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  try {
    await act(async () => root.render(<Harness />))
    expect(container.textContent).toContain('2026-02-30')
    const input = container.querySelector('input')!
    const apply = container.querySelector('button')!
    expect(apply.disabled).toBe(true)
    await act(async () => {
      input.value = '2024-02-29'
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(latest.profile.activityStartedOn).toBe('2026-02-30')
    await act(async () => apply.click())
    expect(latest.profile.activityStartedOn).toBe('2024-02-29')
    expect(latest.profile.notes).toBe('保持する入力')
    expect(container.textContent).toBe('')
    expect(initial.profile.activityStartedOn).toBe('2026-02-30')
  } finally {
    await act(async () => root.unmount())
    container.remove()
  }
})

it('allows clearing an optional invalid date and refuses stale corrections', () => {
  const planning = emptyPlanningSnapshot(2026)
  planning.profile.activityStartedOn = '2026-02-30'
  const issue = planningDateIssues(planning)[0]!
  expect(repairPlanningDate(planning, issue, '').profile.activityStartedOn).toBeUndefined()
  expect(repairPlanningDate(planning, issue, '2026-02-29')).toBe(planning)
  const repaired = repairPlanningDate(planning, issue, '2026-03-01')
  expect(repairPlanningDate(repaired, issue, '2026-04-01')).toBe(repaired)
})
