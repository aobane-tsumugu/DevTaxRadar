import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import type { OriginalChargeCandidate } from '../../src/planning/originalCharges.js'
import {
  activeOriginalCharges,
  originalChargeContentHash,
  originalChargeDigest,
} from '../../src/planning/originalCharges.js'
import { emptyPlanningSnapshot } from '../../src/planning/types.js'
import type { WorkspaceDraft } from '../../src/planning/workspace.js'
import {
  adaptOriginalChargeCandidates,
  applyOriginalChargeCandidates,
  originalChargeCandidateFromSource,
} from '../../src/core/originalChargeIntake.js'
import { extractReceiptJson, extractReceiptText } from '../../src/core/receiptExtraction.js'
import { projectWorkspaceCosts } from '../../src/core/workspaceCosts.js'
import { costTreatmentBasis } from '../../src/core/costTreatments.js'
import { costProjectionMarkdown } from '../../src/core/costExport.js'
import { originalChargeMarkdown } from '../../src/core/originalChargeExport.js'
import { reviewExportMarkdown } from '../../src/core/reviewExport.js'
import { compareReview } from '../../src/core/reviewComparison.js'
import { workspaceChangeKind } from '../../src/core/workspaceChange.js'
import { mergeWorkspaceDrafts } from '../../src/core/workspaceMerge.js'
import {
  writeOriginalCharges,
  readOriginalCharges,
} from '../../src/server/originalChargesRepository.js'
import { buildReviewMaterials } from '../../src/server/reviewMaterials.js'
import {
  adoptBalanceReview,
  getBalanceDraft,
  getBalanceReview,
  initializeBalanceSchema,
  previewBalanceReview,
  type ReviewMaterialsReader,
} from '../../src/server/balanceRepository.js'

const source = `Issuer: Example Cloud, Inc.
Invoice date: 2026-10-02
Payment date: 2026-10-03
Currency: JPY
Total: 1,100円
Invoice number: INV-2026-10
PRIVATE_RECEIPT_BODY_CANARY
Original location: /private/PRIVATE_RECEIPT_PATH_CANARY.pdf`
const at = '2026-10-03T12:00:00Z'

function workspace(): WorkspaceDraft {
  const planning = emptyPlanningSnapshot(2026)
  planning.taxUnits.push({
    id: 'unit',
    name: 'Reviewed project',
    unitType: 'new-software',
    usageMode: 'internal',
    revenueModel: 'efficiency',
    lifecycleStatus: 'developing',
  })
  planning.evidence.push({
    id: 'proof',
    evidenceType: 'receipt',
    strength: 'external',
    recordedAt: at,
    note: '原本を確認した参照',
    localReference: '/private/PRIVATE_EVIDENCE_PATH_CANARY.pdf',
  })
  return {
    revision: 0,
    planning,
    configuration: {
      charges: { claude: 0, codex: 0 },
      contracts: { claude: {}, codex: {} },
      monthlyCharges: [],
      chargePeriods: [],
      unobservedRatio: null,
    },
  }
}

/** Test-only representation of explicit review choices; extraction itself creates no charge. */
function reviewed(document?: OriginalChargeCandidate['document']): OriginalChargeCandidate {
  const extracted = extractReceiptText(source)
  const chosen: OriginalChargeCandidate = {
    // Category, allocation, incurred date, adopted yen and evidence are separately supplied by review.
    category: 'direct',
    record: {
      id: 'receipt-charge',
      taxUnitId: 'unit',
      incurredOn: '2026-10-03',
      costType: 'cloud',
      amountJpy: 1100,
      directlyAttributable: true,
      treatment: 'direct',
      evidenceIds: ['proof'],
    },
    original: {
      currency: extracted.currency[0]!,
      amount: extracted.total[0]!,
      amountJpy: 1100,
    },
    document: document ?? {
      issuer: extracted.issuer[0]!,
      invoiceNumber: extracted.invoiceNumber[0]!,
    },
    dates: {
      billedOn: extracted.billedOn[0]!,
      paidOn: extracted.paidOn[0]!,
      incurredOn: '2026-10-03',
    },
    evidenceIds: ['proof'],
    provenance: { kind: 'manual' },
  }
  return adaptOriginalChargeCandidates(
    {
      kind: 'receipt',
      extract: () => [{ ...chosen, sourceKey: `receipt:${originalChargeDigest(source)}` }],
    },
    null,
  )[0]!
}

