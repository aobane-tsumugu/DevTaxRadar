import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import {
  balanceSnapshotSchema,
  balanceDraftSaveSchema,
} from '../../src/accounting/balanceSchema.js'
import { methodFixture, expenseInput } from '../core/helpers/softwareMethodFixture.js'
import { draftSoftwareYearExpense } from '../../src/core/softwareMethodDraft.js'

// Requires the actual lockfile Zod dependency; no substitute schema is used.
describe('software method fields at the existing HTTP input schema', () => {
  it('preserves every method and expense-provenance field through Zod', () => {
    const f = methodFixture(),
      posted = draftSoftwareYearExpense(f.snapshot, f.planning, f.costs, expenseInput(2026))
    assert.deepEqual(balanceSnapshotSchema.parse(posted), posted)
    const request = {
      expectedRevision: 1,
      requestId: expenseInput(2026).requestId,
      snapshot: posted,
    }
    assert.deepEqual(balanceDraftSaveSchema.parse(request), request)
  })
  it('rejects unsupported and malformed metadata instead of stripping it', () => {
    for (const value of [{}, false, 0, { version: 2 }]) {
      const f = methodFixture(),
        snapshot = structuredClone(f.snapshot) as any
      snapshot.accounts.find((a: { id: string }) => a.id === 'asset').softwareMethod = value
      assert.equal(balanceSnapshotSchema.safeParse(snapshot).success, false)
    }
  })
  it('keeps legacy omission and explicit method clearing distinct', () => {
    const f = methodFixture()
    const old = balanceSnapshotSchema.parse(f.unselected)
    assert.ok(
      !Object.hasOwn(
        old.accounts.find((a) => a.id === 'asset')!,
        'softwareMethod',
      ),
    )
    const clear = structuredClone(f.snapshot)
    clear.accounts.find((a) => a.id === 'asset')!.softwareMethod = null
    assert.equal(
      balanceSnapshotSchema.parse(clear).accounts.find((a) => a.id === 'asset')!.softwareMethod,
      null,
    )
  })
})
