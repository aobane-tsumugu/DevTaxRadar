import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { emptyPlanningSnapshot } from '../../src/planning/types.js'
import type { WorkspaceDraft } from '../../src/planning/workspace.js'
import {
  activeOriginalCharges,
  originalChargeCandidateSchema,
  originalChargeContentHash,
  originalChargeDigest,
  originalChargesSchema,
  type OriginalChargeCandidate,
} from '../../src/planning/originalCharges.js'
import {
  adaptOriginalChargeCandidates,
  applyOriginalChargeCandidates,
  manualOriginalChargeCandidate,
  originalChargeCandidateFromSource,
  parseOriginalChargeImport,
  validateOriginalChargeBindings,
  ORIGINAL_CHARGE_IMPORT_LIMIT,
} from '../../src/core/originalChargeIntake.js'

const at = '2026-01-10T12:00:00Z'
function workspace(): WorkspaceDraft {
  return {
    revision: 0,
    configuration: {
      charges: { claude: 0, codex: 0 },
      contracts: { claude: {}, codex: {} },
      monthlyCharges: [],
      chargePeriods: [],
      unobservedRatio: null,
    },
    planning: emptyPlanningSnapshot(2026),
  }
}
function direct(id = 'cloud', amount: number | null = 100): OriginalChargeCandidate {
  const unknown = amount === null ? { unknownAmountReason: '明細未着' } : {}
  return {
    category: 'direct',
    record: {
      id,
      incurredOn: '2026-01-01',
      costType: 'cloud',
      amountJpy: amount,
      directlyAttributable: false,
      treatment: 'general',
      evidenceIds: [],
      ...unknown,
    },
    original: {
      currency: 'JPY',
      amount: amount === null ? null : String(amount),
      amountJpy: amount,
      ...unknown,
      ...(amount === null ? { unknownJpyReason: '明細未着' } : {}),
    },
    evidenceIds: [],
    provenance: { kind: 'manual' },
  }
}
function imported(candidate = direct(), key = 'cloud:contract-a:invoice-1') {
  const { provenance: _provenance, ...row } = candidate
  return parseOriginalChargeImport(JSON.stringify([{ ...row, sourceKey: key }]), 'json')[0]
}
function apply(current: WorkspaceDraft, candidates: OriginalChargeCandidate[], id = 'fact-1') {
  return applyOriginalChargeCandidates(current, candidates, { recordedAt: at, createId: () => id })
}
function csv(rows: Record<string, unknown>[]) {
  const columns = ['category', 'record', 'original', 'evidenceIds', 'sourceKey']
  const quote = (value: string) => '"' + value.replaceAll('"', '""') + '"'
  return [
    columns.join(','),
    ...rows.map((row) =>
      columns
        .map((column) =>
          quote(
            typeof row[column] === 'string' ? (row[column] as string) : JSON.stringify(row[column]),
          ),
        )
        .join(','),
    ),
  ].join('\r\n')
}