function apply(current: WorkspaceDraft, candidate = reviewed(), id = 'receipt-fact') {
  return applyOriginalChargeCandidates(current, [candidate], {
    recordedAt: at,
    createId: () => id,
  })
}

function correctDocument(current: WorkspaceDraft): WorkspaceDraft {
  const correction = originalChargeCandidateFromSource(current, 'direct', 'receipt-charge')
  correction.document = { issuer: 'Verified Example Cloud, Inc.', invoiceNumber: 'INV-2026-10-B' }
  correction.correctionReason = '原本と照合して発行元表記と請求書番号を訂正'
  return apply(current, correction, 'receipt-correction').workspace
}

describe('reviewed receipt candidates through the common original-charge boundary', () => {
  it('persists only the explicitly chosen facts, metadata, evidence IDs and opaque document digest', () => {
    const current = workspace()
    const before = JSON.stringify(current)
    const candidate = reviewed()
    const saved = apply(current, candidate)
    const fact = saved.workspace.planning.originalCharges!.facts[0]!
    expect(candidate.provenance).toEqual({
      kind: 'receipt',
      sourceKey: `receipt:${createHash('sha256').update(source).digest('hex')}`,
      contentHash: originalChargeContentHash(candidate),
    })
    expect(fact.document).toEqual({ issuer: 'Example Cloud, Inc.', invoiceNumber: 'INV-2026-10' })
    expect(fact.original).toEqual({ currency: 'JPY', amount: '1100', amountJpy: 1100 })
    expect(fact.dates).toEqual({
      billedOn: '2026-10-02',
      paidOn: '2026-10-03',
      incurredOn: '2026-10-03',
    })
    expect(fact.evidenceIds).toEqual(['proof'])
    expect(saved.workspace.planning.directCosts).toHaveLength(1)
    expect(saved.workspace.planning.sourceAdjustments).toBeUndefined()
    expect(fact).not.toHaveProperty('contract')
    expect(fact).not.toHaveProperty('servicePeriod')
    expect(JSON.stringify(fact)).not.toContain('PRIVATE_RECEIPT_')
    expect(JSON.stringify(fact)).not.toContain('PRIVATE_EVIDENCE_')
    expect(JSON.stringify(current)).toBe(before)
    candidate.document!.issuer = 'Changed after review'
    expect(fact.document?.issuer).toBe('Example Cloud, Inc.')
  })

  it('makes same-document retries idempotent and rejects changed reviewed metadata under the same source key', () => {
    const initial = reviewed()
    const first = apply(workspace(), initial).workspace
    const retry = apply(first, reviewed(), 'must-not-be-added')
    expect(retry.addedFactIds).toEqual([])
    expect(retry.skippedSourceKeys).toEqual([initial.provenance.sourceKey])
    expect(retry.workspace).toEqual(first)
    const changed = reviewed({ issuer: 'Different reviewed issuer', invoiceNumber: 'INV-2026-10' })
    expect(changed.provenance.sourceKey).toBe(initial.provenance.sourceKey)
    expect(changed.provenance.contentHash).not.toBe(initial.provenance.contentHash)
    const before = JSON.stringify(first)
    expect(() => apply(first, changed)).toThrow(/内容が変更|訂正/)
    expect(JSON.stringify(first)).toBe(before)
    expect(first.planning.originalCharges?.facts).toHaveLength(1)
  })

  it('leaves the workspace byte-for-byte unchanged when extraction is cancelled before apply', () => {
    const current = apply(workspace()).workspace
    const before = JSON.stringify(current)
    const textPreview = extractReceiptText(source)
    const jsonPreview = extractReceiptJson(
      '{"version":1,"issuer":"Different issuer","total":"999"}',
    )
    expect(textPreview.total).toEqual(['1100'])
    expect(jsonPreview.total).toEqual(['999'])
    for (const preview of [textPreview, jsonPreview]) {
      expect(preview).not.toHaveProperty('category')
      expect(preview).not.toHaveProperty('sourceKey')
      expect(preview).not.toHaveProperty('provenance')
    }
    // Discarding either preview requires no inverse write and never calls the common apply boundary.
    expect(JSON.stringify(current)).toBe(before)
  })

  it('treats document-only corrections as reviewable changes while preserving the original fact and amount', () => {
    const first = apply(workspace()).workspace
    const originalBytes = JSON.stringify(first.planning.originalCharges!.facts[0])
    const originalHash = originalChargeContentHash(first.planning.originalCharges!.facts[0]!)
    const frozenCosts = projectWorkspaceCosts(first.planning, [])
    const frozenMarkdown = costProjectionMarkdown(frozenCosts, 'recorded')
    const originalBasis = costTreatmentBasis(
      frozenCosts,
      first.planning,
      frozenCosts.contributions[0]!.id,
    )
    const corrected = correctDocument(first)
    const active = activeOriginalCharges(corrected.planning.originalCharges)[0]!
    const newCosts = projectWorkspaceCosts(corrected.planning, [])
    expect(active.id).toBe('receipt-correction')
    expect(active.correctsId).toBe('receipt-fact')
    expect(originalChargeContentHash(active)).not.toBe(originalHash)
    expect(corrected.planning.directCosts).toEqual(first.planning.directCosts)
    expect(newCosts.sources).toHaveLength(1)
    expect(newCosts.totals).toEqual(frozenCosts.totals)
    expect(active.original).toEqual(first.planning.originalCharges!.facts[0]!.original)
    expect(JSON.stringify(corrected.planning.originalCharges!.facts[0])).toBe(originalBytes)
    expect(JSON.stringify(first.planning.originalCharges!.facts[0])).toBe(originalBytes)
    expect(workspaceChangeKind(first, corrected)).toBe('calculation')
    expect(
      mergeWorkspaceDrafts(first, corrected, first).changes.some((row) =>
        row.key.includes('originalCharges'),
      ),
    ).toBe(true)
    expect(
      costTreatmentBasis(newCosts, corrected.planning, newCosts.contributions[0]!.id),
    ).not.toBe(originalBasis)
    expect(costProjectionMarkdown(frozenCosts, 'recorded')).toBe(frozenMarkdown)
    expect(costProjectionMarkdown(newCosts, 'recorded')).toContain('INV-2026-10-B')
    // A late retry of the original receipt does not reactivate historical document details.
    expect(apply(corrected, reviewed()).workspace).toEqual(corrected)
  })

  it('escapes manually reviewed document metadata in frozen Markdown without reading live edits', () => {
    const current = apply(
      workspace(),
      reviewed({
        issuer: 'Vendor <script>\n# forged *heading* [link](https://example.invalid)',
        invoiceNumber: 'INV_1|`formula`',
      }),
    ).workspace
    const frozen = projectWorkspaceCosts(current.planning, [])
    const fact = frozen.sources[0]!.originalChargeFact!
    const markdown = costProjectionMarkdown(frozen, 'recorded')
    const lines = originalChargeMarkdown(fact).join('\n')
    expect(lines).toContain(
      'Vendor \\<script\\> \\# forged \\*heading\\* \\[link\\](https://example.invalid)',
    )
    expect(lines).toContain('INV\\_1\\|\\`formula\\`')
    expect(lines).not.toContain('\n# forged')
    expect(lines).not.toContain('<script>')
    expect(lines).not.toContain('[link](https://example.invalid)')
    expect(markdown).not.toContain('PRIVATE_EVIDENCE_PATH_CANARY')
    current.planning.originalCharges!.facts[0]!.document!.issuer = 'Later live metadata'
    expect(costProjectionMarkdown(frozen, 'recorded')).toBe(markdown)
  })

  it('keeps prior adopted N and N+1 payload bytes, digests and exports fixed after a receipt document correction', () => {
    const db = new DatabaseSync(':memory:')
    initializeBalanceSchema(db)
    let current = apply(workspace()).workspace
    const observation = {
      sessions: [],
      overview: { providers: [], recentScans: [] },
      lastScanTimeZones: {},
    }
    const reader: ReviewMaterialsReader = (_database, balances, year) =>
      buildReviewMaterials(current, balances, year, observation)
    const adopt = (year: number, key: string) => {
      const preview = previewBalanceReview(db, year, reader)
      return adoptBalanceReview(
        db,
        {
          year,
          expectedDraftRevision: preview.draftRevision,
          projectionHash: preview.projectionHash,
          idempotencyKey: key,
          reason: '原本と照合した領収書の候補を確認',
        },
        reader,
      )
    }
    try {
      const first = adopt(2026, 'receipt-first')
      const second = adopt(2027, 'receipt-next')
      const rows = db
        .prepare('SELECT id,payload,content_hash FROM balance_reviews ORDER BY rowid')
        .all()
      const exports = [first, second].map(reviewExportMarkdown)
      expect(exports[0]).toContain('請求書番号: INV-2026-10')
      expect(JSON.stringify(rows)).not.toContain('PRIVATE_RECEIPT_BODY_CANARY')
      expect(JSON.stringify(rows)).not.toContain('PRIVATE_EVIDENCE_PATH_CANARY')
      current = correctDocument(current)
      expect(
        db.prepare('SELECT id,payload,content_hash FROM balance_reviews ORDER BY rowid').all(),
      ).toEqual(rows)
      expect(
        [first.id, second.id].map((id) => reviewExportMarkdown(getBalanceReview(db, id)!)),
      ).toEqual(exports)
      const preview = previewBalanceReview(db, 2026, reader)
      expect(preview.materials?.costs.totals).toEqual(first.materials?.costs.totals)
      const changes = compareReview(first, preview, getBalanceDraft(db).snapshot).changes
      expect(changes.some((change) => change.path.includes('originalChargeFact'))).toBe(true)
      expect(JSON.stringify(preview.materials)).toContain('INV-2026-10-B')
      expect(() => adopt(2027, 'receipt-stale-next')).toThrow(/2026/)
      const revised = adopt(2026, 'receipt-first-correction')
      expect(revised.correctsReviewId).toBe(first.id)
      expect(getBalanceReview(db, second.id)?.previousReviewId).toBe(first.id)
      expect(
        db
          .prepare('SELECT id,payload,content_hash FROM balance_reviews ORDER BY rowid')
          .all()
          .slice(0, 2),
      ).toEqual(rows)
      expect(reviewExportMarkdown(getBalanceReview(db, first.id)!)).toBe(exports[0])
    } finally {
      db.close()
    }
  })
})

it('rejects an old client stripping reviewed document metadata even after recomputing its hash', () => {
  const current = applyOriginalChargeCandidates(workspace(), [reviewed()], {
    recordedAt: at,
  }).workspace
  const saved = current.planning.originalCharges!
  const db = new DatabaseSync(':memory:')
  db.exec('CREATE TABLE app_settings(key TEXT PRIMARY KEY,value TEXT NOT NULL)')
  try {
    writeOriginalCharges(db, saved)
    const changed = structuredClone(saved)
    delete changed.facts[0].document
    changed.facts[0].provenance.contentHash = originalChargeContentHash(changed.facts[0])
    expect(() => writeOriginalCharges(db, changed)).toThrow(/変更・削除できません/)
    expect(readOriginalCharges(db)).toEqual(saved)
  } finally {
    db.close()
  }
})
