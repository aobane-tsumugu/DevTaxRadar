// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { createFocusTrap, focusableElements, trapAction } from '../../src/client/focusTrap.ts'

function buildContainer(): HTMLElement {
  document.body.innerHTML = `
    <button id="outside">outside</button>
    <div id="modal">
      <button id="first">first</button>
      <input id="middle" />
      <button id="disabled" disabled>disabled</button>
      <a id="link" href="#x">link</a>
      <button id="last">last</button>
    </div>
  `
  return document.getElementById('modal') as HTMLElement
}

describe('focusableElements', () => {
  beforeEach(buildContainer)

  it('lists focusable descendants in document order and skips disabled ones', () => {
    const container = document.getElementById('modal') as HTMLElement
    expect(focusableElements(container).map((element) => element.id)).toEqual([
      'first',
      'middle',
      'link',
      'last',
    ])
  })

  it('skips elements hidden with display none', () => {
    const container = document.getElementById('modal') as HTMLElement
    const middle = document.getElementById('middle') as HTMLElement
    middle.style.display = 'none'
    expect(focusableElements(container).map((element) => element.id)).toEqual([
      'first',
      'link',
      'last',
    ])
  })

  it('skips inputs inside a closed details element but keeps its summary', () => {
    document.body.innerHTML = `
      <div id="modal">
        <button id="first">first</button>
        <details id="closed-details">
          <summary id="details-summary">summary</summary>
          <input id="inside-details" />
        </details>
        <button id="last">last</button>
      </div>
    `
    const container = document.getElementById('modal') as HTMLElement
    expect(focusableElements(container).map((element) => element.id)).toEqual([
      'first',
      'details-summary',
      'last',
    ])
  })
})

describe('trapAction', () => {
  beforeEach(buildContainer)

  it('asks to close on Escape', () => {
    const container = document.getElementById('modal') as HTMLElement
    expect(trapAction('Escape', false, container, null)).toBe('close')
  })

  it('wraps forward from the last element', () => {
    const container = document.getElementById('modal') as HTMLElement
    const last = document.getElementById('last')
    expect(trapAction('Tab', false, container, last)).toBe('wrap-forward')
  })

  it('wraps backward from the first element', () => {
    const container = document.getElementById('modal') as HTMLElement
    const first = document.getElementById('first')
    expect(trapAction('Tab', true, container, first)).toBe('wrap-backward')
  })

  it('pulls focus back when it escaped the container', () => {
    const container = document.getElementById('modal') as HTMLElement
    const outside = document.getElementById('outside')
    expect(trapAction('Tab', false, container, outside)).toBe('wrap-forward')
    expect(trapAction('Tab', true, container, outside)).toBe('wrap-backward')
  })

  it('leaves the middle of the sequence to the browser', () => {
    const container = document.getElementById('modal') as HTMLElement
    const middle = document.getElementById('middle')
    expect(trapAction('Tab', false, container, middle)).toBe('ignore')
    expect(trapAction('Enter', false, container, middle)).toBe('ignore')
  })
})

describe('createFocusTrap', () => {
  beforeEach(buildContainer)

  function press(key: string, shiftKey = false): void {
    document.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true }))
  }

  it('moves focus into the container when installed', () => {
    const container = document.getElementById('modal') as HTMLElement
    const teardown = createFocusTrap(container, () => {})
    expect(document.activeElement?.id).toBe('first')
    teardown()
  })

  it('calls onClose on Escape', () => {
    const container = document.getElementById('modal') as HTMLElement
    let closed = 0
    const teardown = createFocusTrap(container, () => {
      closed += 1
    })
    press('Escape')
    expect(closed).toBe(1)
    teardown()
  })

  it('wraps forward from the last element and backward from the first', () => {
    const container = document.getElementById('modal') as HTMLElement
    const teardown = createFocusTrap(container, () => {})

    document.getElementById('last')?.focus()
    press('Tab')
    expect(document.activeElement?.id).toBe('first')

    press('Tab', true)
    expect(document.activeElement?.id).toBe('last')
    teardown()
  })

  it('pulls focus back when it escaped to the page behind', () => {
    const container = document.getElementById('modal') as HTMLElement
    const teardown = createFocusTrap(container, () => {})

    document.getElementById('outside')?.focus()
    expect(document.activeElement?.id).toBe('outside')
    press('Tab')
    expect(document.activeElement?.id).toBe('first')
    teardown()
  })

  it('leaves the middle of the sequence to the browser', () => {
    const container = document.getElementById('modal') as HTMLElement
    const teardown = createFocusTrap(container, () => {})

    document.getElementById('middle')?.focus()
    press('Tab')
    expect(document.activeElement?.id).toBe('middle')
    teardown()
  })

  it('returns focus to the opener on teardown, not to wherever focus drifted', () => {
    const opener = document.getElementById('outside') as HTMLElement
    opener.focus()
    const container = document.getElementById('modal') as HTMLElement
    const teardown = createFocusTrap(container, () => {})

    document.getElementById('last')?.focus()
    teardown()

    expect(document.activeElement?.id).toBe('outside')
  })

  it('stops handling keys after teardown', () => {
    const container = document.getElementById('modal') as HTMLElement
    let closed = 0
    const teardown = createFocusTrap(container, () => {
      closed += 1
    })
    teardown()
    press('Escape')
    expect(closed).toBe(0)
  })
})
