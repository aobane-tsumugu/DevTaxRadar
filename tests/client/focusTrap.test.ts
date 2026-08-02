// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { focusableElements, trapAction } from '../../src/client/focusTrap.ts'

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