describe('unified original charge intake', () => {
  it.each(['', 'abc', '支払根拠😀', 'a'.repeat(1000)])(
    'matches standard SHA-256 for %j',
    (text) => {
      expect(originalChargeDigest(text)).toBe(createHash('sha256').update(text).digest('hex'))
    },
  )
  it('uses one category row for manual input and preserves source IDs', () => {
    const current = workspace()
    const result = apply(current, [manualOriginalChargeCandidate(direct())])
    expect(result.workspace.planning.directCosts).toEqual([direct().record])
    expect(result.workspace.planning.originalCharges?.facts[0]).toMatchObject({
      id: 'fact-1',
      sourceId: 'direct:cloud',
      original: { amount: '100', amountJpy: 100 },
    })
    expect(result.workspace.planning.sourceAdjustments).toBeUndefined()
    expect(current.planning.directCosts).toEqual([])
  })
  it('retains unknown and confirmed zero distinctly', () => {
    for (const amount of [null, 0]) {
      const result = apply(workspace(), [direct('amount', amount)])
      expect(result.workspace.planning.directCosts[0].amountJpy).toBe(amount)
      expect(result.workspace.planning.originalCharges?.facts[0].original.amount).toBe(
        amount === null ? null : '0',
      )
    }
    expect(
      originalChargeCandidateSchema.safeParse({
        ...direct(),
        original: { currency: 'JPY', amount: null, amountJpy: 100 },
      }).success,
    ).toBe(false)
  })
  it('adopts exact decimal foreign money with recorded rate date reference and rounding', () => {
    const candidate = direct('foreign', 152)
    candidate.original = {
      currency: 'USD',
      amount: '1.005',
      amountJpy: 152,
      fx: {
        currency: 'USD',
        foreignAmount: '1.005',
        jpyPerUnit: '151.5',
        rounding: 'nearest-yen',
        convertedOn: '2026-01-02',
        reference: 'カード換算明細',
      },
    }
    expect(apply(workspace(), [candidate]).workspace.planning.directCosts[0].amountJpy).toBe(152)
    candidate.original.fx!.rounding = 'ceiling-yen'
    expect(() => apply(workspace(), [candidate])).toThrow(/換算/)
  })
  it('rejects missing conversion evidence values, mismatches, impossible dates and precision loss', () => {
    const invalid: unknown[] = [
      { ...direct(), original: { currency: 'USD', amount: '1.00', amountJpy: 100 } },
      { ...direct(), original: { currency: 'JPY', amount: '1e2', amountJpy: 100 } },
      { ...direct(), original: { currency: 'JPY', amount: 100, amountJpy: 100 } },
      { ...direct(), original: { currency: 'JPY', amount: '100.1', amountJpy: 100 } },
      { ...direct(), dates: { paidOn: '2026-02-30' } },
      { ...direct(), record: { ...direct().record, incurredOn: '2026-02-30' } },
      { ...direct(), original: { currency: 'JPY', amount: '99', amountJpy: 99 } },
      {
        ...direct(),
        original: { currency: 'JPY', amount: '100', amountJpy: 100, unknownJpyReason: '不明' },
      },
    ]
    for (const candidate of invalid)
      expect(originalChargeCandidateSchema.safeParse(candidate).success).toBe(false)
  })
  it('preserves all existing categories, allocations and category-specific methods', () => {
    const current = workspace()
    current.planning.taxUnits.push({
      id: 'unit',
      name: '作品',
      unitType: 'new-software',
      usageMode: 'internal',
      revenueModel: 'efficiency',
      lifecycleStatus: 'developing',
    })
    const base = {
      original: direct().original,
      evidenceIds: [],
      provenance: { kind: 'manual' as const },
    }
    const candidates: OriginalChargeCandidate[] = [
      {
        ...base,
        category: 'subscription',
        record: {
          id: 'subscription',
          provider: 'codex',
          planName: 'A',
          serviceStartedOn: '2026-01-01',
          serviceEndedOn: '2026-12-31',
          amountJpy: 100,
        },
      },
      {
        ...base,
        category: 'equipment',
        record: {
          id: 'equipment',
          name: 'PC',
          equipmentType: 'pc',
          acquisitionCostJpy: 100,
          acquiredOn: '2026-01-01',
          convertedFromPrivate: false,
          businessUseRatio: 0.6,
          projectAllocationRatio: 0.4,
          role: '制作',
          taxUnitId: 'unit',
          usefulLifeYears: 4,
          evidenceIds: [],
        },
      },
      {
        ...base,
        category: 'home',
        record: {
          id: 'home',
          month: '2026-01',
          category: 'internet',
          amountJpy: 100,
          method: 'usage-time',
          businessUseRatio: 0.4,
          basis: '時間',
          rationale: '記録',
          projectAllocationRatio: 0.5,
          treatment: 'shared',
          targets: [{ taxUnitId: 'unit', shareBps: null }],
          evidenceIds: [],
        },
      },
      {
        ...direct('direct'),
        record: {
          ...direct('direct').record,
          treatment: 'shared',
          targets: [{ taxUnitId: 'unit', shareBps: 2500 }],
        },
      } as OriginalChargeCandidate,
    ]
    let count = 0
    const result = applyOriginalChargeCandidates(current, candidates, {
      recordedAt: at,
      createId: () => `f-${++count}`,
    })
    expect(result.workspace.configuration.chargePeriods).toEqual([candidates[0].record])
    expect(result.workspace.planning.equipment).toEqual([candidates[1].record])
    expect(result.workspace.planning.homeCosts).toEqual([candidates[2].record])
    expect(result.workspace.planning.directCosts).toEqual([candidates[3].record])
  })
  it('JSON and CSV adapters produce the same canonical digest with no payload retained', () => {
    const { provenance: _p, ...row } = direct()
    const input = { ...row, sourceKey: 'vendor:contract:invoice' }
    const fromJson = parseOriginalChargeImport(
      JSON.stringify({ version: 1, candidates: [input] }),
      'json',
    )[0]
    const fromCsv = parseOriginalChargeImport(csv([input]), 'csv')[0]
    expect(fromCsv.provenance.contentHash).toBe(fromJson.provenance.contentHash)
    expect(fromJson).not.toHaveProperty('sourceKey')
    expect(fromJson.provenance).toEqual({
      kind: 'json',
      sourceKey: input.sourceKey,
      contentHash: originalChargeContentHash(fromJson),
    })
  })
  it('reimport is idempotent and does not turn historical input back into current input', () => {
    const initial = imported()
    const first = apply(workspace(), [initial])
    expect(apply(first.workspace, [initial]).skippedSourceKeys).toEqual([
      initial.provenance.sourceKey,
    ])
    const corrected = originalChargeCandidateFromSource(first.workspace, 'direct', 'cloud')
    corrected.correctionReason = '支払日を確認'
    corrected.dates = { paidOn: '2026-01-07' }
    const second = apply(first.workspace, [manualOriginalChargeCandidate(corrected)], 'fact-2')
    const repeated = apply(second.workspace, [initial])
    expect(repeated.workspace.planning.originalCharges?.facts).toHaveLength(2)
    expect(
      activeOriginalCharges(repeated.workspace.planning.originalCharges)[0].dates?.paidOn,
    ).toBe('2026-01-07')
  })
  it('changed import needs explicit correction and preserves chain and operational source ID', () => {
    const first = apply(workspace(), [imported()])
    const changed = imported(direct('cloud', 120))
    expect(() => apply(first.workspace, [changed])).toThrow(/訂正/)
    changed.correctsId = 'fact-1'
    changed.correctionReason = '請求金額訂正'
    const second = apply(first.workspace, [changed], 'fact-2')
    expect(second.workspace.planning.directCosts).toHaveLength(1)
    expect(second.workspace.planning.directCosts[0].amountJpy).toBe(120)
    expect(
      second.workspace.planning.originalCharges?.facts.map((fact) => fact.original.amountJpy),
    ).toEqual([100, 120])
    expect(second.workspace.planning.sourceAdjustments).toBeUndefined()
    expect(() =>
      apply(
        second.workspace,
        [{ ...direct(), correctsId: 'fact-1', correctionReason: '古い入力' }],
        'fact-3',
      ),
    ).toThrow(/訂正/)
  })
  it('does not merge distinct contract keys merely for matching amount and dates', () => {
    const one = imported(direct('a'), 'provider:contract-a:1')
    const two = imported(direct('b'), 'provider:contract-b:1')
    let id = 0
    const result = applyOriginalChargeCandidates(workspace(), [one, two], {
      recordedAt: at,
      createId: () => `fact-${++id}`,
    })
    expect(result.workspace.planning.directCosts).toHaveLength(2)
    expect(result.addedFactIds).toHaveLength(2)
  })
  it('captures explicit legacy correction without inventing a zero adjustment or baseline date', () => {
    const current = workspace()
    current.planning.directCosts = [
      direct().record as WorkspaceDraft['planning']['directCosts'][number],
    ]
    expect(() => apply(current, [direct()])).toThrow(/既存記録/)
    const candidate = originalChargeCandidateFromSource(current, 'direct', 'cloud')
    candidate.correctionReason = '支払日を原本で確認'
    candidate.dates = { paidOn: '2026-01-08' }
    const result = apply(current, [candidate])
    const fact = result.workspace.planning.originalCharges!.facts[0]
    expect(fact.legacySourceId).toBe('direct:cloud')
    expect(fact.legacyPreviousRecord).toEqual(current.planning.directCosts[0])
    expect(fact.correctsId).toBeUndefined()
    expect(result.workspace.planning.sourceAdjustments).toBeUndefined()
  })
  it('guards factual bindings but allows independent allocation edits', () => {
    const first = apply(workspace(), [direct()]).workspace
    first.planning.directCosts[0].directlyAttributable = true
    expect(() => validateOriginalChargeBindings(first)).not.toThrow()
    first.planning.directCosts[0].amountJpy = 101
    expect(() => validateOriginalChargeBindings(first)).toThrow(/原請求/)
  })
  it('rejects forged digest, raw payloads, unknown versions, invalid columns and byte/row limits', () => {
    const candidate = imported()
    candidate.provenance.contentHash = 'a'.repeat(64)
    expect(() => apply(workspace(), [candidate])).toThrow(/hash/)
    expect(() =>
      parseOriginalChargeImport(
        JSON.stringify([{ ...direct(), sourceKey: 'k', rawReceipt: 'private' }]),
        'json',
      ),
    ).toThrow()
    expect(() =>
      parseOriginalChargeImport(JSON.stringify({ version: 2, candidates: [] }), 'json'),
    ).toThrow()
    expect(() =>
      parseOriginalChargeImport(
        csv([{ ...direct(), sourceKey: 'k' }]).replace('sourceKey', 'filename'),
        'csv',
      ),
    ).toThrow(/列/)
    expect(() =>
      parseOriginalChargeImport('x'.repeat(ORIGINAL_CHARGE_IMPORT_LIMIT + 1), 'json'),
    ).toThrow(/512/)
    expect(() =>
      parseOriginalChargeImport(JSON.stringify(Array.from({ length: 501 }, () => ({}))), 'json'),
    ).toThrow()
    expect(() =>
      parseOriginalChargeImport(
        'category,record,original,evidenceIds,sourceKey\na,"unterminated',
        'csv',
      ),
    ).toThrow(/引用符/)
  })
  it('rejects missing evidence, fabricated legacy previous records and branches atomically', () => {
    const current = workspace()
    const candidate = direct()
    candidate.evidenceIds = ['missing']
    candidate.record.evidenceIds = ['missing']
    expect(() => apply(current, [candidate])).toThrow(/証拠/)
    expect(current.planning.directCosts).toHaveLength(0)
    const first = apply(current, [direct()]).workspace
    const fact = first.planning.originalCharges!.facts[0]
    expect(
      originalChargesSchema.safeParse({
        version: 1,
        facts: [fact, { ...fact, id: 'f2', correctsId: 'absent', correctionReason: 'bad' }],
      }).success,
    ).toBe(false)
    expect(
      originalChargesSchema.safeParse({
        version: 1,
        facts: [{ ...fact, legacySourceId: 'direct:cloud', correctionReason: 'legacy' }],
      }).success,
    ).toBe(false)
  })
  it('future receipt adapter still uses common strict structured validation', () => {
    const records = adaptOriginalChargeCandidates(
      { kind: 'receipt', extract: () => [{ ...direct(), sourceKey: 'receipt:invoice-1' }] },
      'never retained',
    )
    expect(records[0].provenance.kind).toBe('receipt')
    expect(JSON.stringify(records)).not.toContain('never retained')
    expect(() =>
      adaptOriginalChargeCandidates(
        {
          kind: 'receipt',
          extract: () => [{ ...direct(), sourceKey: 'receipt:invoice-1', raw: 'forbidden' }],
        },
        null,
      ),
    ).toThrow()
  })
})

