import { useEffect, useRef, useState } from 'react'
import { z } from 'zod'
import type { WorkspaceDraft } from '../../planning/workspace'
import type { AllocationTarget } from '../../planning/allocationTargets'
import { allocationTargetsSchema } from '../../planning/allocationTargets'
import {
  originalChargeCandidateSchema,
  canonicalOriginalCharge,
  type OriginalChargeCandidate,
} from '../../planning/originalCharges'
import {
  applyOriginalChargeCandidates,
  manualOriginalChargeCandidate,
  originalChargeCandidateFromSource,
  ORIGINAL_CHARGE_IMPORT_LIMIT,
  ORIGINAL_CHARGE_IMPORT_ROWS,
  originalChargeSourceId,
  parseOriginalChargeImport,
} from '../../core/originalChargeIntake'
import { convertedYen, type CurrencyConversion } from '../../core/sourceAdjustments'
import { useEditorRecovery } from '../useEditorRecovery'
import { EDITOR_FILE_LIMIT } from '../editorRecovery'
import DateInput from './DateInput'
import AllocationTargetsEditor from './AllocationTargetsEditor'
import EvidenceReferences from './EvidenceReferences'
import { yen } from './shared'
import './OriginalChargeIntake.css'

const categoryLabels = {
  subscription: 'AIサブスクリプション',
  equipment: '設備・機材',
  home: '自宅の共用費',
  direct: '制作物の直接費',
} as const

type Category = keyof typeof categoryLabels
const strings = {
  id: '',
  label: '',
  amount: '',
  amountJpy: '',
  unknownAmountReason: '',
  unknownJpyReason: '',
  currency: 'JPY',
  billedOn: '',
  paidOn: '',
  acquiredOn: '',
  incurredOn: '',
  startedOn: '',
  endedOn: '',
  contractReference: '',
  contractReason: '',
  correctionReason: '',
  rate: '',
  convertedOn: '',
  conversionReference: '',
  provider: 'claude',
  equipmentType: 'pc',
  businessUseStartedOn: '',
  usefulLifeYears: '',
  role: '',
  businessPercent: '',
  projectPercent: '',
  taxUnitId: '',
  month: '',
  homeCategory: 'rent',
  homeMethod: 'fixed-ratio',
  basis: '',
  rationale: '',
  treatment: 'direct',
  costType: 'other',
} as const
const inputSchema = z
  .object({
    ...(Object.fromEntries(Object.keys(strings).map((key) => [key, z.string().max(4000)])) as {
      [K in keyof typeof strings]: z.ZodString
    }),
    category: z.enum(['subscription', 'equipment', 'home', 'direct']),
    rounding: z.enum(['nearest-yen', 'floor-yen', 'ceiling-yen']),
    unknownOriginal: z.boolean(),
    unknownJpy: z.boolean(),
    convertedFromPrivate: z.boolean(),
    directlyAttributable: z.boolean(),
    evidenceIds: z.array(z.string()).max(100),
    conversionEvidenceIds: z.array(z.string()).max(100),
    targets: allocationTargetsSchema,
    baseline: z
      .custom<OriginalChargeCandidate>((value) => {
        if (!value || typeof value !== 'object') return false
        // A selected source is a correction draft; the reason is entered separately.
        return originalChargeCandidateSchema.safeParse({
          ...value,
          correctionReason: '入力途中の形式確認',
        }).success
      })
      .nullable(),
  })
  .strict()
