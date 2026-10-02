// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import App from '../../src/App'
vi.mock('../../src/client/dashboard', async (original) => {
  const actual = await original<typeof import('../../src/client/dashboard')>()
  return {
    ...actual,
    isLocalRuntime: () => false,
    getDashboardData: async () => actual.demoDashboard,
  }
})
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true
it('keeps timeline navigation keyboard-accessible and restores pages with browser Back/Forward', async () => {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const navigate = async (text: string) => {
    await act(async () =>
      [...container.querySelectorAll<HTMLButtonElement>('.nav-item')]
        .find((button) => button.textContent?.includes(text))!
        .click(),
    )
  }
  const travel = async (direction: 'back' | 'forward') => {
    await act(async () => {
      const changed = new Promise<void>((resolve) =>
        window.addEventListener('popstate', () => resolve(), { once: true }),
      )
      window.history[direction]()
      await changed
    })
  }
  try {
    await act(async () => root.render(<App />))
    await navigate('作っているものの歩み')
    expect(container.querySelector('.product-timeline')).not.toBeNull()
    const before = window.history.length
    await navigate('作っているものの歩み')
    expect(window.history.length).toBe(before)
    await navigate('今年どうなる？')
    expect(container.querySelector('.product-timeline')).toBeNull()
    await travel('back')
    expect(container.querySelector('.product-timeline')).not.toBeNull()
    await travel('forward')
    expect(container.querySelector('.product-timeline')).toBeNull()
    expect(
      [...container.querySelectorAll('.nav-item')].every((element) => element.tagName === 'BUTTON'),
    ).toBe(true)
  } finally {
    await act(async () => root.unmount())
    container.remove()
  }
})