describe('original charge integrity boundaries', () => {
  it('allows independent same-contract usage confirmation and rejects a mismatched actual contract', () => {
    const candidate: OriginalChargeCandidate = {
      category: 'subscription',
      record: {
        id: 'ai',
        provider: 'claude',
        planName: 'Contract A',
        serviceStartedOn: '2026-01-01',
        serviceEndedOn: '2026-01-31',
        amountJpy: 100,
        evidenceIds: [],
      },
      original: { currency: 'JPY', amount: '100', amountJpy: 100 },
      contract: { reference: 'A' },
      evidenceIds: [],
      provenance: { kind: 'manual' },
    }
    const current = apply(workspace(), [candidate]).workspace
    const record = current.configuration.chargePeriods[0]
    record.contractConfirmation = {
      reference: 'A',
      reason: '契約を確認',
      confirmedAt: at,
      basis: structuredClone(candidate.record),
      usageScope: { kind: 'all', selectors: [], unobservedRatio: null, reason: '集計対象' },
    }
    expect(() => validateOriginalChargeBindings(current)).not.toThrow()
    record.contractConfirmation.usageScope!.unobservedRatio = 0.25
    expect(() => validateOriginalChargeBindings(current)).not.toThrow()
    record.contractConfirmation.reference = 'B'
    expect(() => validateOriginalChargeBindings(current)).toThrow(/契約/)
  })
  it('enforces configuration capacity in the draft adapter before confirmation', () => {
    const current = workspace()
    current.configuration.chargePeriods = Array.from({ length: 1000 }, (_, index) => ({
      id: `existing-${index}`,
      provider: 'claude',
      planName: 'P',
      serviceStartedOn: '2026-01-01',
      serviceEndedOn: '2026-01-31',
      amountJpy: 100,
    }))
    const candidate: OriginalChargeCandidate = {
      category: 'subscription',
      record: { ...current.configuration.chargePeriods[0], id: 'new' },
      original: { currency: 'JPY', amount: '100', amountJpy: 100 },
      evidenceIds: [],
      provenance: { kind: 'manual' },
    }
    expect(() => apply(current, [candidate])).toThrow()
    expect(current.configuration.chargePeriods).toHaveLength(1000)
  })
  it('rejects a full outgoing envelope over 2MiB without mutating the draft', () => {
    const current = workspace()
    current.planning.evidence = Array.from({ length: 600 }, (_, index) => ({
      id: `e-${index}`,
      evidenceType: 'memo',
      strength: 'self-recorded',
      recordedAt: at,
      note: 'x'.repeat(4000),
    }))
    expect(() => apply(current, [direct()])).toThrow(/2 MiB/)
    expect(current.planning.directCosts).toHaveLength(0)
  })
  it('rejects invalid provenance kinds and metadata records that could not be replayed', () => {
    expect(() =>
      parseOriginalChargeImport(
        JSON.stringify([{ ...direct(), sourceKey: 'a', provenance: { kind: 'executable' } }]),
        'json',
      ),
    ).toThrow(/取込元/)
    const first = apply(workspace(), [direct()]).workspace.planning.originalCharges!
    expect(
      originalChargesSchema.safeParse({
        version: 1,
        facts: [{ ...first.facts[0], recordedAt: '2026-02-30T00:00:00Z' }],
      }).success,
    ).toBe(false)
    const wrongPrevious = {
      id: 'cloud',
      provider: 'claude',
      planName: 'P',
      serviceStartedOn: '2026-01-01',
      serviceEndedOn: '2026-01-31',
      amountJpy: 100,
    }
    expect(
      originalChargesSchema.safeParse({
        version: 1,
        facts: [
          {
            ...first.facts[0],
            legacySourceId: 'direct:cloud',
            correctionReason: '訂正',
            legacyPreviousRecord: wrongPrevious,
          },
        ],
      }).success,
    ).toBe(false)
  })
})

