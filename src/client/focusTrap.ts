const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'details > summary',
  '[tabindex]:not([tabindex="-1"])',
].join(', ')

// jsdom has no layout engine, so offsetParent is always null there and cannot be
// used to decide visibility. Walk the ancestor chain instead: it gives the same
// answer in the browser and under test, and it catches the case that actually
// occurs in this modal — inputs inside a closed <details> are still matched by
// the selector but cannot receive focus.
function isHidden(element: HTMLElement, container: HTMLElement): boolean {
  let node: HTMLElement | null = element
  while (node) {
    if (node.hidden || node.style.display === 'none' || node.style.visibility === 'hidden') {
      return true
    }
    if (node instanceof HTMLDetailsElement && !node.open) {
      // A closed <details> still exposes its own summary.
      const summary = node.querySelector('summary')
      if (element !== summary) return true
    }
    if (node === container) return false
    node = node.parentElement
  }
  return false
}

// The spec requires querySelectorAll to return results in document order, but
// jsdom's selector engine (@asamuzakjp/dom-selector, since jsdom 29) does not
// preserve that order once a combinator selector (`details > summary`) is
// mixed into a selector list alongside simple selectors — verified directly
// against jsdom outside of this module. Sorting explicitly makes the result
// correct under test and is a no-op in real browsers, which are already
// spec-compliant.
function compareDocumentOrder(a: HTMLElement, b: HTMLElement): number {
  const position = a.compareDocumentPosition(b)
  if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1
  if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1
  return 0
}

export function focusableElements(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)]
    .filter((element) => !isHidden(element, container))
    .sort(compareDocumentOrder)
}

export type TrapAction = 'close' | 'wrap-forward' | 'wrap-backward' | 'ignore'

export function trapAction(
  key: string,
  shiftKey: boolean,
  container: HTMLElement,
  activeElement: Element | null,
): TrapAction {
  if (key === 'Escape') return 'close'
  if (key !== 'Tab') return 'ignore'

  const elements = focusableElements(container)
  if (elements.length === 0) return 'ignore'

  const inside = activeElement instanceof HTMLElement && container.contains(activeElement)
  if (!inside) return shiftKey ? 'wrap-backward' : 'wrap-forward'

  if (!shiftKey && activeElement === elements.at(-1)) return 'wrap-forward'
  if (shiftKey && activeElement === elements[0]) return 'wrap-backward'
  return 'ignore'
}