type Input = z.infer<typeof inputSchema>
const recoverySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('manual'), input: inputSchema }).strict(),
  z
    .object({
      kind: z.literal('import'),
      candidates: z.array(originalChargeCandidateSchema).min(1).max(ORIGINAL_CHARGE_IMPORT_ROWS),
    })
    .strict(),
])
type Recovery = z.infer<typeof recoverySchema>
const validRecovery = (value: unknown): value is Recovery => recoverySchema.safeParse(value).success
const blank = (category: Category = 'subscription'): Input => ({
  ...strings,
  id: crypto.randomUUID(),
  category,
  rounding: 'nearest-yen',
  unknownOriginal: false,
  unknownJpy: false,
  convertedFromPrivate: false,
  directlyAttributable: false,
  evidenceIds: [],
  conversionEvidenceIds: [],
  targets: [],
  baseline: null,
})
const optional = (value: string) => value.trim() || undefined
function number(value: string, label: string) {
  if (!value.trim() || !/^(0|[1-9]\d*)(\.\d+)?$/.test(value.trim()))
    throw new Error(`${label}を入力してください。未確認の金額や割合を0として補いません。`)
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) throw new Error(`${label}を確認してください。`)
  return parsed
}
function ratio(value: string, label: string) {
  const parsed = number(value, label)
  if (parsed > 100) throw new Error(`${label}は0〜100%で入力してください。`)
  return parsed / 100
}
function fx(input: Input): CurrencyConversion {
  return {
    currency: input.currency.trim().toUpperCase(),
    foreignAmount: input.amount,
    jpyPerUnit: input.rate,
    rounding: input.rounding,
    convertedOn: input.convertedOn,
    reference: input.conversionReference,
  }
}
function fromInput(input: Input): OriginalChargeCandidate {
  const amountJpy = input.unknownJpy ? null : number(input.amountJpy, '採用する円額')
  const unknownAmountReason = input.unknownJpy ? input.unknownJpyReason : undefined
  const base = input.baseline
  const common = { id: input.id, evidenceIds: input.evidenceIds }
  const dates = Object.fromEntries(
    (['billedOn', 'paidOn', 'acquiredOn', 'incurredOn'] as const)
      .filter((key) => input[key])
      .map((key) => [key, input[key]]),
  )
  const facts = {
    original: {
      currency: optional(input.currency)?.toUpperCase() ?? null,
      amount: input.unknownOriginal ? null : input.amount,
      ...(input.unknownOriginal ? { unknownAmountReason: input.unknownAmountReason } : {}),
      amountJpy,
      ...(input.unknownJpy ? { unknownJpyReason: input.unknownJpyReason } : {}),
      ...(input.currency.toUpperCase() !== 'JPY' && !input.unknownOriginal && !input.unknownJpy
        ? { fx: fx(input), conversionEvidenceIds: input.conversionEvidenceIds }
        : {}),
    },
    dates,
    ...(input.startedOn || input.endedOn
      ? { servicePeriod: { startedOn: input.startedOn, endedOn: input.endedOn } }
      : {}),
    ...(input.contractReference
      ? {
          contract: {
            reference: input.contractReference,
            ...(input.contractReason ? { reason: input.contractReason } : {}),
          },
        }
      : {}),
    evidenceIds: input.evidenceIds,
    ...(base?.correctsId ? { correctsId: base.correctsId } : {}),
    ...(base?.legacySourceId ? { legacySourceId: base.legacySourceId } : {}),
    ...(base ? { correctionReason: input.correctionReason } : {}),
  }
  let record: OriginalChargeCandidate['record']
  if (input.category === 'subscription')
    record = {
      ...(base?.category === 'subscription' ? base.record : {}),
      ...common,
      ...(base?.category === 'subscription' &&
      base.record.contractConfirmation &&
      base.record.contractConfirmation.reference !== input.contractReference
        ? { contractConfirmation: undefined }
        : {}),
      provider: input.provider as 'claude' | 'codex',
      planName: input.label,
      serviceStartedOn: input.startedOn,
      serviceEndedOn: input.endedOn,
      billedOn: optional(input.billedOn),
      amountJpy,
      unknownAmountReason,
    }
  else if (input.category === 'equipment')
    record = {
      ...(base?.category === 'equipment' ? base.record : {}),
      ...common,
      name: input.label,
      equipmentType: input.equipmentType as 'pc',
      acquisitionCostJpy: amountJpy,
      unknownAmountReason,
      acquiredOn: input.acquiredOn,
      businessUseStartedOn: optional(input.businessUseStartedOn),
      convertedFromPrivate: input.convertedFromPrivate,
      businessUseRatio: ratio(input.businessPercent, '設備の業務利用割合'),
      usefulLifeYears: input.usefulLifeYears
        ? number(input.usefulLifeYears, '耐用年数')
        : undefined,
      role: input.role,
      taxUnitId: optional(input.taxUnitId),
      projectAllocationRatio: ratio(input.projectPercent, '設備の制作物への割合'),
    }
  else if (input.category === 'home')
    record = {
      ...(base?.category === 'home' ? base.record : {}),
      ...common,
      month: input.month,
      category: input.homeCategory as 'rent',
      amountJpy,
      unknownAmountReason,
      method: input.homeMethod as 'fixed-ratio',
      businessUseRatio: ratio(input.businessPercent, '自宅費用の業務利用割合'),
      basis: input.basis,
      rationale: input.rationale,
      taxUnitId: optional(input.taxUnitId),
      projectAllocationRatio: ratio(input.projectPercent, '自宅費用の制作物への割合'),
      treatment: input.treatment as 'direct',
      ...(input.targets.length || (base?.category === 'home' && base.record.targets)
        ? { targets: input.targets }
        : {}),
    }
  else
    record = {
      ...(base?.category === 'direct' ? base.record : {}),
      ...common,
      incurredOn: input.incurredOn,
      costType: input.costType as 'other',
      amountJpy,
      unknownAmountReason,
      directlyAttributable: input.directlyAttributable,
      treatment: input.treatment as 'direct',
      note: optional(input.label),
      taxUnitId: optional(input.taxUnitId),
      ...(input.targets.length || (base?.category === 'direct' && base.record.targets)
        ? { targets: input.targets }
        : {}),
    }
  // Omit cleared optional fields. Imported and manual candidates share the same strict validator.
  return manualOriginalChargeCandidate(
    JSON.parse(JSON.stringify({ category: input.category, record, ...facts })),
  )
}