describe('import correction identity', () => {
  it('distinguishes an explicit reversion from an old-file replay and retries it idempotently', () => {
    const root = imported(direct('cloud', 100))
    const first = apply(workspace(), [root]).workspace
    const increment = {
      ...imported(direct('cloud', 200)),
      correctsId: 'fact-1',
      correctionReason: '金額修正',
    }
    const second = apply(first, [increment], 'fact-2').workspace
    const reversion = {
      ...imported(direct('cloud', 100)),
      correctsId: 'fact-2',
      correctionReason: '原本に再照合',
    }
    const third = apply(second, [reversion], 'fact-3')
    expect(third.workspace.planning.directCosts[0].amountJpy).toBe(100)
    expect(third.workspace.planning.originalCharges?.facts).toHaveLength(3)
    expect(third.addedFactIds).toEqual(['fact-3'])
    expect(apply(third.workspace, [reversion], 'fact-4').skippedSourceKeys).toEqual([
      root.provenance.sourceKey,
    ])
    expect(
      apply(third.workspace, [increment], 'fact-4').workspace.planning.directCosts[0].amountJpy,
    ).toBe(100)
    expect(() =>
      apply(third.workspace, [{ ...reversion, correctionReason: '異なる理由' }], 'fact-4'),
    ).toThrow(/訂正元/)
  })
})
