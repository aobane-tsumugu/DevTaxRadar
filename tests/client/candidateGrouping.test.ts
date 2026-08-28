import { describe, expect, it } from 'vitest'

import {
  applyCandidateDestinations,
  candidateGroupByTaxUnit,
  destinationSummary,
  normalizedProductGroup,
} from '../../src/client/candidateGrouping.ts'
import { emptyPlanningSnapshot } from '../../src/planning/types.ts'

const candidates = [
  {
    name: 'Alpha folder',
    folder: 'Alpha folder',
    sessions: 5,
    projectKey: 'project_alpha_0001',
    firstObservedAt: '2026-02-03T10:00:00.000Z',
  },
  {
    name: 'Alpha support',
    folder: 'Alpha support',
    sessions: 9,
    projectKey: 'project_alpha_0002',
    firstObservedAt: '2026-03-04T10:00:00.000Z',
  },
  {
    name: 'Private lab',
    folder: 'Private lab',
    sessions: 2,
    projectKey: 'project_private_001',
    firstObservedMonth: '2026-04',
  },
]

describe('candidate grouping', () => {
  it('normalizes positive group numbers and rejects non-numeric groups', () => {
    expect(normalizedProductGroup('003')).toBe('3')
    expect(normalizedProductGroup('0')).toBeUndefined()
    expect(normalizedProductGroup('one')).toBeUndefined()
  })

  it('reserves generated group numbers before assigning arbitrary existing product ids', () => {
    const groups = candidateGroupByTaxUnit([
      {
        id: 'tax-unit-existing',
        name: 'Existing',
        unitType: 'new-software',
        usageMode: 'undecided',
        revenueModel: 'undecided',
        lifecycleStatus: 'developing',
      },
      {
        id: 'tax-unit-history-group-1',
        name: 'Generated',
        unitType: 'new-software',
        usageMode: 'undecided',
        revenueModel: 'undecided',
        lifecycleStatus: 'developing',
      },
    ])

    expect(groups.get('tax-unit-history-group-1')).toBe('1')
    expect(groups.get('tax-unit-existing')).toBe('2')
  })

  it('maps the same number to one product and maps private history without a product', () => {
    const result = applyCandidateDestinations(emptyPlanningSnapshot(2026), candidates, {
      project_alpha_0001: { kind: 'product', group: '1' },
      project_alpha_0002: { kind: 'product', group: '01' },
      project_private_001: { kind: 'private' },
    })

    expect(result.taxUnits).toHaveLength(1)
    expect(result.taxUnits[0]).toMatchObject({
      id: 'tax-unit-history-group-1',
      name: 'Alpha support',
    })
    expect(result.projectRules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          projectKey: 'project_alpha_0001',
          taxUnitId: 'tax-unit-history-group-1',
          classification: 'new-development',
        }),
        expect.objectContaining({
          projectKey: 'project_alpha_0002',
          taxUnitId: 'tax-unit-history-group-1',
          classification: 'new-development',
        }),
        expect.objectContaining({
          projectKey: 'project_private_001',
          classification: 'private',
        }),
      ]),
    )
    expect(
      result.projectRules.find((rule) => rule.projectKey === 'project_private_001'),
    ).not.toHaveProperty('taxUnitId')
  })

  it('preserves a later period rule when updating the default candidate assignment', () => {
    const snapshot = emptyPlanningSnapshot(2026)
    snapshot.projectRules.push({
      id: 'later-maintenance',
      projectKey: 'project_alpha_0001',
      effectiveFrom: '2026-07-01',
      classification: 'maintenance',
    })

    const result = applyCandidateDestinations(snapshot, candidates.slice(0, 1), {
      project_alpha_0001: { kind: 'product', group: '2' },
    })

    expect(result.projectRules).toHaveLength(2)
    expect(result.projectRules).toContainEqual(snapshot.projectRules[0])
  })

  it('reuses an existing product id when its numeric group is materialized', () => {
    const snapshot = emptyPlanningSnapshot(2026)
    snapshot.taxUnits.push({
      id: 'tax-unit-existing',
      name: 'Existing product',
      unitType: 'new-software',
      usageMode: 'undecided',
      revenueModel: 'undecided',
      lifecycleStatus: 'developing',
    })
    snapshot.projectRules.push({
      id: 'existing-rule',
      projectKey: 'project_alpha_0001',
      effectiveFrom: '2026-02-03',
      taxUnitId: 'tax-unit-existing',
      classification: 'new-development',
    })

    const result = applyCandidateDestinations(snapshot, candidates.slice(0, 1), {
      project_alpha_0001: {
        kind: 'product',
        group: '1',
        existingTaxUnitId: 'tax-unit-existing',
      },
    })

    expect(result.taxUnits).toHaveLength(1)
    expect(result.projectRules).toEqual([
      expect.objectContaining({ taxUnitId: 'tax-unit-existing' }),
    ])
  })

  it('removes existing rules when a candidate is explicitly deferred', () => {
    const snapshot = emptyPlanningSnapshot(2026)
    snapshot.projectRules.push({
      id: 'existing-rule',
      projectKey: 'project_alpha_0001',
      effectiveFrom: '2026-02-03',
      classification: 'new-development',
    })

    const result = applyCandidateDestinations(snapshot, candidates.slice(0, 1), {
      project_alpha_0001: { kind: 'later' },
    })

    expect(result.projectRules).toEqual([])
  })

  it('keeps later accounting phases when the default candidate assignment is deferred', () => {
    const snapshot = emptyPlanningSnapshot(2026)
    snapshot.projectRules.push(
      {
        id: 'default-rule',
        projectKey: 'project_alpha_0001',
        effectiveFrom: '2026-02-03',
        classification: 'new-development',
      },
      {
        id: 'later-rule',
        projectKey: 'project_alpha_0001',
        effectiveFrom: '2026-07-01',
        classification: 'maintenance',
      },
    )

    const result = applyCandidateDestinations(snapshot, candidates.slice(0, 1), {
      project_alpha_0001: { kind: 'later' },
    })

    expect(result.projectRules).toEqual([snapshot.projectRules[1]])
  })

  it('summarizes distinct products and special destinations', () => {
    expect(
      destinationSummary({
        a: { kind: 'product', group: '1' },
        b: { kind: 'product', group: '1' },
        c: { kind: 'private' },
        d: { kind: 'learning' },
        e: { kind: 'later' },
      }),
    ).toEqual({ products: 1, privateItems: 1, learningItems: 1, laterItems: 1 })
  })
})