/** A correction always starts from the existing category record, preserving its allocation detail. */
function existingCandidates(workspace: WorkspaceDraft): OriginalChargeCandidate[] {
  const rows = [
    ...workspace.configuration.chargePeriods.map((record) => ({
      category: 'subscription' as const,
      record,
    })),
    ...workspace.planning.equipment.map((record) => ({ category: 'equipment' as const, record })),
    ...workspace.planning.homeCosts.map((record) => ({ category: 'home' as const, record })),
    ...workspace.planning.directCosts.map((record) => ({ category: 'direct' as const, record })),
  ]
  return rows.map((row) =>
    originalChargeCandidateFromSource(workspace, row.category, row.record.id),
  )
}
function toInput(candidate: OriginalChargeCandidate): Input {
  const input = blank(candidate.category),
    record = candidate.record
  Object.assign(input, {
    id: record.id,
    baseline: candidate,
    label:
      'planName' in record
        ? record.planName
        : 'name' in record
          ? record.name
          : 'note' in record
            ? (record.note ?? '')
            : '',
    currency: candidate.original.currency ?? '',
    amount: candidate.original.amount ?? '',
    amountJpy: candidate.original.amountJpy === null ? '' : String(candidate.original.amountJpy),
    unknownOriginal: candidate.original.amount === null,
    unknownJpy: candidate.original.amountJpy === null,
    unknownAmountReason: candidate.original.unknownAmountReason ?? '',
    unknownJpyReason: candidate.original.unknownJpyReason ?? '',
    ...candidate.dates,
    startedOn: candidate.servicePeriod?.startedOn ?? '',
    endedOn: candidate.servicePeriod?.endedOn ?? '',
    contractReference: candidate.contract?.reference ?? '',
    contractReason: candidate.contract?.reason ?? '',
    evidenceIds: candidate.evidenceIds,
    conversionEvidenceIds: candidate.original.conversionEvidenceIds ?? [],
    rate: candidate.original.fx?.jpyPerUnit ?? '',
    convertedOn: candidate.original.fx?.convertedOn ?? '',
    conversionReference: candidate.original.fx?.reference ?? '',
    rounding: candidate.original.fx?.rounding ?? 'nearest-yen',
  })
  if (candidate.category === 'subscription') input.provider = candidate.record.provider
  if (candidate.category === 'equipment')
    Object.assign(input, {
      equipmentType: candidate.record.equipmentType,
      businessUseStartedOn: candidate.record.businessUseStartedOn ?? '',
      usefulLifeYears:
        candidate.record.usefulLifeYears === undefined
          ? ''
          : String(candidate.record.usefulLifeYears),
      convertedFromPrivate: candidate.record.convertedFromPrivate,
      role: candidate.record.role,
      businessPercent: String(candidate.record.businessUseRatio * 100),
      projectPercent: String(candidate.record.projectAllocationRatio * 100),
      taxUnitId: candidate.record.taxUnitId ?? '',
    })
  if (candidate.category === 'home')
    Object.assign(input, {
      month: candidate.record.month,
      homeCategory: candidate.record.category,
      homeMethod: candidate.record.method,
      businessPercent: String(candidate.record.businessUseRatio * 100),
      projectPercent: String(candidate.record.projectAllocationRatio * 100),
      basis: candidate.record.basis,
      rationale: candidate.record.rationale,
      treatment: candidate.record.treatment,
      taxUnitId: candidate.record.taxUnitId ?? '',
      targets: candidate.record.targets ?? [],
    })
  if (candidate.category === 'direct')
    Object.assign(input, {
      costType: candidate.record.costType,
      directlyAttributable: candidate.record.directlyAttributable,
      treatment: candidate.record.treatment,
      taxUnitId: candidate.record.taxUnitId ?? '',
      targets: candidate.record.targets ?? [],
    })
  return input
}
function candidateLabel(candidate: OriginalChargeCandidate) {
  const record = candidate.record
  return 'planName' in record
    ? record.planName
    : 'name' in record
      ? record.name
      : 'month' in record
        ? `${record.month} ${record.category}`
        : record.note || record.costType
}

function duplicateMatches(candidate: OriginalChargeCandidate, others: OriginalChargeCandidate[]) {
  const period = (row: OriginalChargeCandidate) =>
    row.category === 'subscription'
      ? `${row.record.provider}:${row.record.serviceStartedOn}:${row.record.serviceEndedOn}`
      : row.category === 'home'
        ? `${row.record.category}:${row.record.month}`
        : row.category === 'equipment'
          ? row.record.acquiredOn
          : row.record.incurredOn
  if (candidate.original.amountJpy === null) return []
  return [
    ...new Map(
      others
        .filter(
          (other) =>
            other.category === candidate.category &&
            originalChargeSourceId(other) !== originalChargeSourceId(candidate) &&
            other.original.amountJpy === candidate.original.amountJpy &&
            period(other) === period(candidate),
        )
        .map((row) => [originalChargeSourceId(row), row]),
    ).values(),
  ]
}

