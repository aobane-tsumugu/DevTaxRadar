import { z } from 'zod'
import type { PlanningSnapshot } from './types.js'
import { validIsoCalendarDate } from '../core/chargePeriods.js'

export const activityPurposeLabels = {
  'new-development': '新規開発',
  'ordinary-operation': '通常業務',
  maintenance: '維持管理',
  'feature-addition': '機能追加',
  'general-learning': '一般学習',
  hobby: '趣味',
  unknown: '用途未確認',
} as const
export const activityKindLabels = {
  development: '開発',
  evaluation: '評価',
  'internal-use': '内部利用',
  'external-release': '外部公開（部分公開を含む）',
  sale: '販売',
  improvement: '改良開発',
  maintenance: '保守',
  suspension: '休止',
  retirement: '利用終了',
  abandonment: '開発中止',
} as const
export const activityStateLabels = {
  observed: '観測・記録のみ',
  estimated: '推定',
  confirmed: '本人確認済み',
  unknown: '不明',
  conflicted: '矛盾あり',
} as const
const id = z.string().trim().min(1).max(120)
const date = z.string().refine(validIsoCalendarDate, '実在する年月日を指定してください。')
const note = z.string().trim().min(1).max(2000)
export const activityFactSchema = z
  .strictObject({
    id,
    productId: id,
    taxUnitId: id.optional(),
    kind: z.enum(
      Object.keys(activityKindLabels) as [
        keyof typeof activityKindLabels,
        ...Array<keyof typeof activityKindLabels>,
      ],
    ),
    purpose: z.enum(
      Object.keys(activityPurposeLabels) as [
        keyof typeof activityPurposeLabels,
        ...Array<keyof typeof activityPurposeLabels>,
      ],
    ),
    state: z.enum(['observed', 'estimated', 'confirmed', 'unknown', 'conflicted']),
    time: z.discriminatedUnion('kind', [
      z.strictObject({ kind: z.literal('date'), occurredOn: date }),
      z.strictObject({ kind: z.literal('period'), startedOn: date, endedOn: date.optional() }),
      z.strictObject({ kind: z.literal('unknown') }),
    ]),
    scope: note,
    recordedAt: z.string().datetime({ offset: true }),
    evidenceIds: z
      .array(id)
      .max(100)
      .refine((ids) => new Set(ids).size === ids.length),
    reason: note,
    correctsId: id.optional(),
    correctionReason: note.optional(),
  })
  .superRefine((fact, ctx) => {
    if (Boolean(fact.correctsId) !== Boolean(fact.correctionReason))
      ctx.addIssue({ code: 'custom', message: '訂正元と訂正理由を両方指定してください。' })
    if (fact.time.kind === 'period' && fact.time.endedOn && fact.time.endedOn < fact.time.startedOn)
      ctx.addIssue({ code: 'custom', message: '終了日は開始日以後にしてください。' })
    if (fact.state === 'confirmed' && fact.time.kind === 'unknown')
      ctx.addIssue({ code: 'custom', message: '日時不明の事実を確認済みにできません。' })
  })
