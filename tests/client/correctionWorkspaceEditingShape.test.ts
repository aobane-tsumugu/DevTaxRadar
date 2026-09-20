import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import { z } from 'zod'
import { editingShape } from '../../src/client/workspaceRecovery'
import { costTreatmentFactsSchema } from '../../src/planning/costTreatmentFactsSchema'

/** Importing workspaceRecovery itself exercises the real planning/configuration schemas. */
describe('C04 existing wizard recovery remains usable with guarded extension schemas', () => {
  it('preserves a production validation pipeline rather than failing at module evaluation', () => {
    assert.equal(editingShape(costTreatmentFactsSchema), costTreatmentFactsSchema)
    assert.doesNotThrow(() => editingShape(costTreatmentFactsSchema).parse([]))
    assert.throws(() => editingShape(costTreatmentFactsSchema).parse([{ id: 'invalid' }]))
  })
  it('keeps a custom guarded value guarded', () => {
    const source = z.custom<string>((value) => value === 'checked')
    assert.equal(editingShape(source), source)
    assert.equal(editingShape(source).parse('checked'), 'checked')
    assert.throws(() => editingShape(source).parse('untrusted'))
  })
  it('retains unfinished wizard decision numbers and text through unions and records', () => {
    const schema = z.object({ year: z.number().int().min(2000), name: z.string().min(1),
      flags: z.record(z.string(), z.union([z.number().int(), z.null()])) }).strict()
    const draft = { year: NaN, name: '', flags: { partiallyEntered: NaN, unknown: null } }
    assert.ok(Number.isNaN((editingShape(schema).parse(draft) as typeof draft).year))
    assert.throws(() => schema.parse(draft))
    assert.throws(() => editingShape(schema).parse({ ...draft, unexpected: true }))
  })
})