export type OriginalChargeIntakeProps = {
  workspace: WorkspaceDraft
  datasetId: string
  disabled?: boolean
  onReview: (next: WorkspaceDraft) => Promise<boolean>
}
export default function OriginalChargeIntake(props: OriginalChargeIntakeProps) {
  return <IntakeEditor key={props.datasetId} {...props} />
}
function IntakeEditor({
  workspace,
  datasetId,
  disabled = false,
  onReview,
}: OriginalChargeIntakeProps) {
  const recovery = useEditorRecovery<Recovery>(
    datasetId,
    'original-charge-intake',
    workspace.revision,
    validRecovery,
  )
  const [preview, setPreview] = useState<{
    candidates: OriginalChargeCandidate[]
    workspace: WorkspaceDraft
    added: number
    skipped: number
    revision: number
  } | null>(null)
  const [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [reading, setReading] = useState(false)
  const [reviewed, setReviewed] = useState(false)
  const epoch = useRef(0),
    live = useRef(true),
    reviewLock = useRef(false),
    revision = useRef(workspace.revision)
  revision.current = workspace.revision
  const draft = recovery.value,
    input = draft?.kind === 'manual' ? draft.input : null
  const sources = existingCandidates(workspace)
  useEffect(() => {
    live.current = true
    const navigate = () => {
      epoch.current += 1
      setReading(false)
      setPreview(null)
      setReviewed(false)
    }
    window.addEventListener('popstate', navigate)
    return () => {
      live.current = false
      epoch.current += 1
      window.removeEventListener('popstate', navigate)
    }
  }, [])
  useEffect(() => {
    if (!reviewLock.current) epoch.current += 1
    setPreview(null)
    setReviewed(false)
    setReading(false)
  }, [workspace.revision])
  function edit(patch: Partial<Input>) {
    if (!input || reviewLock.current) return
    epoch.current += 1
    recovery.change({ kind: 'manual', input: { ...input, ...patch } })
    setPreview(null)
    setReviewed(false)
    setMessage('')
  }
  function cancel() {
    if (reviewLock.current) return
    epoch.current += 1
    setReading(false)
    setPreview(null)
    setReviewed(false)
    recovery.close()
    setMessage('入力を取り消しました。保存済みの費用は変更していません。')
  }
  function prepare(candidates: OriginalChargeCandidate[], freshImport = false) {
    let inherited = false
    let nextRecovery = recovery.value
    if (
      !freshImport &&
      draft?.kind === 'import' &&
      recovery.parentRevision !== workspace.revision &&
      candidates.some((candidate) => candidate.correctsId || candidate.legacySourceId)
    )
      throw new Error(
        '取込後に保存内容が変わりました。訂正候補は以前の配分を上書きする可能性があるため再適用しません。入力控えは保持しています。最新の元の支払から訂正を作り直すか、最新内容に合わせたファイルを読み直してください。',
      )
    if (input?.baseline) {
      const baseline = input.baseline
      const current = sources.find(
        (row) => originalChargeSourceId(row) === originalChargeSourceId(baseline),
      )
      if (!current || current.correctsId !== baseline.correctsId)
        throw new Error(
          '訂正元が編集中に変わりました。入力は保持しています。控えを保存してこの入力を取り消し、最新の元の支払を選び直してください。',
        )
      const base = baseline.record as unknown as Record<string, unknown>
      const remote = current.record as unknown as Record<string, unknown>
      const local = candidates[0].record as unknown as Record<string, unknown>
      const merged: Record<string, unknown> = {}
      const equal = (left: unknown, right: unknown) =>
        canonicalOriginalCharge(left) === canonicalOriginalCharge(right)
      for (const key of new Set([
        ...Object.keys(base),
        ...Object.keys(remote),
        ...Object.keys(local),
      ])) {
        let value: unknown
        if (equal(remote[key], base[key]) || equal(local[key], remote[key])) value = local[key]
        else if (equal(local[key], base[key])) {
          value = remote[key]
          inherited = true
        } else
          throw new Error(
            '種類別の同じ項目が編集中に双方で変更されています。以前の配分へ上書きせず、入力を保持しています。控えを保存して最新の元の支払から訂正を作り直してください。',
          )
        if (value !== undefined) merged[key] = value
      }
      const candidate = manualOriginalChargeCandidate({ ...candidates[0], record: merged })
      candidates = [candidate]
      nextRecovery = {
        kind: 'manual',
        input: {
          ...toInput(candidate),
          baseline: current,
          correctionReason: input.correctionReason,
        },
      }
    }
    const result = applyOriginalChargeCandidates(workspace, candidates, {
      recordedAt: new Date().toISOString(),
    })
    setPreview({
      candidates,
      workspace: result.workspace,
      added: result.addedFactIds.length,
      skipped: result.skippedSourceKeys.length,
      revision: workspace.revision,
    })
    setReviewed(false)
    setMessage(
      inherited
        ? '別の編集で更新された配分情報を候補に引き継ぎました。日付等の今回の訂正と一緒に確認してください。まだ保存していません。'
        : '候補を確認してください。まだ保存していません。',
    )
    if (nextRecovery && (inherited || recovery.parentRevision !== workspace.revision))
      recovery.rebase(nextRecovery, workspace.revision)
  }
  function previewDraft() {
    if (!draft || reviewLock.current) return
    epoch.current += 1
    try {
      prepare(draft.kind === 'import' ? draft.candidates : [fromInput(draft.input)])
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '入力を確認してください。')
      setPreview(null)
    }
  }
  async function read(file: File, restore = false) {
    if (reviewLock.current) return
    const token = ++epoch.current
    setReading(true)
    setPreview(null)
    setReviewed(false)
    setMessage('')
    try {
      if (file.size > (restore ? EDITOR_FILE_LIMIT : ORIGINAL_CHARGE_IMPORT_LIMIT))
        throw new Error(
          restore
            ? '入力控えは16 MiB以内にしてください。'
            : '原請求ファイルは512 KiB以内にしてください。',
        )
      const raw = await file.text()
      if (!live.current || token !== epoch.current) return
      if (restore) recovery.restore(raw, true)
      else {
        const format = file.name.toLowerCase().endsWith('.csv')
          ? 'csv'
          : file.name.toLowerCase().endsWith('.json')
            ? 'json'
            : null
        if (!format)
          throw new Error(
            '構造化CSVまたはJSONファイルを選択してください。画像・PDFはまだ読み取れません。',
          )
        const candidates = parseOriginalChargeImport(raw, format)
        // Only validated, allowlisted candidate fields enter recovery. The file body is discarded.
        recovery.rebase({ kind: 'import', candidates }, workspace.revision)
        prepare(candidates, true)
      }
    } catch (error) {
      if (live.current && token === epoch.current)
        setMessage(
          error instanceof Error
            ? error.message
            : 'ファイルを読み込めませんでした。手入力できます。',
        )
    } finally {
      if (live.current && token === epoch.current) setReading(false)
    }
  }
  async function review() {
    if (
      !preview ||
      !reviewed ||
      disabled ||
      reviewLock.current ||
      preview.revision !== revision.current ||
      preview.added === 0
    )
      return
    reviewLock.current = true
    setBusy(true)
    const token = ++epoch.current
    try {
      const saved = await onReview(preview.workspace)
      if (!live.current || token !== epoch.current) return
      if (saved) {
        recovery.close()
        setPreview(null)
        setReviewed(false)
        setMessage('元の支払と入力事実を保存しました。年度資料の採用は別の操作です。')
      } else setMessage('保存していません。入力と候補を保持しています。')
    } catch (error) {
      if (live.current && token === epoch.current)
        setMessage(
          error instanceof Error ? error.message : '保存できませんでした。入力は保持しています。',
        )
    } finally {
      reviewLock.current = false
      if (live.current) setBusy(false)
    }
  }
  function textField(key: keyof typeof strings, label: string, type = 'text') {
    return (
      <label>
        {label}
        <input
          type={type}
          value={input?.[key] ?? ''}
          maxLength={2000}
          onInput={(event) => edit({ [key]: event.currentTarget.value })}
          onChange={(event) => edit({ [key]: event.currentTarget.value })}
        />
      </label>
    )
  }
  function selectField(key: keyof typeof strings, label: string, values: Record<string, string>) {
    return (
      <label>
        {label}
        <select
          value={input?.[key] ?? ''}
          onChange={(event) => edit({ [key]: event.target.value })}
        >
          {Object.entries(values).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
    )
  }
  function dateField(
    key:
      | 'billedOn'
      | 'paidOn'
      | 'acquiredOn'
      | 'incurredOn'
      | 'startedOn'
      | 'endedOn'
      | 'businessUseStartedOn'
      | 'convertedOn',
    label: string,
  ) {
    return (
      <label>
        {label}
        <DateInput value={input?.[key] ?? ''} onValueChange={(value) => edit({ [key]: value })} />
      </label>
    )
  }
  function evidenceFields(key: 'evidenceIds' | 'conversionEvidenceIds', title: string) {
    return (
      <fieldset>
        <legend>{title}</legend>
        {!workspace.planning.evidence.length && (
          <p>根拠資料は未登録です。証拠画面で登録してから参照を選べます。</p>
        )}
        {workspace.planning.evidence.map((evidence) => (
          <label key={evidence.id} className="intake-check">
            <input
              type="checkbox"
              checked={input?.[key].includes(evidence.id) ?? false}
              onChange={(event) =>
                edit({
                  [key]: event.target.checked
                    ? [...(input?.[key] ?? []), evidence.id]
                    : input?.[key].filter((id) => id !== evidence.id),
                })
              }
            />
            {evidence.note}
          </label>
        ))}
        {(input?.[key] ?? [])
          .filter((id) => !workspace.planning.evidence.some((row) => row.id === id))
          .map((id) => (
            <p key={id} role="alert">
              現在の資料にない根拠参照：{id}
            </p>
          ))}
      </fieldset>
    )
  }
  return (
    <section className="panel original-charge-intake" aria-label="元の支払の統一入力">
      <h2>元の支払をまとめて入力</h2>
      <p>
        手入力とCSV・JSONは同じ候補確認を通ります。請求日・支払日・取得日・発生日を分け、金額不明と確認した0円を区別します。
      </p>
      <p>
        画像・PDFの読み取りは未対応です。読み込んだファイルの全文やパスは入力控えへ保存しません。
      </p>
      {message && <p role="status">{message}</p>}
      {reading && (
        <p role="status">ファイルを確認しています。別のファイルの選択や取り消しができます。</p>
      )}
      {recovery.warning && <p role="alert">{recovery.warning}</p>}
      {recovery.unreadable > 0 && <p role="alert">読めない入力控えを削除せず保持しています。</p>}
      {recovery.copies.map(({ copy, raw }) => (
        <button
          key={copy.id}
          type="button"
          disabled={busy || Boolean(draft)}
          onClick={() => {
            epoch.current += 1
            setReading(false)
            recovery.restore(raw)
            setPreview(null)
          }}
        >
          支払入力を復旧（{copy.updatedAt}）
        </button>
      ))}
      <div className="intake-actions">
        <button
          type="button"
          disabled={disabled || busy || Boolean(draft)}
          onClick={() => {
            epoch.current += 1
            setReading(false)
            setMessage('')
            recovery.change({ kind: 'manual', input: blank() })
          }}
        >
          新しい支払を手入力
        </button>
        <label>
          既存の支払を訂正
          <select
            value=""
            disabled={disabled || busy || Boolean(draft)}
            onChange={(event) => {
              const selected = sources.find(
                (row) => originalChargeSourceId(row) === event.target.value,
              )
              if (selected) {
                epoch.current += 1
                setReading(false)
                recovery.change({ kind: 'manual', input: toInput(selected) })
                setMessage(
                  '元の記録を残し、訂正を追加します。金額が同じでも日付・根拠を訂正できます。',
                )
              }
            }}
          >
            <option value="">訂正する支払を選択</option>
            {sources.map((row) => (
              <option key={originalChargeSourceId(row)} value={originalChargeSourceId(row)}>
                {categoryLabels[row.category]} / {candidateLabel(row)} /{' '}
                {row.original.amountJpy === null ? '金額不明' : yen.format(row.original.amountJpy)}
              </option>
            ))}
          </select>
        </label>
        <label>
          構造化CSV・JSONを読み込む
          <input
            type="file"
            accept=".csv,.json,text/csv,application/json"
            disabled={disabled || busy || draft?.kind === 'manual'}
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) void read(file)
            }}
          />
        </label>
      </div>
      <details>
        <summary>読み込める形式</summary>
        <p>
          JSONは候補の配列、またはversion:
          1とcandidatesの配列です。各候補にcategory、record、original、evidenceIds、provenance.sourceKeyが必要です。sourceKeyは取込元で安定した請求IDにしてください。同じIDの内容変更は新しい訂正として入力します。
        </p>
        <p>
          CSVの列：category, record, original, dates, servicePeriod, contract, evidenceIds,
          sourceKey, correctsId, legacySourceId,
          correctionReason。recordやoriginal等の構造化欄はJSONです。1ファイル512
          KiB・500件までです。余分な項目や不正な値があれば全体を取り込みません。
        </p>
      </details>
      {!draft && (
        <label>
          支払入力の控えを読み込む
          <input
            type="file"
            accept="application/json,.json"
            disabled={busy || disabled}
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) void read(file, true)
            }}
          />
        </label>
      )}
      {input && (
        <fieldset disabled={busy || disabled}>
          <legend>{input.baseline ? '元の支払の訂正' : '新しい支払の事実'}</legend>
          <label>
            支払の種類
            <select
              value={input.category}
              disabled={Boolean(input.baseline)}
              onChange={(event) => {
                if (input.baseline) return
                edit({ category: event.target.value as Category })
              }}
            >
              {Object.entries(categoryLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          {input.baseline && (
            <>
              <p>
                元費用ID：{originalChargeSourceId(input.baseline)} / 訂正前の記録：
                {input.baseline.correctsId ?? '従来の入力'}
              </p>
              {textField('correctionReason', '訂正の理由（必須）')}
            </>
          )}
          <div className="intake-grid">
            {textField(
              'label',
              input.category === 'subscription'
                ? '契約プラン名'
                : input.category === 'equipment'
                  ? '設備名'
                  : '支払の説明',
            )}
            {textField('currency', '原通貨（JPY・USDなど、不明は空欄）')}
            <label className="intake-check">
              <input
                type="checkbox"
                checked={input.unknownOriginal}
                onChange={(event) => edit({ unknownOriginal: event.target.checked })}
              />
              原通貨の金額が不明
            </label>
            {input.unknownOriginal
              ? textField('unknownAmountReason', '原通貨の金額が不明な理由')
              : textField('amount', '原通貨の金額（十進数）')}
            <label className="intake-check">
              <input
                type="checkbox"
                checked={input.unknownJpy}
                onChange={(event) => edit({ unknownJpy: event.target.checked })}
              />
              採用する円額が不明
            </label>
            {input.unknownJpy
              ? textField('unknownJpyReason', '採用する円額が不明な理由')
              : textField('amountJpy', '採用する円額（整数円）')}
          </div>
          {!input.unknownOriginal &&
            !input.unknownJpy &&
            input.currency.toUpperCase() !== 'JPY' && (
              <fieldset>
                <legend>外貨から円への換算</legend>
                <p>採用した為替レートと確認先を入力します。自動の相場取得は行いません。</p>
                <div className="intake-grid">
                  {textField('rate', '1通貨単位あたりの円額')}
                  {dateField('convertedOn', '換算日')}
                  {textField('conversionReference', '換算率の確認先・根拠')}
                  <label>
                    円未満の丸め
                    <select
                      value={input.rounding}
                      onChange={(event) =>
                        edit({ rounding: event.target.value as Input['rounding'] })
                      }
                    >
                      <option value="nearest-yen">四捨五入</option>
                      <option value="floor-yen">切り捨て</option>
                      <option value="ceiling-yen">切り上げ</option>
                    </select>
                  </label>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    try {
                      edit({ amountJpy: String(convertedYen(fx(input))) })
                    } catch (error) {
                      setMessage(
                        error instanceof Error ? error.message : '換算条件を確認してください。',
                      )
                    }
                  }}
                >
                  この換算額を円額に採用
                </button>
                {evidenceFields('conversionEvidenceIds', '換算の根拠資料')}
              </fieldset>
            )}
          <fieldset>
            <legend>日付・利用期間・実際の契約</legend>
            <p>確認できた日だけ入力してください。支払日から利用開始や税務処理を決めません。</p>
            <div className="intake-grid">
              {dateField('billedOn', '請求日')}
              {dateField('paidOn', '支払日')}
              {dateField('acquiredOn', '取得日')}
              {dateField('incurredOn', '発生日')}
              {dateField('startedOn', '利用期間の開始日')}
              {dateField('endedOn', '利用期間の終了日')}
              {textField('contractReference', '実際の契約の呼び名・参照')}
              {textField('contractReason', '契約との対応の根拠')}
              {input.baseline?.category === 'subscription' &&
                input.baseline.record.contractConfirmation &&
                input.baseline.record.contractConfirmation.reference !==
                  input.contractReference && (
                  <p role="note">
                    実際の契約を変更したため、以前の契約確認を外します。重なる契約がある場合は契約との対応を改めて確認してください。
                  </p>
                )}
            </div>
          </fieldset>
          <fieldset>
            <legend>この種類に必要な配分・設備の情報</legend>
            {input.category === 'subscription' && (
              <>
                {selectField('provider', 'AIサービス', { claude: 'Claude Code', codex: 'Codex' })}
                <p>
                  AI利用の配分は既存の利用記録・月別料金の優先順位で計算します。上の利用期間が必要です。
                </p>
              </>
            )}
            {input.category === 'equipment' && (
              <>
                <p>
                  取得日が必要です。減価償却等の採用方法は設備の方法設定で確認します。既存の方法記録は維持します。
                </p>
                <div className="intake-grid">
                  {selectField('equipmentType', '設備の種類', {
                    pc: 'PC',
                    gpu: 'GPU',
                    dgx: 'DGX',
                    server: 'サーバー',
                    desk: '机',
                    peripheral: '周辺機器',
                    other: 'その他',
                  })}
                  {textField('role', '設備の用途')}
                  {dateField('businessUseStartedOn', '業務利用開始日')}
                  {textField('usefulLifeYears', '耐用年数（確認できた場合）')}
                  {textField('businessPercent', '設備の業務利用割合（%）')}
                  {textField('projectPercent', '設備の業務分から制作物への割合（%）')}
                </div>
                <label className="intake-check">
                  <input
                    type="checkbox"
                    checked={input.convertedFromPrivate}
                    onChange={(event) => edit({ convertedFromPrivate: event.target.checked })}
                  />
                  私用から業務用へ転用した
                </label>
              </>
            )}
            {input.category === 'home' && (
              <div className="intake-grid">
                {textField('month', '自宅費用の対象月', 'month')}
                {selectField('homeCategory', '自宅費用の種類', {
                  rent: '家賃',
                  electricity: '電気',
                  internet: '通信',
                })}
                {selectField('homeMethod', '業務分の求め方', {
                  area: '面積',
                  'area-time': '面積と時間',
                  meter: 'メーター',
                  'watt-hour': '消費電力と時間',
                  'usage-time': '利用時間',
                  'fixed-ratio': '確認した割合',
                })}
                {textField('businessPercent', '自宅費用の業務利用割合（%）')}
                {textField('projectPercent', '自宅費用の業務分から制作物への割合（%）')}
                {textField('basis', '配分の計算根拠')}
                {textField('rationale', '配分方法を選んだ理由')}
              </div>
            )}
            {input.category === 'direct' && (
              <>
                <p>発生日が必要です。</p>
                {selectField('costType', '直接費の種類', {
                  outsource: '外注',
                  material: '素材',
                  cloud: 'クラウド',
                  domain: 'ドメイン',
                  license: 'ライセンス',
                  'old-version-balance': '旧版の残高',
                  other: 'その他',
                })}
                <label className="intake-check">
                  <input
                    type="checkbox"
                    checked={input.directlyAttributable}
                    onChange={(event) => edit({ directlyAttributable: event.target.checked })}
                  />
                  制作物に直接対応することを確認した
                </label>
              </>
            )}
            {input.category !== 'subscription' && (
              <label>
                単一の対応先（複数配分がある場合はそちらを優先）
                <select
                  value={input.taxUnitId}
                  onChange={(event) => edit({ taxUnitId: event.target.value })}
                >
                  <option value="">制作物の指定なし</option>
                  {workspace.planning.taxUnits.map((unit) => (
                    <option key={unit.id} value={unit.id}>
                      {unit.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {(input.category === 'direct' || input.category === 'home') && (
              <>
                {selectField('treatment', '費用の配分先の種類', {
                  direct: '直接対応',
                  shared: '共用',
                  general: '事業全般',
                })}
                <AllocationTargetsEditor
                  name="元の支払"
                  targets={input.targets as AllocationTarget[]}
                  units={workspace.planning.taxUnits}
                  onChange={(targets) => edit({ targets })}
                />
              </>
            )}
          </fieldset>
          {evidenceFields('evidenceIds', '請求・支払の根拠資料')}
        </fieldset>
      )}
      {(draft || reading) && (
        <div className="intake-actions">
          {draft && (
            <>
              <button type="button" disabled={busy || reading || disabled} onClick={previewDraft}>
                {recovery.parentRevision === workspace.revision
                  ? '入力から候補を確認'
                  : '現在の保存内容で候補を再確認'}
              </button>
              <button type="button" disabled={busy} onClick={recovery.exportCopy}>
                支払入力の控えを保存
              </button>
            </>
          )}
          <button type="button" disabled={busy} onClick={cancel}>
            この支払入力を取り消す
          </button>
        </div>
      )}
      {preview && (
        <section aria-label="元の支払の候補プレビュー" className="intake-preview">
          <h3>保存前の候補確認</h3>
          <p>
            入力{preview.candidates.length}件 / 新しい事実{preview.added}件 /
            同じ取込キー・同じ内容で登録済み{preview.skipped}件
          </p>
          <p>
            同額・同期間でも別契約の可能性があります。重複を理由に自動で削除しません。金額が同じ訂正も変更として確認します。
          </p>
          {preview.candidates.map((candidate, index) => (
            <article key={`${originalChargeSourceId(candidate)}-${index}`}>
              <h4>
                {categoryLabels[candidate.category]}：{candidateLabel(candidate)}
              </h4>
              <p>元費用ID：{originalChargeSourceId(candidate)}</p>
              <p>
                原通貨：{candidate.original.amount ?? '不明'}{' '}
                {candidate.original.currency ?? '通貨不明'} / 採用円額：
                {candidate.original.amountJpy === null
                  ? '不明'
                  : yen.format(candidate.original.amountJpy)}
              </p>
              {candidate.original.unknownAmountReason && (
                <p>原通貨の金額が不明な理由：{candidate.original.unknownAmountReason}</p>
              )}
              {candidate.original.unknownJpyReason && (
                <p>円額が不明な理由：{candidate.original.unknownJpyReason}</p>
              )}
              <p>
                請求日：{candidate.dates?.billedOn ?? '未確認'} / 支払日：
                {candidate.dates?.paidOn ?? '未確認'} / 取得日：
                {candidate.dates?.acquiredOn ?? '未確認'} / 発生日：
                {candidate.dates?.incurredOn ?? '未確認'}
              </p>
              <p>
                利用期間：
                {candidate.servicePeriod
                  ? `${candidate.servicePeriod.startedOn}〜${candidate.servicePeriod.endedOn}`
                  : '未確認'}{' '}
                / 実際の契約：{candidate.contract?.reference ?? '未確認'}
              </p>
              {candidate.original.fx && (
                <p>
                  換算：1 {candidate.original.fx.currency} = {candidate.original.fx.jpyPerUnit} 円 /{' '}
                  {candidate.original.fx.convertedOn} / {candidate.original.fx.reference} /{' '}
                  {
                    {
                      'floor-yen': '切り捨て',
                      'nearest-yen': '四捨五入',
                      'ceiling-yen': '切り上げ',
                    }[candidate.original.fx.rounding]
                  }
                </p>
              )}
              {(candidate.correctsId || candidate.legacySourceId) && (
                <p>
                  訂正元：{candidate.correctsId ?? candidate.legacySourceId} / 理由：
                  {candidate.correctionReason}
                </p>
              )}
              {candidate.provenance.sourceKey && (
                <p>
                  取込キー：{candidate.provenance.sourceKey} / 内容ハッシュ：
                  {candidate.provenance.contentHash}
                </p>
              )}
              {duplicateMatches(candidate, [...sources, ...preview.candidates]).map((other) => (
                <p role="note" key={originalChargeSourceId(other)}>
                  重複の可能性：{candidateLabel(other)} / {originalChargeSourceId(other)} / 契約：
                  {other.contract?.reference ?? '未確認'}
                  。同額・同期間の別契約か、訂正かを確認してください。
                </p>
              ))}
              <EvidenceReferences
                ids={candidate.evidenceIds}
                records={workspace.planning.evidence}
              />
              <details>
                <summary>保存する種類別情報・配分を確認</summary>
                <pre>{JSON.stringify(candidate.record, null, 2)}</pre>
              </details>
            </article>
          ))}
          {preview.added > 0 ? (
            <>
              <label className="intake-check">
                <input
                  type="checkbox"
                  checked={reviewed}
                  disabled={busy || disabled}
                  onChange={(event) => setReviewed(event.target.checked)}
                />
                原額・日付・契約・根拠・配分と重複候補を確認した
              </label>
              <button
                type="button"
                className="primary-button"
                disabled={!reviewed || busy || disabled || preview.revision !== workspace.revision}
                onClick={() => void review()}
              >
                {busy ? '保存前の確認中…' : '変更の影響を確認'}
              </button>
            </>
          ) : (
            <p>追加する事実はありません。登録済みの入力をもう一度保存しません。</p>
          )}
        </section>
      )}
    </section>
  )
}