export const activityLedgerSchema = z
  .strictObject({
    version: z.literal(1),
    products: z.array(z.strictObject({ id, name: z.string().trim().min(1).max(160) })).max(1000),
    unitLinks: z
      .array(
        z.strictObject({
          id,
          productId: id,
          taxUnitId: id,
          correctsId: id.optional(),
          correctionReason: note.optional(),
        }),
      )
      .max(2000),
    facts: z.array(activityFactSchema).max(10000),
  })
  .superRefine((ledger, ctx) => {
    for (const key of ['products', 'unitLinks', 'facts'] as const)
      if (new Set(ledger[key].map((row) => row.id)).size !== ledger[key].length)
        ctx.addIssue({ code: 'custom', path: [key], message: 'IDが重複しています。' })
    if (
      new Set(activeUnitLinks(ledger).map((row) => row.taxUnitId)).size !==
      activeUnitLinks(ledger).length
    )
      ctx.addIssue({
        code: 'custom',
        path: ['unitLinks'],
        message: '費用単位の制作物への対応は一つです。',
      })
    const products = new Set(ledger.products.map((row) => row.id))
    const facts = new Map(ledger.facts.map((row) => [row.id, row]))
    for (const link of ledger.unitLinks)
      if (!products.has(link.productId))
        ctx.addIssue({ code: 'custom', message: '対応する制作物がありません。' })
    const linkCorrections = new Set<string>()
    for (const link of ledger.unitLinks) {
      if (Boolean(link.correctsId) !== Boolean(link.correctionReason))
        ctx.addIssue({ code: 'custom', message: '対応関係の訂正元と理由を指定してください。' })
      if (link.correctsId) {
        const prior = ledger.unitLinks.find((row) => row.id === link.correctsId)
        if (
          !prior ||
          prior.id === link.id ||
          prior.taxUnitId !== link.taxUnitId ||
          linkCorrections.has(prior.id)
        )
          ctx.addIssue({ code: 'custom', message: '対応関係の訂正元が不正です。' })
        linkCorrections.add(link.correctsId)
        const visited = new Set([link.id])
        let parent = prior
        while (parent) {
          if (visited.has(parent.id)) {
            ctx.addIssue({ code: 'custom', message: '対応関係の訂正が循環しています。' })
            break
          }
          visited.add(parent.id)
          parent = parent.correctsId
            ? ledger.unitLinks.find((row) => row.id === parent!.correctsId)
            : undefined
        }
      }
    }
    const corrected = new Set<string>()
    for (const fact of ledger.facts) {
      if (
        !products.has(fact.productId) ||
        (fact.taxUnitId &&
          !ledger.unitLinks.some(
            (link) => link.taxUnitId === fact.taxUnitId && link.productId === fact.productId,
          ))
      )
        ctx.addIssue({ code: 'custom', message: '事実の対象と制作物の対応が一致しません。' })
      if (fact.correctsId) {
        const prior = facts.get(fact.correctsId)
        if (
          !prior ||
          prior.id === fact.id ||
          corrected.has(prior.id) ||
          Date.parse(prior.recordedAt) > Date.parse(fact.recordedAt)
        )
          ctx.addIssue({
            code: 'custom',
            message: '訂正元は未訂正の事実を指定してください。対象訂正も元記録を保持します。',
          })
        corrected.add(fact.correctsId)
        const visited = new Set([fact.id])
        let parent = prior
        while (parent) {
          if (visited.has(parent.id)) {
            ctx.addIssue({ code: 'custom', message: '訂正履歴が循環しています。' })
            break
          }
          visited.add(parent.id)
          parent = parent.correctsId ? facts.get(parent.correctsId) : undefined
        }
      }
    }
  })
export type ActivityFact = z.infer<typeof activityFactSchema>
export type ActivityLedger = z.infer<typeof activityLedgerSchema>
export function activeUnitLinks(ledger: {
  unitLinks: Array<{
    id: string
    productId: string
    taxUnitId: string
    correctsId?: string
    correctionReason?: string
  }>
}) {
  return ledger.unitLinks.filter(
    (row) => !ledger.unitLinks.some((next) => next.correctsId === row.id),
  )
}
export const emptyActivityLedger = (): ActivityLedger => ({
  version: 1,
  products: [],
  unitLinks: [],
  facts: [],
})
export function activityTimeLabel(fact: Pick<ActivityFact, 'time'>): string {
  return fact.time.kind === 'date'
    ? fact.time.occurredOn
    : fact.time.kind === 'period'
      ? `${fact.time.startedOn} ～ ${fact.time.endedOn ?? '終了未指定'}`
      : '日時不明'
}
export function activityOverlaps(fact: ActivityFact, start: string, end: string): boolean {
  if (fact.time.kind === 'unknown') return true
  if (fact.time.kind === 'date') return fact.time.occurredOn >= start && fact.time.occurredOn <= end
  return fact.time.startedOn <= end && (!fact.time.endedOn || fact.time.endedOn >= start)
}
/** Include originals and corrections in their own affected scopes; never rewrite an adopted basis. */
export function scopedActivityFacts(
  planning: PlanningSnapshot,
  taxUnitId: string | undefined,
  start: string,
  end: string,
): ActivityFact[] {
  const ledger = planning.activityLedger
  if (!ledger || !taxUnitId) return []
  const productId = activeUnitLinks(ledger).find((link) => link.taxUnitId === taxUnitId)?.productId
  if (!productId) return []
  const selected = ledger.facts.filter(
    (fact) =>
      fact.productId === productId &&
      (!fact.taxUnitId || fact.taxUnitId === taxUnitId) &&
      activityOverlaps(fact, start, end),
  )
  const ids = new Set(selected.map((row) => row.id))
  // A correction moving a date out of the original period still invalidates that period.
  let changed = true
  while (changed) {
    changed = false
    for (const fact of ledger.facts)
      if (fact.correctsId && (ids.has(fact.correctsId) || ids.has(fact.id)))
        for (const id of [fact.id, fact.correctsId])
          if (!ids.has(id)) {
            ids.add(id)
            changed = true
          }
  }
  return ledger.facts
    .filter((fact) => ids.has(fact.id))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}
