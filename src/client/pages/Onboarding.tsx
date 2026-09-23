import AllocationTargetsEditor from './AllocationTargetsEditor'
import { monthlyChargeInputIssue } from '../monthlyChargeValidation'
import MonthlyChargesEditor from './MonthlyChargesEditor'
import DuplicateChargesPanel from './DuplicateChargesPanel'
import DecisionEditor from './DecisionEditor'
import ConsultationContextPanel from './ConsultationContextPanel'
import type { ConsultationNavigation } from '../consultationNavigation'
import CostPresenceEditor from './CostPresenceEditor'
import EquipmentMethodsEditor from './EquipmentMethodsEditor'
import DateInput from './DateInput'
import PlanningDateRepairPanel from './PlanningDateRepairPanel'
import { costPresenceRecordsSchema } from '../../planning/costPresence'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  DashboardData,
  HistorySource,
  HistorySourceInput,
  HistorySourceTestResult,
  LocalConfiguration,
  ProviderKey,
  RuntimeData,
  ScanMode,
  ScanProgress,
  ScanResult,
} from '../types'
import type {
  DirectCostRecord,
  EquipmentRecord,
  EvidenceRecord,
  HomeCostRecord,
  LifecycleEventType,
  PlanningSnapshot,
  TaxUnitRecord,
} from '../../planning/types'
import {
  chargeContractBasis,
  chargePeriodIsValid,
  type ProviderChargePeriod,
} from '../../core/chargePeriods'
import { diagnosePlanning } from '../../core/diagnosis'
import AnnualOverview from './AnnualOverview'
import CostsPage from './CostsPage'
import { getScanProgress } from '../api'
import {
  applyCandidateDestinations,
  candidateGroupByTaxUnit,
  destinationSummary,
  normalizedProductGroup,
  type CandidateDestination,
  type CandidateDestinations,
} from '../candidateGrouping'
import { invertedContractMessage, providerWithInvertedContract } from '../chargeGuard'
import { createFocusTrap } from '../focusTrap.js'
import { providerHasEnabledSource, recentScanTime } from '../historySources'
import { displayMonth } from '../monthLabel.js'
import HistorySourceManager from './HistorySourceManager'
import { categoryLabel, lifecycleLabel, monthKeyFromLabel, usageModeLabel } from './shared'
import type { WorkspaceDraft } from '../../planning/workspace'
import {
  listWorkspaceRecovery,
  writeWorkspaceRecovery,
  removeWorkspaceRecovery,
  type WorkspaceRecovery,
  type WorkspaceEditorInput,
} from '../workspaceRecovery'

function Onboarding({
  consultation,
  step,
  data,
  runtime,
  runtimeLoading,
  historySources,
  configuration,
  planning,
  unassignedFolderCount,
  onStep,
  onScan,
  onSaveHistorySource,
  onTestHistorySource,
  onRemoveHistorySource,
  onSaveWorkspace,
  suspended = false,
  resolvedSaveCount = 0,
  resolvedSaveMessage = '比較して選んだ内容を保存しました。入力を続けられます。',
  onPreviewWorkspace,
  onReviewWorkspace,
  onSaveRetention,
  onClose,
  onSaved,
  workspaceBase,
  onRestoreWorkspaceBase,
}: {
  consultation?: ConsultationNavigation
  step: number
  data: DashboardData
  runtime: RuntimeData | null
  runtimeLoading: boolean
  historySources: HistorySource[]
  configuration: LocalConfiguration | null
  planning: PlanningSnapshot
  unassignedFolderCount: number
  onStep: (step: number) => void
  onScan: (providers: ProviderKey[], mode?: ScanMode) => Promise<ScanResult>
  onSaveHistorySource: (source: HistorySourceInput, sourceId?: string) => Promise<void>
  onTestHistorySource: (source: HistorySourceInput) => Promise<HistorySourceTestResult>
  onRemoveHistorySource: (sourceId: string) => Promise<void>
  onSaveWorkspace: (configuration: LocalConfiguration, planning: PlanningSnapshot) => Promise<void>
  suspended?: boolean
  resolvedSaveCount?: number
  resolvedSaveMessage?: string
  onPreviewWorkspace?: (
    configuration: LocalConfiguration,
    planning: PlanningSnapshot,
  ) => Promise<void>
  onReviewWorkspace?: (
    configuration: LocalConfiguration,
    planning: PlanningSnapshot,
  ) => Promise<boolean>
  onSaveRetention: (
    days: number,
  ) => Promise<{ days: number; previousDays?: number; backupFileName?: string }>
  onClose: () => void
  onSaved?: () => void
  workspaceBase?: WorkspaceDraft
  onRestoreWorkspaceBase?: (base: WorkspaceDraft) => Promise<void>
}) {
  const steps = ['履歴', '候補整理', '制作物', '費用', '結果']
  const isDemoData = data.meta.source === 'demo'
  const apiUnavailable = !runtime
  const [selectedProviders, setSelectedProviders] = useState<ProviderKey[]>(['claude', 'codex'])
  const [scanMode, setScanMode] = useState<ScanMode>('incremental')
  const [claudeCharge, setClaudeCharge] = useState<number | null | undefined>(undefined)
  const [codexCharge, setCodexCharge] = useState<number | null | undefined>(undefined)
  const [unknownChargeReasons, setUnknownChargeReasons] = useState<
    NonNullable<LocalConfiguration['unknownChargeReasons']>
  >({})
  const [monthlyCharges, setMonthlyCharges] = useState<LocalConfiguration['monthlyCharges']>([])
  const [chargePeriods, setChargePeriods] = useState<ProviderChargePeriod[]>([])
  const [contracts, setContracts] = useState<LocalConfiguration['contracts']>({
    claude: {},
    codex: {},
  })
  // Remember WHICH providers were warned about, not just that a warning fired.
  // A bare boolean goes stale: warn about Claude, then re-select Codex on an
  // earlier step, and the second press would skip the check entirely and save
  // Codex as 0 yen without ever naming it.
  const [unobservedPercent, setUnobservedPercent] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null)
  const [lastScanResult, setLastScanResult] = useState<ScanResult | null>(null)
  const [notice, setNotice] = useState<{
    kind: 'success' | 'error' | 'info'
    message: string
  } | null>(null)
  const [retentionDays, setRetentionDays] = useState<number | undefined>(undefined)
  const [retentionBusy, setRetentionBusy] = useState(false)
  const [planningDraft, setPlanningDraft] = useState<PlanningSnapshot>(planning)
  const [candidateQuery, setCandidateQuery] = useState('')
  const [bulkGroup, setBulkGroup] = useState('')
  const [showResultCosts, setShowResultCosts] = useState(false)
  const [candidateDestinations, setCandidateDestinations] = useState<CandidateDestinations>({})
  const [recoveryTouched, setRecoveryTouched] = useState(false)
  const [recoveryMessage, setRecoveryMessage] = useState('')
  const [recoveryRecords, setRecoveryRecords] = useState<WorkspaceRecovery[]>([])
  const [restoredRecord, setRestoredRecord] = useState<WorkspaceRecovery | null>(null)
  const ownRecovery = useRef<WorkspaceRecovery | null>(null)
  const sourceRecovery = useRef<WorkspaceRecovery | null>(null)
  const recoveryBase = useRef(workspaceBase)
  const editorInput = useMemo<WorkspaceEditorInput>(
    () => ({
      claudeCharge,
      codexCharge,
      unknownChargeReasons,
      monthlyCharges,
      contracts,
      chargePeriods,
      unobservedPercent,
      planning: planningDraft,
      candidateDestinations,
      selectedProviders,
      step,
    }),
    [
      claudeCharge,
      codexCharge,
      unknownChargeReasons,
      monthlyCharges,
      contracts,
      chargePeriods,
      unobservedPercent,
      planningDraft,
      candidateDestinations,
      selectedProviders,
      step,
    ],
  )
  function inspectRecovery() {
    if (!runtime?.datasetId) return
    try {
      const found = listWorkspaceRecovery(window.localStorage, runtime.datasetId)
      setRecoveryRecords(found.records.filter((record) => record.id !== ownRecovery.current?.id))
      setRecoveryMessage(
        found.unreadable
          ? '読めない形式の控えは削除せず保持しています。'
          : found.records.length
            ? ''
            : '復旧できる控えはありません。',
      )
    } catch {
      setRecoveryMessage('ブラウザの控えを読み取れません。')
    }
  }
  const clearSavedRecovery = useCallback(() => {
    setRecoveryTouched(false)
    try {
      if (ownRecovery.current) removeWorkspaceRecovery(window.localStorage, ownRecovery.current)
      if (sourceRecovery.current)
        removeWorkspaceRecovery(window.localStorage, sourceRecovery.current)
      ownRecovery.current = null
      sourceRecovery.current = null
      setRecoveryRecords([])
      setRecoveryMessage('保存が確認できた入力の控えを整理しました。')
    } catch {
      setRecoveryMessage('DB保存は成功しましたが、ブラウザの控えを整理できませんでした。')
    }
  }, [])
  const onboardingBodyRef = useRef<HTMLDivElement>(null)
  const modalRef = useRef<HTMLElement>(null)
  const [consultationFocus, setConsultationFocus] = useState<'fact' | 'method' | null>(null)
  useEffect(() => {
    if (!consultation || !consultationFocus || step !== (consultationFocus === 'fact' ? 2 : 3))
      return
    const selector =
      consultationFocus === 'fact' ? '[data-consultation-unit]' : '[data-consultation-decision]'
    const expected =
      consultationFocus === 'fact'
        ? consultation.taxUnitId
        : consultation.taxUnitId + ':' + consultation.answer.taxYear
    const target =
      [...(modalRef.current?.querySelectorAll<HTMLElement>(selector) ?? [])].find(
        (node) =>
          node.getAttribute(
            consultationFocus === 'fact' ? 'data-consultation-unit' : 'data-consultation-decision',
          ) === expected,
      ) ??
      (consultationFocus === 'method'
        ? modalRef.current?.querySelector<HTMLElement>('[aria-label="処理の判断記録"]')
        : null)
    target?.scrollIntoView?.({ block: 'center' })
    target?.querySelector<HTMLElement>('input,select,button')?.focus()
    setConsultationFocus(null)
  }, [consultation, consultationFocus, step])
  const onCloseRef = useRef(onClose)
  const rankedProducts = useMemo(
    () =>
      data.products
        .map((product, index) => ({ product, index }))
        .sort((left, right) => right.product.sessions - left.product.sessions),
    [data.products],
  )
  const visibleCandidateProducts = rankedProducts.filter(({ product }) =>
    product.name.toLowerCase().includes(candidateQuery.trim().toLowerCase()),
  )
  const candidateSummary = destinationSummary(candidateDestinations)
  const nextCandidateGroup = String(
    Math.max(
      0,
      ...Object.values(candidateDestinations).map((destination) =>
        destination.kind === 'product' ? Number(normalizedProductGroup(destination.group) ?? 0) : 0,
      ),
    ) + 1,
  )
  const observedHistoryMonths = data.products
    .flatMap((product) => [product.firstObservedMonth, product.lastObservedMonth])
    .filter((month): month is string => Boolean(month))
    .sort()
  const historyRangeText =
    observedHistoryMonths.length > 0
      ? `${displayMonth(observedHistoryMonths[0])}～${displayMonth(observedHistoryMonths.at(-1))}`
      : '利用時期を確認中'
  const draftDiagnosis = useMemo(() => diagnosePlanning(planningDraft), [planningDraft])
  const scanNotes = useMemo(() => {
    if (!lastScanResult) return []
    const notes: string[] = []
    for (const [provider, summary] of Object.entries(lastScanResult.providers)) {
      const label = provider === 'codex' ? 'Codex' : 'Claude Code'
      const diagnostics = summary?.diagnostics as
        | {
            nonUtcTimestamps?: number
            changedSinceLastScan?: number
            filesRead?: number
            filesReused?: number
            filesDeferred?: number
          }
        | undefined
      const nonUtc = Number(diagnostics?.nonUtcTimestamps ?? 0)
      if (nonUtc > 0) {
        notes.push(
          `${label}の履歴に、UTC表記でない日時が${nonUtc}件ありました。月の帰属がずれる場合があります。`,
        )
      }
      const changed = Number(diagnostics?.changedSinceLastScan ?? 0)
      if (changed > 0) {
        notes.push(
          `${label}の履歴のうち${changed}件が、前回の取り込みから内容が変わっていました。同じセッションを続ければ変わるのが普通です。身に覚えのない変化がないかだけ確かめてください。`,
        )
      }
      const filesRead = Number(diagnostics?.filesRead ?? 0)
      const filesReused = Number(diagnostics?.filesReused ?? 0)
      const filesDeferred = Number(diagnostics?.filesDeferred ?? 0)
      if (filesRead + filesReused > 0) {
        notes.push(
          `${label}は変更あり${filesRead}ファイルを読み、変更なし${filesReused}ファイルは前回結果を再利用しました。`,
        )
      }
      if (filesDeferred > 0) {
        notes.push(
          `${label}の更新中または形式確認待ち${filesDeferred}ファイルは、そのファイルだけ前回の正常値を保持しました。`,
        )
      }
    }
    for (const source of lastScanResult.sources ?? []) {
      if (source.status === 'complete') continue
      notes.push(
        source.status === 'unavailable'
          ? `${source.sourceName}へ接続できませんでした。前回の正常な取り込み分は保持しています。`
          : `${source.sourceName}を最後まで安全に読めませんでした。前回の正常な取り込み分は保持しています。`,
      )
    }
    return notes
  }, [lastScanResult])

  useEffect(() => {
    onboardingBodyRef.current?.scrollTo({ top: 0 })
  }, [step])

  useEffect(() => {
    if (!busy || step !== 0 || apiUnavailable) {
      setScanProgress(null)
      return
    }
    let cancelled = false
    const timer = window.setInterval(() => {
      getScanProgress()
        .then((progress) => {
          if (!cancelled) setScanProgress(progress)
        })
        .catch(() => {
          // The scan itself reports its own failure; a missed progress poll
          // must not replace that message with a less useful one.
        })
    }, 700)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [apiUnavailable, busy, step])

  useEffect(() => {
    if (!runtime) return
    setSelectedProviders(
      (['claude', 'codex'] as ProviderKey[]).filter(
        (provider) => runtime.providers[provider].detected,
      ),
    )
  }, [runtime])

  useEffect(() => {
    if (historySources.length === 0) return
    setSelectedProviders((current) =>
      current.filter((provider) => providerHasEnabledSource(historySources, provider)),
    )
  }, [historySources])

  useEffect(() => {
    if (!configuration) return
    setClaudeCharge(configuration.charges.claude)
    setCodexCharge(configuration.charges.codex)
    setContracts(configuration.contracts)
    setChargePeriods(configuration.chargePeriods ?? [])
    setUnobservedPercent(
      configuration.unobservedRatio === null ? null : configuration.unobservedRatio * 100,
    )
    setUnknownChargeReasons(configuration.unknownChargeReasons ?? {})
    setMonthlyCharges(configuration.monthlyCharges)
  }, [configuration])

  useEffect(() => {
    const autoDelete = runtime?.retention.claude.autoDelete
    if (autoDelete?.kind === 'configured') setRetentionDays(autoDelete.days)
  }, [runtime])

  useEffect(() => {
    setPlanningDraft(planning)
  }, [planning])

  useEffect(() => {
    setCandidateDestinations((current) => {
      const next = { ...current }
      const groupByTaxUnit = candidateGroupByTaxUnit(planning.taxUnits)
      let nextGroup = Math.max(0, ...[...groupByTaxUnit.values()].map(Number)) + 1

      for (const { product } of rankedProducts) {
        if (!product.projectKey || next[product.projectKey]) continue
        const firstRule = planning.projectRules
          .filter((rule) => rule.projectKey === product.projectKey)
          .sort((left, right) => left.effectiveFrom.localeCompare(right.effectiveFrom))[0]
        if (firstRule?.taxUnitId) {
          const group = groupByTaxUnit.get(firstRule.taxUnitId) ?? String(nextGroup++)
          groupByTaxUnit.set(firstRule.taxUnitId, group)
          next[product.projectKey] = {
            kind: 'product',
            group,
            existingTaxUnitId: firstRule.taxUnitId,
          }
        } else if (firstRule?.classification === 'private') {
          next[product.projectKey] = { kind: 'private' }
        } else if (firstRule?.classification === 'general-learning') {
          next[product.projectKey] = { kind: 'learning' }
        } else if (firstRule?.classification === 'unclassified') {
          next[product.projectKey] = { kind: 'later' }
        } else {
          next[product.projectKey] = { kind: 'later' }
        }
      }
      return next
    })
  }, [planning.projectRules, planning.taxUnits, rankedProducts])

  useEffect(() => {
    onCloseRef.current = onClose
  })

  const lastResolvedSave = useRef(resolvedSaveCount)
  useEffect(() => {
    if (lastResolvedSave.current !== resolvedSaveCount) {
      lastResolvedSave.current = resolvedSaveCount
      clearSavedRecovery()
      setNotice({
        kind: 'success',
        message: resolvedSaveMessage,
      })
    }
  }, [resolvedSaveCount, resolvedSaveMessage, clearSavedRecovery])

  useEffect(() => {
    if (!restoredRecord) return
    const input = restoredRecord.input
    setClaudeCharge(input.claudeCharge)
    setCodexCharge(input.codexCharge)
    setUnknownChargeReasons(input.unknownChargeReasons ?? {})
    setMonthlyCharges(input.monthlyCharges)
    setContracts(input.contracts)
    setChargePeriods(input.chargePeriods)
    setUnobservedPercent(input.unobservedPercent)
    setPlanningDraft(input.planning)
    setCandidateDestinations(input.candidateDestinations)
    setSelectedProviders(input.selectedProviders)

    setRecoveryTouched(true)
  }, [restoredRecord])
  useEffect(() => {
    const baseChanged = recoveryBase.current !== workspaceBase
    recoveryBase.current = workspaceBase
    if (baseChanged || !recoveryTouched || !workspaceBase || !runtime?.datasetId) return
    const record: WorkspaceRecovery = {
      version: 1,
      datasetId: runtime.datasetId,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      base: structuredClone(workspaceBase),
      input: structuredClone(editorInput),
    }
    try {
      writeWorkspaceRecovery(window.localStorage, record)
      const previous = ownRecovery.current
      ownRecovery.current = record
      if (previous) removeWorkspaceRecovery(window.localStorage, previous)
      setRecoveryMessage('編集中の料金・計画をこのブラウザに控えました。DB保存とは別です。')
    } catch {
      setRecoveryMessage('入力をブラウザへ控えられませんでした。画面の入力は保持しています。')
    }
  }, [editorInput, recoveryTouched, workspaceBase, runtime?.datasetId])

  useEffect(() => {
    const container = modalRef.current
    if (!container || suspended) return
    // Suspend the trap while the comparison dialog owns focus. Keep draft state mounted.
    return createFocusTrap(container, () => onCloseRef.current())
  }, [suspended])

  function toggleProvider(provider: ProviderKey) {
    setSelectedProviders((current) =>
      current.includes(provider)
        ? current.filter((item) => item !== provider)
        : [...current, provider],
    )
  }

  function updateProviderCharge(provider: ProviderKey, amount: number | null | undefined) {
    const normalized = amount == null ? amount : Math.max(0, amount)
    if (provider === 'claude') setClaudeCharge(normalized)
    else setCodexCharge(normalized)
    if (amount !== null)
      setUnknownChargeReasons((current) => {
        const next = { ...current }
        delete next[provider]
        return next
      })
  }

  function updateChargePeriod(index: number, patch: Partial<ProviderChargePeriod>) {
    setChargePeriods((current) =>
      current.map((period, periodIndex) =>
        periodIndex === index
          ? (() => {
              const updated = { ...period, ...patch }
              if (updated.contractConfirmation && !updated.contractConfirmation.confirmedAt)
                updated.contractConfirmation = {
                  ...updated.contractConfirmation,
                  basis: chargeContractBasis(updated),
                }
              return updated
            })()
          : period,
      ),
    )
  }

  function addChargePeriod() {
    const provider = selectedProviders[0] ?? 'claude'
    const observedStart = observedHistoryMonths[0]
    const start = observedStart ? `${observedStart}-01` : `${planningDraft.profile.taxYear}-01-01`
    const end = new Date(Date.UTC(Number(start.slice(0, 4)), Number(start.slice(5, 7)), 0))
      .toISOString()
      .slice(0, 10)
    setChargePeriods((current) => [
      ...current,
      {
        id: `charge-period-${Date.now()}`,
        provider,
        planName: '',
        serviceStartedOn: start,
        serviceEndedOn: end,
        amountJpy: null,
        unknownAmountReason: '請求額をまだ確認していません。',
      },
    ])
  }

  function updateTaxUnit(index: number, patch: Partial<TaxUnitRecord>) {
    setPlanningDraft((current) => ({
      ...current,
      taxUnits: current.taxUnits.map((unit, unitIndex) =>
        unitIndex === index ? { ...unit, ...patch } : unit,
      ),
    }))
  }

  function updateCandidateDestination(projectKey: string, destination: CandidateDestination) {
    setCandidateDestinations((current) => ({ ...current, [projectKey]: destination }))
  }

  /** Applies one treatment to every candidate the search currently shows. */
  function applyToVisibleCandidates(kind: CandidateDestination['kind']) {
    const keys = visibleCandidateProducts.flatMap(({ product }) =>
      product.projectKey ? [product.projectKey] : [],
    )
    setCandidateDestinations((current) => {
      const groups = new Set(
        keys.flatMap((key) => {
          const destination = current[key]
          return destination?.kind === 'product' ? [destination.group] : []
        }),
      )
      // A typed number joins an existing product; otherwise reuse the one number already given
      // to a shown candidate, or start a new group.
      const group =
        normalizedProductGroup(bulkGroup) ??
        (groups.size === 1 ? [...groups][0]! : nextCandidateGroup)
      const next = { ...current }
      for (const key of keys) {
        const existing = current[key]?.existingTaxUnitId
        next[key] = {
          ...(kind === 'product' ? { kind, group } : { kind }),
          ...(existing ? { existingTaxUnitId: existing } : {}),
        }
      }
      return next
    })
  }

  function materializeCandidateGroups(): PlanningSnapshot {
    const next = applyCandidateDestinations(
      planningDraft,
      rankedProducts.map(({ product }) => product),
      candidateDestinations,
    )
    setPlanningDraft(next)
    return next
  }

  function updateEquipment(index: number, patch: Partial<EquipmentRecord>) {
    setPlanningDraft((current) => ({
      ...current,
      equipment: current.equipment.map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...patch } : item,
      ),
    }))
  }

  function updateHomeCost(index: number, patch: Partial<HomeCostRecord>) {
    setPlanningDraft((current) => ({
      ...current,
      homeCosts: current.homeCosts.map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...patch } : item,
      ),
    }))
  }

  function updateDirectCost(index: number, patch: Partial<DirectCostRecord>) {
    setPlanningDraft((current) => ({
      ...current,
      directCosts: current.directCosts.map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...patch } : item,
      ),
    }))
  }

  function updateEvidence(index: number, patch: Partial<EvidenceRecord>) {
    setPlanningDraft((current) => ({
      ...current,
      evidence: current.evidence.map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...patch } : item,
      ),
    }))
  }

  function lifecycleDate(taxUnitId: string, eventType: LifecycleEventType) {
    return (
      planningDraft.lifecycleEvents.find(
        (event) => event.taxUnitId === taxUnitId && event.eventType === eventType,
      )?.occurredOn ?? ''
    )
  }

  function updateLifecycleDate(
    taxUnitId: string,
    eventType: LifecycleEventType,
    occurredOn: string,
  ) {
    setPlanningDraft((current) => {
      const existing = current.lifecycleEvents.find(
        (event) => event.taxUnitId === taxUnitId && event.eventType === eventType,
      )
      if (!occurredOn) {
        return {
          ...current,
          lifecycleEvents: current.lifecycleEvents.filter((event) => event !== existing),
        }
      }
      const next = {
        id: existing?.id ?? `event-${eventType}-${taxUnitId}`,
        taxUnitId,
        eventType,
        occurredOn,
        recordedAt: existing?.recordedAt ?? new Date().toISOString(),
        evidenceIds: existing?.evidenceIds ?? [],
        note: existing?.note ?? 'オンボーディングで登録',
      }
      return {
        ...current,
        lifecycleEvents: existing
          ? current.lifecycleEvents.map((event) => (event === existing ? next : event))
          : [...current.lifecycleEvents, next],
      }
    })
  }

  async function applyRetention() {
    if (!runtime || retentionDays === undefined) return
    // The native min/max attributes do not stop a typed 0, a negative, or a
    // decimal from being submitted. Catching it here keeps the server's
    // machine-readable 400 out of the message the user reads.
    if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 36500) {
      setNotice({
        kind: 'error',
        message: '保持する日数は、1以上36500以下の整数で入力してください。',
      })
      return
    }
    setRetentionBusy(true)
    setNotice(null)
    try {
      const result = await onSaveRetention(retentionDays)
      setNotice({
        kind: 'success',
        message: result.backupFileName
          ? `Claude Codeの履歴の保持期間を${result.days}日にしました。変更前の設定は、同じ場所に ${result.backupFileName} という名前で控えてあります。`
          : `Claude Codeの履歴の保持期間を${result.days}日にしました。設定ファイルがまだ無かったため、新しく作成しました。`,
      })
    } catch (error) {
      setNotice({
        kind: 'error',
        message: `保持期間を変更できませんでした。${error instanceof Error ? error.message : ''}`,
      })
    } finally {
      setRetentionBusy(false)
    }
  }

  async function advance() {
    setNotice(null)
    if (step === 0) {
      if (apiUnavailable) {
        setNotice({
          kind: 'info',
          message: 'デモではスキャンを行わず、合成された利用履歴で次へ進みます。',
        })
        onStep(1)
        return
      }
      if (!runtime) {
        setNotice({
          kind: 'error',
          message: 'ローカルサーバーへ接続できません。npm start後に再度お試しください。',
        })
        return
      }
      if (selectedProviders.length === 0) {
        setNotice({ kind: 'error', message: '確認するAIサービスを1つ以上選択してください。' })
        return
      }
      const unavailableProviders = selectedProviders.filter(
        (provider) => !providerHasEnabledSource(historySources, provider),
      )
      if (unavailableProviders.length > 0) {
        const labels = unavailableProviders
          .map((provider) => (provider === 'claude' ? 'Claude Code' : 'Codex'))
          .join('・')
        setNotice({
          kind: 'error',
          message: `${labels}で有効な読み取り元がありません。読み取り元を追加するか、停止中の設定を有効にしてください。`,
        })
        return
      }
      const recent = recentScanTime(historySources, selectedProviders, scanMode)
      if (recent) {
        // The startup scan usually finished moments ago; reading every file again only makes
        // the user wait. A full rescan stays available through the scan-mode choice.
        setNotice({
          kind: 'info',
          message: `${recent.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}に完了した走査結果を使います。読み直す場合は「完全再走査」を選んでください。`,
        })
        onStep(1)
        return
      }
      setBusy(true)
      try {
        const result = await onScan(selectedProviders, scanMode)
        setLastScanResult(result)
        const events = Object.values(result.providers).reduce(
          (sum, provider) => sum + (provider?.events ?? 0),
          0,
        )
        const incompleteSources = (result.sources ?? []).filter(
          (source) => source.status !== 'complete',
        )
        setNotice({
          kind: incompleteSources.length > 0 ? 'info' : 'success',
          message:
            incompleteSources.length > 0
              ? `${events.toLocaleString()}件を更新しました。読めなかった読み取り元は、前回の正常な取り込み分を保持しています。`
              : `${events.toLocaleString()}件の利用記録をローカルに取り込みました。`,
        })
        onStep(1)
      } catch (error) {
        setNotice({
          kind: 'error',
          message: `走査に失敗しました：${error instanceof Error ? error.message : '不明なエラー'}`,
        })
      } finally {
        setBusy(false)
      }
      return
    }
    if (step === 1) {
      const invalidGroup = Object.values(candidateDestinations).some(
        (destination) =>
          destination.kind === 'product' && !normalizedProductGroup(destination.group),
      )
      if (invalidGroup) {
        setNotice({
          kind: 'error',
          message: '制作物としてまとめる候補には、1以上のグループ番号を入力してください。',
        })
        return
      }
      materializeCandidateGroups()
      onStep(2)
      return
    }
    if (step === 2) {
      if (planningDraft.taxUnits.some((unit) => !unit.name.trim())) {
        setNotice({ kind: 'error', message: '作っているものの名前を入力してください。' })
        return
      }
      onStep(3)
      return
    }
    if (step === 3) {
      if (!costPresenceRecordsSchema.safeParse(planningDraft.costPresence ?? []).success) {
        setNotice({
          kind: 'error',
          message: '年度別の費用項目確認の理由・日時・重複を確認してください。',
        })
        return
      }
      const invalidEquipment = planningDraft.equipment.some(
        (item) => !item.name.trim() || !item.acquiredOn || !item.role.trim(),
      )
      const invalidHomeCost = planningDraft.homeCosts.some(
        (item) => !item.month || !item.basis.trim() || !item.rationale.trim(),
      )
      const invalidDirectCost = planningDraft.directCosts.some((item) => !item.incurredOn)
      const invalidEvidence = planningDraft.evidence.some((item) => !item.note.trim())
      if (invalidEquipment || invalidHomeCost || invalidDirectCost || invalidEvidence) {
        setNotice({
          kind: 'error',
          message:
            '空欄の必須項目があります。機器名・日付・役割・按分根拠・根拠メモを確認してください。',
        })
        return
      }
    }
    if (step === 4) {
      onSaved?.()
      onClose()
      return
    }
    const invalidContract = providerWithInvertedContract(contracts)
    if (chargePeriods.length === 0 && invalidContract) {
      setNotice({ kind: 'error', message: invertedContractMessage(invalidContract) })
      return
    }
    const invalidChargePeriod = chargePeriods.find((period) => !chargePeriodIsValid(period))
    if (invalidChargePeriod) {
      setNotice({
        kind: 'error',
        message: '請求履歴の利用開始日・終了日・実際の請求額を確認してください。',
      })
      return
    }
    if (!confirmMonthlyChargeInputs()) return
    if (apiUnavailable) {
      onStep(4)
      return
    }
    setBusy(true)
    try {
      if (onReviewWorkspace) {
        const saved = await onReviewWorkspace(configurationDraft(), planningDraft)
        if (!saved) return
      } else await onSaveWorkspace(configurationDraft(), planningDraft)
      clearSavedRecovery()
      setNotice({
        kind: 'success',
        message: '設定を保存し、入力後の結果へ再集計しました。',
      })
      onStep(4)
    } catch (error) {
      setNotice({
        kind: 'error',
        message: `保存結果を確認できませんでした：${error instanceof Error ? error.message : '不明なエラー'}`,
      })
    } finally {
      setBusy(false)
    }
  }

  function configurationDraft(): LocalConfiguration {
    const reasons = { ...unknownChargeReasons }
    if (claudeCharge === undefined) reasons.claude = '既定月額が未入力です。'
    if (codexCharge === undefined) reasons.codex = '既定月額が未入力です。'
    return {
      charges: {
        claude: claudeCharge == null ? null : Math.max(0, Math.round(claudeCharge)),
        codex: codexCharge == null ? null : Math.max(0, Math.round(codexCharge)),
      },
      ...(Object.keys(reasons).length ? { unknownChargeReasons: reasons } : {}),
      monthlyCharges,
      contracts,
      chargePeriods,
      unobservedRatio:
        unobservedPercent === null ? null : Math.min(95, Math.max(0, unobservedPercent)) / 100,
    }
  }
  function confirmMonthlyChargeInputs() {
    const issues = monthlyCharges
      .map(monthlyChargeInputIssue)
      .filter((issue): issue is string => issue !== null)
    for (const [provider, amount] of [
      ['claude', claudeCharge],
      ['codex', codexCharge],
    ] as const) {
      if (amount === null && !unknownChargeReasons[provider]?.trim())
        issues.push(provider + 'の既定月額が不明な理由を入力してください。')
    }
    if (!issues.length) return true
    setNotice({
      kind: 'error',
      message: issues.join(' ') + ' 入力は保持しています。「費用」の料金欄で修正できます。',
    })
    return false
  }
  async function saveProgress() {
    setNotice(null)
    if (apiUnavailable) {
      setNotice({
        kind: 'info',
        message: '公開デモでは保存しません。ローカル版では、ここまでの入力をこのPCに保存できます。',
      })
      return
    }
    if (!confirmMonthlyChargeInputs()) return
    setBusy(true)
    try {
      const draftToSave = step === 1 ? materializeCandidateGroups() : planningDraft
      await onSaveWorkspace(configurationDraft(), draftToSave)
      clearSavedRecovery()
      setNotice({
        kind: 'success',
        message: 'ここまでの入力を保存しました。次回は続きから確認できます。',
      })
    } catch (error) {
      setNotice({
        kind: 'error',
        message: `保存結果を確認できませんでした。入力はこの画面に残しています。詳細：${error instanceof Error ? error.message : '不明なエラー'}`,
      })
    } finally {
      setBusy(false)
    }
  }

  async function previewProgress() {
    if (!onPreviewWorkspace || apiUnavailable) return
    if (!confirmMonthlyChargeInputs()) return
    setBusy(true)
    setNotice(null)
    try {
      await onPreviewWorkspace(
        configurationDraft(),
        step === 1 ? materializeCandidateGroups() : planningDraft,
      )
    } catch (error) {
      setNotice({
        kind: 'error',
        message: error instanceof Error ? error.message : '影響を確認できませんでした。',
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="modal-backdrop"
      style={suspended ? { display: 'none' } : undefined}
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section
        className="onboarding-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-title"
        ref={modalRef}
        onChangeCapture={() => setRecoveryTouched(true)}
        onClickCapture={(event) => {
          if (!(event.target as HTMLElement).closest('[data-recovery-controls]'))
            setRecoveryTouched(true)
        }}
      >
        <button className="modal-close" aria-label="閉じる" onClick={onClose}>
          ×
        </button>
        <div className="onboarding-side">
          <span className="setup-kicker">はじめの準備</span>
          <h2 id="onboarding-title">
            税務の準備を、
            <br />
            少しずつ。
          </h2>
          <p>分からない項目は後回しにできます。入力した内容はこのPCだけに保存します。</p>
          {consultation && (
            <ConsultationContextPanel
              context={consultation}
              units={planningDraft.taxUnits}
              onNavigate={(kind) => {
                setConsultationFocus(kind)
                onStep(kind === 'fact' ? 2 : 3)
              }}
              onReturn={onClose}
            />
          )}
          {runtime?.datasetId && workspaceBase && onRestoreWorkspaceBase && (
            <section data-recovery-controls aria-label="料金と計画の入力復旧">
              <h3>前回の編集中入力</h3>
              <p>
                同じブラウザ・接続先の控えです。別PCには引き継がれず、DBバックアップにも含まれません。
              </p>
              <button disabled={busy} onClick={inspectRecovery}>
                料金・計画の控えを確認
              </button>
              {recoveryMessage && <p role="status">{recoveryMessage}</p>}
              {recoveryRecords.map((record) => (
                <article key={record.id}>
                  <p>
                    {record.createdAt} / 保存元の版 {record.base.revision}
                  </p>
                  <details>
                    <summary>控えた全入力</summary>
                    <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                      {JSON.stringify(
                        record.input,
                        (_key, value) =>
                          typeof value === 'number' && Number.isNaN(value)
                            ? '数値入力が空欄'
                            : value,
                        2,
                      )}
                    </pre>
                  </details>
                  <button
                    disabled={busy || recoveryTouched}
                    onClick={async () => {
                      setBusy(true)
                      try {
                        await onRestoreWorkspaceBase(record.base)
                        sourceRecovery.current = record
                        setRestoredRecord(record)
                        onStep(record.input.step)
                        setRecoveryMessage(
                          '入力を復旧しました。DBは変更していません。保存時に最新と照合します。',
                        )
                      } catch (error) {
                        setRecoveryMessage(
                          error instanceof Error ? error.message : '復旧できませんでした。',
                        )
                      } finally {
                        setBusy(false)
                      }
                    }}
                  >
                    料金・計画を復旧して編集
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => {
                      try {
                        removeWorkspaceRecovery(window.localStorage, record)
                        inspectRecovery()
                      } catch {
                        setRecoveryMessage('控えを削除できませんでした。')
                      }
                    }}
                  >
                    この入力の控えを削除
                  </button>
                </article>
              ))}
              {recoveryTouched && (
                <p>
                  別の控えを復旧するには、現在の入力を保存するか、画面を閉じて開き直してください。
                </p>
              )}
            </section>
          )}
          <div className="setup-progress" aria-label={`${step + 1}/${steps.length}まで進みました`}>
            <i style={{ width: `${((step + 1) / steps.length) * 100}%` }} />
            <span>
              {step + 1} / {steps.length}
            </span>
          </div>
          <ol>
            {steps.map((item, index) => (
              <li className={index === step ? 'active' : index < step ? 'done' : ''} key={item}>
                <span>{index < step ? '✓' : index + 1}</span>
                {item}
              </li>
            ))}
          </ol>
        </div>
        <div className="onboarding-main">
          <div className="onboarding-body" ref={onboardingBodyRef}>
            <PlanningDateRepairPanel planning={planningDraft} onChange={setPlanningDraft} />
            {isDemoData && (
              <div className="demo-mode-banner" role="status">
                <strong>デモモード</strong>
                <span>
                  ローカルAPIへ接続していないため、合成データを表示・編集しています。変更は保存されません。
                </span>
              </div>
            )}
            {step === 0 && (
              <>
                <span className="step-label">1 / 5　AIの利用履歴</span>
                <h3>{runtimeLoading ? 'ローカル履歴を探しています…' : 'AI開発履歴を確認'}</h3>
                <p>
                  履歴ファイル全体を読み取り専用で解析します。通常集計で本文やコードを保存・外部送信しません。このPCの既定履歴だけは、利用者が「内容を確認」を押したときに元ファイルから先頭プロンプトの短いプレビューを表示します。共有元では表示しません。
                </p>
                <div className="detected-list">
                  {(
                    [
                      ['claude', 'Claude Code', 'C'],
                      ['codex', 'Codex', 'O'],
                    ] as const
                  ).map(([key, label, monogram]) => {
                    const sourcesForProvider = historySources.filter(
                      (source) => source.provider === key && source.enabled,
                    )
                    const configured =
                      sourcesForProvider.length > 0 ||
                      (!historySources.length && (runtime?.providers[key].detected ?? isDemoData))
                    const available =
                      sourcesForProvider.some((source) => source.availability === 'available') ||
                      (!historySources.length && configured)
                    return (
                      <label className={!configured ? 'provider-undetected' : ''} key={key}>
                        <input
                          type="checkbox"
                          checked={selectedProviders.includes(key)}
                          disabled={!configured || busy || runtimeLoading}
                          onChange={() => toggleProvider(key)}
                        />
                        <span className={`provider-logo ${key === 'codex' ? 'codex' : ''}`}>
                          {monogram}
                        </span>
                        <span>
                          <strong>{label}</strong>
                          <small>
                            {historySources.length > 0
                              ? `読み取り元 ${sourcesForProvider.length}件`
                              : '読み取り元を確認中'}
                          </small>
                        </span>
                        <b>
                          {runtimeLoading
                            ? '確認中'
                            : !configured
                              ? '未設定'
                              : available
                                ? '利用可能'
                                : '要接続'}
                        </b>
                        <span className="check">{available ? '✓' : configured ? '!' : '—'}</span>
                      </label>
                    )
                  })}
                </div>
                {!apiUnavailable && (
                  <HistorySourceManager
                    sources={historySources}
                    disabled={busy || runtimeLoading}
                    onSave={async (source, sourceId) => {
                      await onSaveHistorySource(source, sourceId)
                      if (!sourceId && source.enabled !== false) {
                        setSelectedProviders((current) =>
                          current.includes(source.provider)
                            ? current
                            : [...current, source.provider],
                        )
                      }
                    }}
                    onTest={onTestHistorySource}
                    onRemove={onRemoveHistorySource}
                  />
                )}
                {!apiUnavailable && (
                  <div className="scan-mode-control">
                    <label>
                      <span>
                        <strong>走査方法</strong>
                        <small>通常は変更されたファイルだけを読みます</small>
                      </span>
                      <select
                        value={scanMode}
                        disabled={busy || runtimeLoading}
                        onChange={(event) => setScanMode(event.target.value as ScanMode)}
                      >
                        <option value="incremental">増分走査（通常）</option>
                        <option value="full">完全再走査</option>
                      </select>
                    </label>
                    <p>
                      完全再走査は、履歴形式の更新後や結果を最初から照合したい場合だけ使用します。
                    </p>
                  </div>
                )}
                {/* Gated on detection: without it, a Codex-only user would be
                    shown a Claude Code retention setting and one click would
                    create ~/.claude and a settings file for a tool they do not
                    have installed. */}
                {runtime?.retention.claude.detected && (
                  <details className="retention-box">
                    <summary>
                      履歴がいつ消えるかを確認する
                      {runtime.retention.claude.alreadyLosing && (
                        <b className="retention-alert">すでに失われた可能性があります</b>
                      )}
                    </summary>
                    <div className="retention-body">
                      <p>
                        Claude
                        Codeは、設定した日数を過ぎた履歴を削除します。削除された履歴はDevTaxからも復元できません。ここでの配賦は、残っている履歴だけを根拠にしています。
                      </p>
                      <dl className="retention-facts">
                        <div>
                          <dt>いまの設定</dt>
                          <dd>
                            {runtime.retention.claude.autoDelete.kind === 'configured'
                              ? `${runtime.retention.claude.autoDelete.days}日${
                                  runtime.retention.claude.autoDelete.source === 'default'
                                    ? '（未設定のため、Claude Codeの既定値）'
                                    : ''
                                }`
                              : runtime.retention.claude.autoDelete.kind === 'unreadable'
                                ? runtime.retention.claude.autoDelete.reason
                                : '自動削除の設定はありません'}
                          </dd>
                        </div>
                        <div>
                          <dt>残っている最も古い履歴</dt>
                          <dd>
                            {runtime.retention.claude.oldestModifiedOn ?? '履歴が見つかりません'}
                          </dd>
                        </div>
                        <div>
                          <dt>次に失われる日</dt>
                          <dd>
                            {runtime.retention.claude.alreadyLosing
                              ? `${runtime.retention.claude.nextLossOn}を過ぎています。Claude Codeの削除は起動時に行われるため、しばらく起動していなければまだ残っていることもあります`
                              : runtime.retention.claude.nextLossOn
                                ? `${runtime.retention.claude.nextLossOn}ごろ（あと${runtime.retention.claude.daysUntilNextLoss}日の見込み）`
                                : '判定できません'}
                          </dd>
                        </div>
                        <div>
                          <dt>Codex</dt>
                          <dd>
                            自動削除の設定は見つかりません。最も古い履歴は
                            {runtime.retention.codex.oldestModifiedOn ?? '見つかりません'}
                          </dd>
                        </div>
                      </dl>
                      <p className="retention-guidance">
                        何日にするかは、ご自身で決めてください。判断の材料は次のとおりです。
                      </p>
                      <ul className="retention-guidance-list">
                        <li>
                          帳簿書類の法定保存期間は原則7年（欠損金の繰越がある年は10年）です。ただし
                          これは帳簿書類についての定めで、AIの利用履歴そのものに保存義務があるわけ
                          ではありません
                        </li>
                        <li>
                          取り込んだあとも元の履歴には価値があります。DevTaxのデータベースはこのPCの利用者が書き換えられるため、自動生成された
                          元履歴のほうが記録としての性質が強いです
                        </li>
                        <li>
                          長く残すほどディスクを使います。利用状況によっては2桁GBに達することがあります
                        </li>
                      </ul>
                      <p className="retention-caveat">変更する前に、次の点をご確認ください。</p>
                      <ul className="retention-guidance-list">
                        <li>
                          「次に失われる日」は、残っている最も古い履歴の更新日時と保持日数から
                          見積もった目安です。Claude Codeが実際に削除する基準は公開されていません
                        </li>
                        <li>
                          保存する際はファイルの内容を書き直すため、もとの行の並びやインデントは
                          保たれません。変更するのは cleanupPeriodDays
                          という項目だけで、ほかの設定は変更しません
                        </li>
                        <li>
                          Claude Code自身もこのファイルを書き換えます。読み取りから保存までの間に
                          別の変更が加わっていた場合、その変更は上書きされることがあります
                        </li>
                        <li>
                          変更前の内容は同じフォルダへバックアップとして残ります。バックアップは
                          自動では削除されないため、変更するたびに増えていきます
                        </li>
                      </ul>
                      <div className="retention-apply">
                        <label>
                          <span>保持する日数</span>
                          <input
                            aria-label="Claude Codeの履歴を保持する日数"
                            type="number"
                            min="1"
                            max="36500"
                            value={retentionDays ?? ''}
                            onChange={(event) =>
                              setRetentionDays(
                                Number.isNaN(event.target.valueAsNumber)
                                  ? undefined
                                  : event.target.valueAsNumber,
                              )
                            }
                          />
                          <span>日</span>
                        </label>
                        <button
                          className="secondary-button"
                          disabled={retentionBusy || retentionDays === undefined}
                          onClick={applyRetention}
                        >
                          {retentionBusy ? '変更中…' : 'この日数へ変更する'}
                        </button>
                      </div>
                    </div>
                  </details>
                )}
                {busy && (
                  <p className="scan-progress" role="status" aria-live="polite">
                    {scanProgress?.running
                      ? `${scanProgress.sourceName ?? (scanProgress.provider === 'codex' ? 'Codex' : 'Claude Code')}の履歴を走査しています。走査したファイル数：${scanProgress.filesScanned}`
                      : '履歴を確認しています。'}
                  </p>
                )}
                {!busy && lastScanResult && scanNotes.length > 0 && (
                  <p className="scan-note" role="status">
                    {scanNotes.map((note) => (
                      <span key={note}>{note}</span>
                    ))}
                  </p>
                )}
                <div className="privacy-callout">
                  <span>⌂</span>
                  <p>
                    <strong>集計結果はこのPCの中だけ</strong>
                    <br />
                    共有元の履歴はLAN経由で読み取りますが、外部サービスへの送信・クラウド同期・テレメトリはありません。
                  </p>
                </div>
                <div className="setup-insight">
                  <span>✓</span>
                  <p>
                    <strong>ここまで分かりました</strong>
                    <br />
                    {selectedProviders.length}
                    種類のAI履歴を確認します。本文やソースコードは抽出・保存しません。
                  </p>
                </div>
              </>
            )}
            {step === 1 && (
              <>
                <span className="step-label">2 / 5　履歴から候補を整理</span>
                <h3>履歴にある全候補を、同じ制作物ごとにまとめます</h3>
                <p>
                  同じ制作物には同じ番号を付けてください。番号が同じ候補は、次の画面で1つの制作物として扱います。
                </p>
                <div className="history-context-bridge candidate-context">
                  <div>
                    <span>読み取った履歴</span>
                    <strong>{rankedProducts.length}候補</strong>
                    <small>
                      {data.meta.sessionCount.toLocaleString('ja-JP')}件・{historyRangeText}
                    </small>
                  </div>
                  <b>→</b>
                  <div>
                    <span>番号でまとめた結果</span>
                    <strong>{candidateSummary.products}制作物</strong>
                    <small>
                      私用 {candidateSummary.privateItems}件・あとで確認{' '}
                      {candidateSummary.laterItems}件
                    </small>
                  </div>
                </div>
                <label className="candidate-search">
                  <span>候補を検索</span>
                  <input
                    type="search"
                    value={candidateQuery}
                    onChange={(event) => {
                      setCandidateQuery(event.target.value)
                      setBulkGroup('')
                    }}
                    placeholder="フォルダ名・候補名"
                  />
                </label>
                {candidateQuery.trim() && visibleCandidateProducts.length > 1 && (
                  <div
                    className="candidate-bulk"
                    role="group"
                    aria-label="表示中の候補をまとめて設定"
                  >
                    <span>表示中の{visibleCandidateProducts.length}候補をまとめて</span>
                    <label className="candidate-group-number">
                      <span>番号（空欄は自動）</span>
                      <input
                        aria-label="まとめる制作物の番号"
                        type="number"
                        inputMode="numeric"
                        min="1"
                        value={bulkGroup}
                        placeholder={nextCandidateGroup}
                        onChange={(event) => setBulkGroup(event.target.value)}
                      />
                    </label>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => applyToVisibleCandidates('product')}
                    >
                      同じ制作物にする
                    </button>
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => applyToVisibleCandidates('private')}
                    >
                      趣味・私用
                    </button>
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => applyToVisibleCandidates('learning')}
                    >
                      一般的な学習
                    </button>
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => applyToVisibleCandidates('later')}
                    >
                      あとで確認
                    </button>
                  </div>
                )}
                {rankedProducts.length === 0 ? (
                  <div className="setup-insight">
                    <span>ⓘ</span>
                    <p>
                      <strong>履歴候補はまだありません</strong>
                      <br />
                      次へ進み、制作物を手動で追加できます。
                    </p>
                  </div>
                ) : (
                  <div className="history-grouping-list" role="list">
                    {visibleCandidateProducts.map(({ product }) => {
                      if (!product.projectKey) return null
                      const destination = candidateDestinations[product.projectKey] ?? {
                        kind: 'later' as const,
                      }
                      return (
                        <article
                          key={product.projectKey}
                          className="history-grouping-row"
                          role="listitem"
                        >
                          <div className="history-grouping-candidate">
                            <strong>{product.name}</strong>
                            <small>
                              {product.sessions}セッション・
                              {product.providers?.join('・') || '利用AI確認中'}
                              <br />
                              {product.firstObservedAt?.slice(0, 10) ||
                                product.firstObservedMonth ||
                                '開始不明'}
                              ～
                              {product.lastObservedAt?.slice(0, 10) ||
                                product.lastObservedMonth ||
                                '終了不明'}
                            </small>
                          </div>
                          <label>
                            <span>扱い</span>
                            <select
                              aria-label={`${product.name}の扱い`}
                              value={destination.kind}
                              onChange={(event) => {
                                const kind = event.target.value as CandidateDestination['kind']
                                updateCandidateDestination(
                                  product.projectKey!,
                                  kind === 'product'
                                    ? {
                                        kind,
                                        group:
                                          destination.kind === 'product'
                                            ? destination.group
                                            : nextCandidateGroup,
                                        ...(destination.kind === 'product' &&
                                        destination.existingTaxUnitId
                                          ? { existingTaxUnitId: destination.existingTaxUnitId }
                                          : {}),
                                      }
                                    : {
                                        kind,
                                        ...(destination.existingTaxUnitId
                                          ? { existingTaxUnitId: destination.existingTaxUnitId }
                                          : {}),
                                      },
                                )
                              }}
                            >
                              <option value="product">制作物</option>
                              <option value="private">趣味・私用</option>
                              <option value="learning">一般的な学習</option>
                              <option value="later">あとで確認</option>
                            </select>
                          </label>
                          <label className="candidate-group-number">
                            <span>同じ制作物の番号</span>
                            <input
                              aria-label={`${product.name}のグループ番号`}
                              type="number"
                              inputMode="numeric"
                              min="1"
                              disabled={destination.kind !== 'product'}
                              value={destination.kind === 'product' ? destination.group : ''}
                              onChange={(event) =>
                                updateCandidateDestination(product.projectKey!, {
                                  kind: 'product',
                                  group: event.target.value,
                                  ...(destination.kind === 'product' &&
                                  destination.existingTaxUnitId
                                    ? { existingTaxUnitId: destination.existingTaxUnitId }
                                    : {}),
                                })
                              }
                            />
                          </label>
                        </article>
                      )
                    })}
                  </div>
                )}
                <div className="candidate-grouping-legend">
                  <strong>まとめ方の例</strong>
                  <span>1・1・1＝3候補を1つの制作物へ</span>
                  <span>1・2・3＝それぞれ別の制作物へ</span>
                  <span>私用＝制作物の原価へ含めない</span>
                </div>
              </>
            )}
            {step === 2 && (
              <>
                <span className="step-label">3 / 5　制作物ごとの状況</span>
                <h3>制作物ごとに、売上や利用状況を確認します</h3>
                <p>
                  先ほど同じ番号にした候補は1件にまとまっています。公開日だけでなく、実際に使い始めた時点も記録できます。
                </p>
                <div className="simple-form-grid product-year-field">
                  <label>
                    <span>
                      <strong>結果を確認する年</strong>
                      <small>今回まとめたい費用の年</small>
                    </span>
                    <input
                      type="number"
                      min="2020"
                      max="2100"
                      value={planningDraft.profile.taxYear}
                      onChange={(event) =>
                        setPlanningDraft((current) => ({
                          ...current,
                          profile: {
                            ...current.profile,
                            taxYear: event.target.valueAsNumber || new Date().getFullYear(),
                          },
                        }))
                      }
                    />
                  </label>
                </div>
                <div className="multi-product-guide">
                  <strong>同じフォルダでも途中から扱いが変わるとき</strong>
                  <p>
                    ここでは制作物そのものを確認します。利用開始後の保守や大きな機能追加は、保存後に「フォルダの割当」で期間を分けられます。
                  </p>
                  <details>
                    <summary>制作物と期間の違い</summary>
                    <ul>
                      <li>
                        <b>別の制作物：</b>家計アプリと小説執筆ツールなど、目的や完成条件が違うもの
                      </li>
                      <li>
                        <b>同じ制作物の別期間：</b>完成前の製作、利用開始後の保守、大きな機能追加
                      </li>
                      <li>
                        <b>迷うとき：</b>制作物は同じままにし、あとから期間を分けて確認する
                      </li>
                    </ul>
                  </details>
                </div>
                <div className="tax-unit-editor-list">
                  {planningDraft.taxUnits.map((unit, index) => (
                    <article
                      className="tax-unit-editor"
                      key={unit.id}
                      data-consultation-unit={unit.id}
                    >
                      <div className="tax-unit-card-heading">
                        <span>{index + 1}</span>
                        <strong>{unit.name || `開発 ${index + 1}`}</strong>
                      </div>
                      <label>
                        <span>
                          <strong>作っているものの名前</strong>
                          <small>例：自分用の執筆ツール、公開予定の家計アプリ</small>
                        </span>
                        <input
                          value={unit.name}
                          onChange={(event) => updateTaxUnit(index, { name: event.target.value })}
                        />
                      </label>
                      <label>
                        <span>
                          <strong>この開発の整理のしかた</strong>
                          <small>制作物ごとに早期準備と過去整理を分けられます</small>
                        </span>
                        <select
                          value={unit.journeyMode ?? planningDraft.profile.journeyMode}
                          onChange={(event) =>
                            updateTaxUnit(index, {
                              journeyMode: event.target.value as NonNullable<
                                TaxUnitRecord['journeyMode']
                              >,
                            })
                          }
                        >
                          <option value="early">これからの記録を準備する</option>
                          <option value="retrospective">過去の履歴を整理する</option>
                        </select>
                      </label>
                      <label>
                        <span>
                          <strong>この制作物の売上状況</strong>
                          <small>販売、広告、アフィリエイトなどを含みます</small>
                        </span>
                        <select
                          value={
                            unit.monetizationStatus ?? planningDraft.profile.monetizationStatus
                          }
                          onChange={(event) =>
                            updateTaxUnit(index, {
                              monetizationStatus: event.target.value as NonNullable<
                                TaxUnitRecord['monetizationStatus']
                              >,
                            })
                          }
                        >
                          <option value="none">まだ収益化を決めていない</option>
                          <option value="planned">これから収益化する予定</option>
                          <option value="earning">すでに売上がある</option>
                        </select>
                      </label>
                      <label>
                        <span>
                          <strong>誰が使いますか？</strong>
                          <small>自分利用と外部公開の両方にも対応します</small>
                        </span>
                        <select
                          value={unit.usageMode}
                          onChange={(event) =>
                            updateTaxUnit(index, {
                              usageMode: event.target.value as TaxUnitRecord['usageMode'],
                            })
                          }
                        >
                          <option value="internal">自分の実作業で使う</option>
                          <option value="external">外部へ公開・提供する</option>
                          <option value="mixed">自分でも使い、外部にも提供する</option>
                          <option value="undecided">まだ決めていない</option>
                        </select>
                      </label>
                      <label>
                        <span>
                          <strong>いまの状態</strong>
                          <small>「正式利用」はテストではなく実際の作業に使っている状態です</small>
                        </span>
                        <select
                          value={unit.lifecycleStatus}
                          onChange={(event) =>
                            updateTaxUnit(index, {
                              lifecycleStatus: event.target
                                .value as TaxUnitRecord['lifecycleStatus'],
                            })
                          }
                        >
                          <option value="idea">構想中</option>
                          <option value="prototype">試作中</option>
                          <option value="developing">開発中</option>
                          <option value="evaluating">評価中</option>
                          <option value="in-use">実際の作業で利用中</option>
                          <option value="maintaining">保守中</option>
                          <option value="improving">改良中</option>
                          <option value="retired">利用終了</option>
                          <option value="abandoned">開発中止</option>
                        </select>
                      </label>
                      <label>
                        <span>
                          <strong>この開発を始めた日</strong>
                          <small>履歴上の最初の日と異なる場合は、実態の日を入力します</small>
                        </span>
                        <DateInput
                          value={lifecycleDate(unit.id, 'development-started')}
                          onValueChange={(value) =>
                            updateLifecycleDate(unit.id, 'development-started', value)
                          }
                        />
                      </label>
                      <label className="wide-field">
                        <span>
                          <strong>完成したと言える条件</strong>
                          <small>例：一連の作業を最初から最後まで処理できる</small>
                        </span>
                        <textarea
                          value={unit.completionCriteria ?? ''}
                          onChange={(event) =>
                            updateTaxUnit(index, { completionCriteria: event.target.value })
                          }
                        />
                      </label>
                      {(unit.monetizationStatus ?? planningDraft.profile.monetizationStatus) ===
                        'earning' && (
                        <label>
                          <span>
                            <strong>初めて売上が発生した日</strong>
                            <small>入金日ではなく、売上の事実が発生した日を確認します</small>
                          </span>
                          <DateInput
                            value={lifecycleDate(unit.id, 'first-sale')}
                            onValueChange={(value) =>
                              updateLifecycleDate(unit.id, 'first-sale', value)
                            }
                          />
                        </label>
                      )}
                      {(unit.usageMode === 'internal' || unit.usageMode === 'mixed') && (
                        <label>
                          <span>
                            <strong>自分の本番作業で使い始めた日</strong>
                            <small>テストではなく、実際の仕事や制作に初めて使った日</small>
                          </span>
                          <DateInput
                            value={lifecycleDate(unit.id, 'internal-use-started')}
                            onValueChange={(value) =>
                              updateLifecycleDate(unit.id, 'internal-use-started', value)
                            }
                          />
                        </label>
                      )}
                      {(unit.usageMode === 'external' || unit.usageMode === 'mixed') && (
                        <label>
                          <span>
                            <strong>外部へ公開・提供した日</strong>
                            <small>販売ページ、公開URL、顧客提供などを開始した日</small>
                          </span>
                          <DateInput
                            value={lifecycleDate(unit.id, 'external-released')}
                            onValueChange={(value) =>
                              updateLifecycleDate(unit.id, 'external-released', value)
                            }
                          />
                        </label>
                      )}
                    </article>
                  ))}
                </div>
                <button
                  className="secondary-button add-record"
                  onClick={() =>
                    setPlanningDraft((current) => ({
                      ...current,
                      taxUnits: [
                        ...current.taxUnits,
                        {
                          id: `tax-unit-${Date.now()}`,
                          name: '',
                          unitType: 'new-software',
                          usageMode: 'undecided',
                          revenueModel: 'undecided',
                          lifecycleStatus: 'developing',
                          journeyMode: 'early',
                          monetizationStatus: 'none',
                          sameAsExternalVersion: 'undecided',
                        },
                      ],
                    }))
                  }
                >
                  ＋ 別の開発をもう1件追加
                </button>
                <div className="setup-insight">
                  <span>✓</span>
                  <p>
                    <strong>ここまで分かりました</strong>
                    <br />
                    作っているものは{planningDraft.taxUnits.length}件です。自分利用
                    {
                      planningDraft.taxUnits.filter(
                        (unit) => unit.usageMode === 'internal' || unit.usageMode === 'mixed',
                      ).length
                    }
                    件、外部提供
                    {
                      planningDraft.taxUnits.filter(
                        (unit) => unit.usageMode === 'external' || unit.usageMode === 'mixed',
                      ).length
                    }
                    件として整理します。
                  </p>
                </div>
              </>
            )}
            {step === 3 && (
              <>
                <span className="step-label">4 / 5　支払った費用</span>
                <h3>AI料金と開発に使う費用を登録します</h3>
                <CostPresenceEditor
                  planning={planningDraft}
                  onChange={(costPresence) =>
                    setPlanningDraft((current) => ({ ...current, costPresence }))
                  }
                />
                <p>金額が分からない項目は後から追加できます。私用分を除くための割合も残します。</p>
                <section className="development-scale-guide" aria-label="開発費の規模感と処理候補">
                  <div className="scale-guide-heading">
                    <span>金額の見取り図</span>
                    <strong>10万円未満でも、完成・利用前なら今年の費用とは限りません</strong>
                    <p>
                      AI料金などを1つのソフトウェアに直接対応する原価として集める場合の、簡略化した候補です。
                    </p>
                  </div>
                  <div className="scale-example-list">
                    <div>
                      <b>8万円</b>
                      <span>まだ開発中</span>
                      <strong className="future-tone">将来へ残る原価候補</strong>
                      <small>完成・利用開始を確認するまで</small>
                    </div>
                    <div>
                      <b>8万円</b>
                      <span>完成して利用開始</span>
                      <strong className="current-tone">今年の費用候補</strong>
                      <small>10万円未満の少額資産候補</small>
                    </div>
                    <div>
                      <b>10万円ちょうど</b>
                      <span>完成して利用開始</span>
                      <strong className="review-tone">3年均等または通常償却候補</strong>
                      <small>「10万円未満」には含まれません</small>
                    </div>
                    <div>
                      <b>15万円</b>
                      <span>完成して利用開始</span>
                      <strong className="review-tone">3年で1/3ずつ、または通常償却候補</strong>
                      <small>10万円以上20万円未満</small>
                    </div>
                    <div>
                      <b>25万円</b>
                      <span>完成して利用開始</span>
                      <strong className="future-tone">通常の減価償却候補</strong>
                      <small>青色申告者向け特例は別に確認</small>
                    </div>
                  </div>
                  <p className="scale-warning">
                    <b>注意：</b>
                    判定は請求書1枚や月額ごとではなく、通常は機能する1つの資産単位の取得価額で行います。税務目的で不自然に分割しません。
                  </p>
                </section>
                <section className="charge-period-editor">
                  <div className="cost-editor-heading">
                    <div>
                      <h4>請求・契約履歴</h4>
                      <p>
                        月額の推定ではなく、明細にある利用期間と実際の請求額を記録します。月途中のプラン変更は行を分けてください。
                      </p>
                    </div>
                    <button type="button" className="secondary-button" onClick={addChargePeriod}>
                      ＋ 請求を追加
                    </button>
                  </div>
                  <DuplicateChargesPanel
                    periods={chargePeriods}
                    onChange={(updated) =>
                      setChargePeriods((current) =>
                        current.map((period) => (period.id === updated.id ? updated : period)),
                      )
                    }
                  />
                  {chargePeriods.length === 0 ? (
                    <p className="charge-period-empty">
                      請求履歴が未登録です。正確な期間が分かる場合は追加してください。分からない場合だけ、下の月額概算を利用できます。
                    </p>
                  ) : (
                    <div className="charge-period-list">
                      {chargePeriods.map((period, index) => (
                        <article key={period.id} className="charge-period-row">
                          <label>
                            <span>AIサービス</span>
                            <select
                              value={period.provider}
                              onChange={(event) =>
                                updateChargePeriod(index, {
                                  provider: event.target.value as ProviderKey,
                                })
                              }
                            >
                              <option value="claude">Claude Code</option>
                              <option value="codex">Codex</option>
                            </select>
                          </label>
                          <label>
                            <span>プラン名</span>
                            <input
                              placeholder="例：Pro"
                              value={period.planName}
                              onChange={(event) =>
                                updateChargePeriod(index, { planName: event.target.value })
                              }
                            />
                          </label>
                          <label>
                            <span>利用開始日</span>
                            <DateInput
                              value={period.serviceStartedOn}
                              onValueChange={(value) =>
                                updateChargePeriod(index, {
                                  serviceStartedOn: value,
                                })
                              }
                            />
                          </label>
                          <label>
                            <span>利用終了日</span>
                            <DateInput
                              value={period.serviceEndedOn}
                              onValueChange={(value) =>
                                updateChargePeriod(index, {
                                  serviceEndedOn: value,
                                })
                              }
                            />
                          </label>
                          <label>
                            <span>請求日</span>
                            <DateInput
                              value={period.billedOn ?? ''}
                              onValueChange={(value) =>
                                updateChargePeriod(index, {
                                  billedOn: value || undefined,
                                })
                              }
                            />
                          </label>
                          <label>
                            <span>実際の請求額</span>
                            <input
                              type="number"
                              min="0"
                              value={period.amountJpy ?? ''}
                              placeholder="不明"
                              onChange={(event) =>
                                updateChargePeriod(index, {
                                  amountJpy:
                                    event.target.value === '' ? null : event.target.valueAsNumber,
                                  unknownAmountReason:
                                    event.target.value === ''
                                      ? (period.unknownAmountReason ??
                                        '請求額をまだ確認していません。')
                                      : undefined,
                                })
                              }
                            />
                          </label>
                          {period.amountJpy === null && (
                            <label>
                              <span>請求額が不明な理由</span>
                              <input
                                aria-label="AI請求額が不明な理由"
                                value={period.unknownAmountReason ?? ''}
                                onChange={(event) =>
                                  updateChargePeriod(index, {
                                    unknownAmountReason: event.target.value,
                                  })
                                }
                              />
                            </label>
                          )}
                          <button
                            type="button"
                            className="text-button"
                            onClick={() =>
                              updateChargePeriod(index, {
                                amountJpy: null,
                                unknownAmountReason:
                                  period.unknownAmountReason ?? '請求額をまだ確認していません。',
                              })
                            }
                          >
                            請求額を不明に戻す
                          </button>
                          <fieldset>
                            <legend>この請求の根拠</legend>
                            <p>
                              金額・利用期間を確認した資料を選んでください。資料自体は下の「根拠メモ」に記録できます。
                            </p>
                            {[
                              ...new Set([
                                ...planningDraft.evidence.map((row) => row.id),
                                ...(period.evidenceIds ?? []),
                              ]),
                            ].map((id) => {
                              const evidence = planningDraft.evidence.find((row) => row.id === id)
                              return (
                                <label key={id}>
                                  <input
                                    type="checkbox"
                                    checked={period.evidenceIds?.includes(id) ?? false}
                                    onChange={(event) =>
                                      updateChargePeriod(index, {
                                        evidenceIds: event.target.checked
                                          ? [...(period.evidenceIds ?? []), id]
                                          : (period.evidenceIds ?? []).filter(
                                              (value) => value !== id,
                                            ),
                                      })
                                    }
                                  />
                                  {evidence
                                    ? `${evidence.occurredOn ?? '対象日未記録'} ${evidence.note || '説明未入力'}`
                                    : `参照先の記録がありません：${id}`}
                                </label>
                              )
                            })}
                            {!planningDraft.evidence.length && !period.evidenceIds?.length && (
                              <p>根拠は未登録です。金額の入力だけで確認済みとは扱いません。</p>
                            )}
                          </fieldset>
                          <button
                            type="button"
                            className="text-button"
                            onClick={() =>
                              setChargePeriods((current) =>
                                current.filter((_, periodIndex) => periodIndex !== index),
                              )
                            }
                          >
                            削除
                          </button>
                        </article>
                      ))}
                    </div>
                  )}
                </section>
                <details className="advanced-fields legacy-charge-fields">
                  <summary>請求期間が分からない場合の月額概算</summary>{' '}
                  <p>
                    サービスごと・月ごとに、利用期間付きの請求、月別料金、既定月額の順に使います。
                    期間付き請求がある月は月額概算を加算しません。別の月の料金記録は引き続き使います。
                    月の一部だけを覆う請求も、その月は期間付き請求で計算します。対象日外の利用は契約期間外として表示します。
                  </p>
                  <p>
                    0円は金額を確認した場合に入力してください。空欄は金額不明として保存し、配分額を計算しません。
                  </p>
                  <div className="invoice-box">
                    <div>
                      <span className="provider-logo">C</span>
                      <strong>Claude Code 月額</strong>
                      <input
                        aria-label="Claude Code 月額"
                        type="number"
                        min="0"
                        placeholder="未入力"
                        value={claudeCharge ?? ''}
                        onChange={(event) =>
                          updateProviderCharge(
                            'claude',
                            Number.isNaN(event.target.valueAsNumber)
                              ? undefined
                              : event.target.valueAsNumber,
                          )
                        }
                      />
                      <span>円</span>
                    </div>
                    <div>
                      <span className="provider-logo codex">O</span>
                      <strong>Codex 月額</strong>
                      <input
                        aria-label="Codex 月額"
                        type="number"
                        min="0"
                        placeholder="未入力"
                        value={codexCharge ?? ''}
                        onChange={(event) =>
                          updateProviderCharge(
                            'codex',
                            Number.isNaN(event.target.valueAsNumber)
                              ? undefined
                              : event.target.valueAsNumber,
                          )
                        }
                      />
                      <span>円</span>
                    </div>
                  </div>
                  {(
                    [
                      ['claude', 'Claude Code'],
                      ['codex', 'Codex'],
                    ] as const
                  ).map(([provider, label]) => {
                    const amount = provider === 'claude' ? claudeCharge : codexCharge
                    return (
                      <div key={provider} className="field">
                        <button
                          type="button"
                          className="text-button"
                          onClick={() => updateProviderCharge(provider, null)}
                        >
                          {label}の既定月額を不明にする
                        </button>
                        {amount === null && (
                          <label>
                            {label}の既定月額は不明です。理由を記録してください。
                            <textarea
                              aria-label={`${label}の既定月額が不明な理由`}
                              value={unknownChargeReasons[provider] ?? ''}
                              onChange={(event) =>
                                setUnknownChargeReasons((current) => ({
                                  ...current,
                                  [provider]: event.target.value,
                                }))
                              }
                            />
                            <small>
                              0円として計算しません。金額が分かったら上の月額欄に入力してください。
                            </small>
                          </label>
                        )}
                      </div>
                    )
                  })}
                  <div className="contract-fields">
                    <div className="contract-heading">
                      <strong>契約期間</strong>
                      <small>
                        入力すると、契約していない月を配賦から外せます。未入力のままでも構いません。その場合は履歴のある全月へ同額を適用します。日割りは行いません。
                      </small>
                    </div>
                    {(
                      [
                        ['claude', 'Claude Code'],
                        ['codex', 'Codex'],
                      ] as const
                    ).map(([provider, label]) => (
                      <div className="contract-row" key={provider}>
                        <strong>{label}</strong>
                        <label>
                          <span>開始日</span>
                          <DateInput
                            aria-label={`${label} 契約開始日`}

                            value={contracts[provider].startedOn ?? ''}
                            onValueChange={(value) =>
                              setContracts((current) => ({
                                ...current,
                                [provider]: {
                                  ...current[provider],
                                  startedOn: value || undefined,
                                },
                              }))
                            }
                          />
                        </label>
                        <label>
                          <span>終了日</span>
                          <DateInput
                            aria-label={`${label} 契約終了日`}

                            value={contracts[provider].endedOn ?? ''}
                            onValueChange={(value) =>
                              setContracts((current) => ({
                                ...current,
                                [provider]: {
                                  ...current[provider],
                                  endedOn: value || undefined,
                                },
                              }))
                            }
                          />
                        </label>
                        <small>解約していない場合、終了日は空のままにしてください。</small>
                      </div>
                    ))}
                  </div>
                  <MonthlyChargesEditor
                    charges={monthlyCharges}
                    observedMonths={data.months.map((month) =>
                      monthKeyFromLabel(month.label, planningDraft.profile.taxYear),
                    )}
                    onChange={setMonthlyCharges}
                  />
                </details>
                <label className="ratio-field">
                  <span>
                    <strong>未取得利用の割合</strong>
                    <small>
                      取得した履歴に含まれないWebチャットや別PCの利用。空欄は不明、0%は捕捉外の利用がないと確認した場合です。不明の間は支払額を保持し、制作物への配分額は未算定とします。
                    </small>
                  </span>
                  <input
                    aria-label="未取得利用割合"
                    type="number"
                    min="0"
                    max="95"
                    step="any"
                    placeholder="不明"
                    value={unobservedPercent ?? ''}
                    onChange={(event) =>
                      setUnobservedPercent(
                        Number.isFinite(event.target.valueAsNumber)
                          ? event.target.valueAsNumber
                          : null,
                      )
                    }
                  />
                  <span>%</span>
                </label>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setUnobservedPercent(null)}
                >
                  割合を不明に戻す
                </button>
                <div className="cost-editor-section">
                  <div className="cost-editor-heading">
                    <div>
                      <h4>パソコン・GPU機器など</h4>
                      <p>
                        10万円の境界だけで決めず、使い始めた日・耐用年数・私用転用も記録します。
                      </p>
                    </div>
                    <button
                      className="secondary-button"
                      onClick={() =>
                        setPlanningDraft((current) => ({
                          ...current,
                          equipment: [
                            ...current.equipment,
                            {
                              id: `equipment-${Date.now()}`,
                              name: '開発用PC',
                              equipmentType: 'pc',
                              acquisitionCostJpy: null,
                              unknownAmountReason: '購入額をまだ確認していません。',
                              acquiredOn: `${current.profile.taxYear}-01-01`,
                              convertedFromPrivate: false,
                              businessUseRatio: 1,
                              role: 'アプリ開発',
                              // A shared machine must not silently land on the first product.
                              taxUnitId: undefined,
                              projectAllocationRatio: 1,
                              evidenceIds: [],
                            },
                          ],
                        }))
                      }
                    >
                      ＋ 追加
                    </button>
                  </div>
                  {planningDraft.equipment.map((item, index) => (
                    <div className="cost-edit-row" key={item.id}>
                      <p style={{ gridColumn: '1 / -1' }}>
                        {item.name}：ここでは設備の共通情報を編集します。
                        {planningDraft.equipmentMethods?.some(
                          (method) =>
                            method.equipmentId === item.id &&
                            method.taxYear === planningDraft.profile.taxYear &&
                            method.allocation,
                        )
                          ? `${planningDraft.profile.taxYear}年の割合は、下の「設備計算条件」に記録した年度別設定を使います。対応先も年度別に指定した場合は、その設定を使います。`
                          : '年度別の配分条件が未登録の年は、この共通割合・対応先を使います。下の「設備計算条件」で年度別に記録できます。'}
                      </p>
                      <label>
                        <span>機器名</span>
                        <input
                          value={item.name}
                          onChange={(event) => updateEquipment(index, { name: event.target.value })}
                        />
                      </label>
                      <label>
                        <span>種類</span>
                        <select
                          value={item.equipmentType}
                          onChange={(event) =>
                            updateEquipment(index, {
                              equipmentType: event.target.value as EquipmentRecord['equipmentType'],
                            })
                          }
                        >
                          <option value="pc">パソコン</option>
                          <option value="gpu">GPU機器</option>
                          <option value="dgx">AI開発用ワークステーション</option>
                          <option value="server">サーバー</option>
                          <option value="desk">机</option>
                          <option value="peripheral">周辺機器</option>
                          <option value="other">その他</option>
                        </select>
                      </label>
                      <label>
                        <span>購入額</span>
                        <input
                          type="number"
                          min="0"
                          value={item.acquisitionCostJpy ?? ''}
                          placeholder="不明"
                          aria-label="設備の購入額"
                          onChange={(event) =>
                            updateEquipment(index, {
                              acquisitionCostJpy:
                                event.target.value === '' ? null : event.target.valueAsNumber,
                              unknownAmountReason:
                                event.target.value === ''
                                  ? (item.unknownAmountReason ?? '購入額をまだ確認していません。')
                                  : undefined,
                            })
                          }
                        />
                      </label>
                      {item.acquisitionCostJpy === null && (
                        <label>
                          <span>購入額が不明な理由</span>
                          <input
                            aria-label="設備の購入額が不明な理由"
                            value={item.unknownAmountReason ?? ''}
                            onChange={(event) =>
                              updateEquipment(index, { unknownAmountReason: event.target.value })
                            }
                          />
                        </label>
                      )}
                      <button
                        type="button"
                        className="text-button"
                        onClick={() =>
                          updateEquipment(index, {
                            acquisitionCostJpy: null,
                            unknownAmountReason:
                              item.unknownAmountReason ?? '購入額をまだ確認していません。',
                          })
                        }
                      >
                        購入額を不明に戻す
                      </button>
                      <label>
                        <span>購入日</span>
                        <DateInput
                          value={item.acquiredOn}
                          onValueChange={(value) => updateEquipment(index, { acquiredOn: value })}
                        />
                      </label>
                      <label>
                        <span>業務で使い始めた日</span>
                        <DateInput
                          value={item.businessUseStartedOn ?? ''}
                          onValueChange={(value) =>
                            updateEquipment(index, {
                              businessUseStartedOn: value || undefined,
                            })
                          }
                        />
                      </label>
                      <label>
                        <span>耐用年数（不明なら空欄）</span>
                        <input
                          type="number"
                          min="1"
                          max="100"
                          value={item.usefulLifeYears ?? ''}
                          onChange={(event) =>
                            updateEquipment(index, {
                              usefulLifeYears: Number.isFinite(event.target.valueAsNumber)
                                ? event.target.valueAsNumber
                                : undefined,
                            })
                          }
                        />
                      </label>
                      <label>
                        <span>業務で使う割合</span>
                        <input
                          type="number"
                          min="0"
                          max="100"
                          value={Math.round(item.businessUseRatio * 100)}
                          onChange={(event) =>
                            updateEquipment(index, {
                              businessUseRatio:
                                Math.min(100, Math.max(0, event.target.valueAsNumber || 0)) / 100,
                            })
                          }
                        />
                      </label>
                      <label>
                        <span>どの制作物に使う？</span>
                        <select
                          value={item.taxUnitId ?? ''}
                          onChange={(event) =>
                            updateEquipment(index, { taxUnitId: event.target.value || undefined })
                          }
                        >
                          <option value="">まだ分けない</option>
                          {planningDraft.taxUnits.map((unit) => (
                            <option key={unit.id} value={unit.id}>
                              {unit.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <span>その制作物に使う割合</span>
                        <input
                          type="number"
                          min="0"
                          max="100"
                          value={Math.round(item.projectAllocationRatio * 100)}
                          onChange={(event) =>
                            updateEquipment(index, {
                              projectAllocationRatio:
                                Math.min(100, Math.max(0, event.target.valueAsNumber || 0)) / 100,
                            })
                          }
                        />
                      </label>
                      <label className="checkbox-field">
                        <input
                          type="checkbox"
                          checked={item.convertedFromPrivate}
                          onChange={(event) =>
                            updateEquipment(index, { convertedFromPrivate: event.target.checked })
                          }
                        />
                        <span>以前は私用だった機器を転用した</span>
                      </label>
                      {item.convertedFromPrivate && (
                        <label>
                          <span>転用時の未償却残高</span>
                          <input
                            type="number"
                            min="0"
                            value={item.openingUnamortizedBalanceJpy ?? ''}
                            onChange={(event) =>
                              updateEquipment(index, {
                                openingUnamortizedBalanceJpy: Number.isFinite(
                                  event.target.valueAsNumber,
                                )
                                  ? event.target.valueAsNumber
                                  : undefined,
                              })
                            }
                          />
                        </label>
                      )}
                      <label className="wide-field">
                        <span>役割</span>
                        <input
                          placeholder="例：外出時の開発、ローカルAI検証"
                          value={item.role}
                          onChange={(event) => updateEquipment(index, { role: event.target.value })}
                        />
                      </label>
                    </div>
                  ))}
                </div>
                <div className="cost-editor-section">
                  <div className="cost-editor-heading">
                    <div>
                      <h4>家賃・電気・通信</h4>
                      <p>計算の方法と、その方法を選んだ理由を残します。</p>
                    </div>
                  </div>
                  <div className="cost-add-buttons">
                    {(['rent', 'electricity', 'internet'] as const).map((category) => (
                      <button
                        className="secondary-button"
                        key={category}
                        onClick={() =>
                          setPlanningDraft((current) => ({
                            ...current,
                            homeCosts: [
                              ...current.homeCosts,
                              {
                                id: `home-${category}-${Date.now()}`,
                                month: `${current.profile.taxYear}-01`,
                                category,
                                amountJpy: null,
                                unknownAmountReason: '支払額をまだ確認していません。',
                                method:
                                  category === 'rent'
                                    ? 'area-time'
                                    : category === 'electricity'
                                      ? 'watt-hour'
                                      : 'usage-time',
                                businessUseRatio: 0,
                                basis: '未入力',
                                rationale: 'あとで確認',
                                projectAllocationRatio: 0,
                                treatment: 'shared',
                                evidenceIds: [],
                              },
                            ],
                          }))
                        }
                      >
                        ＋ {categoryLabel(category)}
                      </button>
                    ))}
                  </div>
                  {planningDraft.homeCosts.map((item, index) => (
                    <div className="cost-edit-row home" key={item.id}>
                      <strong>{categoryLabel(item.category)}</strong>
                      <label>
                        <span>対象月</span>
                        <input
                          type="month"
                          value={item.month}
                          onChange={(event) => updateHomeCost(index, { month: event.target.value })}
                        />
                      </label>
                      <label>
                        <span>支払額</span>
                        <input
                          type="number"
                          min="0"
                          value={item.amountJpy ?? ''}
                          placeholder="不明"
                          aria-label="自宅費用の支払額"
                          onChange={(event) =>
                            updateHomeCost(index, {
                              amountJpy:
                                event.target.value === '' ? null : event.target.valueAsNumber,
                              unknownAmountReason:
                                event.target.value === ''
                                  ? (item.unknownAmountReason ?? '支払額をまだ確認していません。')
                                  : undefined,
                            })
                          }
                        />
                      </label>
                      {item.amountJpy === null && (
                        <label>
                          <span>支払額が不明な理由</span>
                          <input
                            aria-label="自宅費用の支払額が不明な理由"
                            value={item.unknownAmountReason ?? ''}
                            onChange={(event) =>
                              updateHomeCost(index, { unknownAmountReason: event.target.value })
                            }
                          />
                        </label>
                      )}
                      <button
                        type="button"
                        className="text-button"
                        onClick={() =>
                          updateHomeCost(index, {
                            amountJpy: null,
                            unknownAmountReason:
                              item.unknownAmountReason ?? '支払額をまだ確認していません。',
                          })
                        }
                      >
                        支払額を不明に戻す
                      </button>
                      <label>
                        <span>業務割合</span>
                        <input
                          type="number"
                          min="0"
                          max="100"
                          value={Math.round(item.businessUseRatio * 100)}
                          onChange={(event) =>
                            updateHomeCost(index, {
                              businessUseRatio:
                                Math.min(100, Math.max(0, event.target.valueAsNumber || 0)) / 100,
                            })
                          }
                        />
                      </label>
                      {item.treatment !== 'general' &&
                        (item.targets !== undefined ? (
                          <AllocationTargetsEditor
                            name={item.month + ' ' + item.category}
                            targets={item.targets}
                            units={planningDraft.taxUnits}
                            onChange={(targets) => updateHomeCost(index, { targets })}
                          />
                        ) : (
                          <>
                            <label>
                              <span>どの制作物に使う？</span>
                              <select
                                value={item.taxUnitId ?? ''}
                                onChange={(event) =>
                                  updateHomeCost(index, {
                                    taxUnitId: event.target.value || undefined,
                                  })
                                }
                              >
                                <option value="">全体・まだ分けない</option>
                                {planningDraft.taxUnits.map((unit) => (
                                  <option key={unit.id} value={unit.id}>
                                    {unit.name}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label>
                              <span>その制作物に使う割合</span>
                              <input
                                type="number"
                                min="0"
                                max="100"
                                value={Math.round(item.projectAllocationRatio * 100)}
                                onChange={(event) =>
                                  updateHomeCost(index, {
                                    projectAllocationRatio:
                                      Math.min(100, Math.max(0, event.target.valueAsNumber || 0)) /
                                      100,
                                  })
                                }
                              />
                            </label>

                            <button
                              type="button"
                              onClick={() =>
                                updateHomeCost(index, {
                                  targets: [],
                                  taxUnitId: undefined,
                                  projectAllocationRatio: 0,
                                })
                              }
                            >
                              制作物別に配分を入力し直す
                            </button>
                            <p>
                              切り替えると旧対応先と割合を解除し、業務分を未配分から入力し直します。支払額・業務割合・計算根拠は保持します。
                            </p>
                          </>
                        ))}
                      <label className="wide-field">
                        <span>計算の根拠</span>
                        <input
                          placeholder="例：作業面積20% × 使用時間60%"
                          value={item.basis}
                          onChange={(event) => updateHomeCost(index, { basis: event.target.value })}
                        />
                      </label>
                      <label className="wide-field">
                        <span>この方法にした理由</span>
                        <input
                          placeholder="例：専用部屋がないため面積と時間を併用"
                          value={item.rationale}
                          onChange={(event) =>
                            updateHomeCost(index, { rationale: event.target.value })
                          }
                        />
                      </label>
                    </div>
                  ))}
                </div>
                <div className="cost-editor-section">
                  <div className="cost-editor-heading">
                    <div>
                      <h4>そのほかの直接費</h4>
                      <p>ドメイン、クラウド、外注など、制作物へ直接結び付く支払いです。</p>
                    </div>
                    <button
                      className="secondary-button"
                      onClick={() =>
                        setPlanningDraft((current) => ({
                          ...current,
                          directCosts: [
                            ...current.directCosts,
                            {
                              id: `direct-${Date.now()}`,
                              taxUnitId: current.taxUnits[0]?.id,
                              incurredOn: `${current.profile.taxYear}-01-01`,
                              costType: 'cloud',
                              amountJpy: null,
                              unknownAmountReason: '金額をまだ確認していません。',
                              directlyAttributable: true,
                              treatment: 'direct',
                              note: '',
                              evidenceIds: [],
                            },
                          ],
                        }))
                      }
                    >
                      ＋ 追加
                    </button>
                  </div>
                  {planningDraft.directCosts.map((item, index) => (
                    <div className="cost-edit-row" key={item.id}>
                      <label>
                        <span>支払日</span>
                        <DateInput
                          value={item.incurredOn}
                          onValueChange={(value) => updateDirectCost(index, { incurredOn: value })}
                        />
                      </label>
                      <label>
                        <span>種類</span>
                        <select
                          value={item.costType}
                          onChange={(event) =>
                            updateDirectCost(index, {
                              costType: event.target.value as DirectCostRecord['costType'],
                            })
                          }
                        >
                          <option value="cloud">クラウド</option>
                          <option value="domain">ドメイン</option>
                          <option value="license">ライセンス</option>
                          <option value="outsource">外注</option>
                          <option value="material">材料</option>
                          <option value="old-version-balance">旧版の残価候補</option>
                          <option value="other">その他</option>
                        </select>
                      </label>
                      <label>
                        <span>金額</span>
                        <input
                          type="number"
                          min="0"
                          value={item.amountJpy ?? ''}
                          placeholder="不明"
                          aria-label="直接費の金額"
                          onChange={(event) =>
                            updateDirectCost(index, {
                              amountJpy:
                                event.target.value === '' ? null : event.target.valueAsNumber,
                              unknownAmountReason:
                                event.target.value === ''
                                  ? (item.unknownAmountReason ?? '金額をまだ確認していません。')
                                  : undefined,
                            })
                          }
                        />
                      </label>
                      {item.amountJpy === null && (
                        <label>
                          <span>金額が不明な理由</span>
                          <input
                            aria-label="直接費の金額が不明な理由"
                            value={item.unknownAmountReason ?? ''}
                            onChange={(event) =>
                              updateDirectCost(index, { unknownAmountReason: event.target.value })
                            }
                          />
                        </label>
                      )}
                      <button
                        type="button"
                        className="text-button"
                        onClick={() =>
                          updateDirectCost(index, {
                            amountJpy: null,
                            unknownAmountReason:
                              item.unknownAmountReason ?? '金額をまだ確認していません。',
                          })
                        }
                      >
                        金額を不明に戻す
                      </button>
                      {item.targets !== undefined ? (
                        <AllocationTargetsEditor
                          name={'direct-' + item.id}
                          targets={item.targets}
                          units={planningDraft.taxUnits}
                          onChange={(targets) => updateDirectCost(index, { targets })}
                        />
                      ) : (
                        <>
                          <label>
                            <span>結び付ける制作物</span>
                            <select
                              value={item.taxUnitId ?? ''}
                              onChange={(event) =>
                                updateDirectCost(index, {
                                  taxUnitId: event.target.value || undefined,
                                })
                              }
                            >
                              <option value="">まだ決めない</option>
                              {planningDraft.taxUnits.map((unit) => (
                                <option key={unit.id} value={unit.id}>
                                  {unit.name}
                                </option>
                              ))}
                            </select>
                          </label>
                          <button
                            type="button"
                            onClick={() =>
                              updateDirectCost(index, {
                                targets: [],
                                taxUnitId: undefined,
                                directlyAttributable: false,
                                treatment: 'shared',
                              })
                            }
                          >
                            直接費を制作物別に配分し直す
                          </button>
                        </>
                      )}
                      <label className="wide-field">
                        <span>メモ</span>
                        <input
                          value={item.note ?? ''}
                          onChange={(event) =>
                            updateDirectCost(index, { note: event.target.value })
                          }
                        />
                      </label>
                    </div>
                  ))}
                </div>
                <div className="cost-editor-section">
                  <div className="cost-editor-heading">
                    <div>
                      <h4>根拠メモ</h4>
                      <p>
                        領収書、販売ページ、初回利用などの所在だけを記録します。ファイル自体はアップロードしません。
                      </p>
                    </div>
                    <button
                      className="secondary-button"
                      onClick={() =>
                        setPlanningDraft((current) => ({
                          ...current,
                          evidence: [
                            ...current.evidence,
                            {
                              id: `evidence-${Date.now()}`,
                              evidenceType: 'memo',
                              strength: 'self-recorded',
                              occurredOn: `${current.profile.taxYear}-01-01`,
                              recordedAt: new Date().toISOString(),
                              note: 'あとで内容を確認',
                              taxUnitId: current.taxUnits[0]?.id,
                            },
                          ],
                        }))
                      }
                    >
                      ＋ 追加
                    </button>
                  </div>
                  {planningDraft.evidence.map((item, index) => (
                    <div className="cost-edit-row" key={item.id}>
                      <label>
                        <span>日付</span>
                        <DateInput
                          value={item.occurredOn ?? ''}
                          onValueChange={(value) =>
                            updateEvidence(index, { occurredOn: value || undefined })
                          }
                        />
                      </label>
                      <label>
                        <span>根拠の種類</span>
                        <select
                          value={item.evidenceType}
                          onChange={(event) =>
                            updateEvidence(index, {
                              evidenceType: event.target.value as EvidenceRecord['evidenceType'],
                            })
                          }
                        >
                          <option value="receipt">領収書</option>
                          <option value="card-statement">カード明細</option>
                          <option value="deployment">公開記録</option>
                          <option value="sale-page">販売ページ</option>
                          <option value="first-use">初回利用</option>
                          <option value="screenshot">画面保存</option>
                          <option value="memo">自分のメモ</option>
                          <option value="ai-session">AI利用履歴</option>
                          <option value="other">その他</option>
                        </select>
                      </label>
                      <label>
                        <span>結び付ける制作物</span>
                        <select
                          value={item.taxUnitId ?? ''}
                          onChange={(event) =>
                            updateEvidence(index, { taxUnitId: event.target.value || undefined })
                          }
                        >
                          <option value="">全体</option>
                          {planningDraft.taxUnits.map((unit) => (
                            <option key={unit.id} value={unit.id}>
                              {unit.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="wide-field">
                        <span>何を確認できる記録？</span>
                        <input
                          value={item.note}
                          onChange={(event) => updateEvidence(index, { note: event.target.value })}
                        />
                      </label>
                      <label className="wide-field">
                        <span>このPC内の保存場所（任意）</span>
                        <input
                          placeholder="例：領収書フォルダ/2026-07.pdf"
                          value={item.localReference ?? ''}
                          onChange={(event) =>
                            updateEvidence(index, {
                              localReference: event.target.value || undefined,
                            })
                          }
                        />
                      </label>
                    </div>
                  ))}
                </div>
                <div className="setup-insight">
                  <span>✓</span>
                  <p>
                    <strong>ここまで分かりました</strong>
                    <br />
                    機器{planningDraft.equipment.length}件、自宅費用{planningDraft.homeCosts.length}
                    件、直接費{planningDraft.directCosts.length}件、根拠
                    {planningDraft.evidence.length}
                    件を記録します。入力が増えるほど、説明できる金額が増えていきます。
                  </p>
                </div>
                <EquipmentMethodsEditor
                  allowRead={!apiUnavailable}
                  planning={planningDraft}
                  onChange={(equipmentMethods) =>
                    setPlanningDraft((current) => ({ ...current, equipmentMethods }))
                  }
                />
                <DecisionEditor
                  consultation={consultation}
                  value={planningDraft.decisions}
                  savedValue={workspaceBase?.planning.decisions ?? planning.decisions}
                  units={planningDraft.taxUnits}
                  year={planningDraft.profile.taxYear}
                  datasetId={runtime?.datasetId}
                  parentRevision={workspaceBase?.revision ?? 0}
                  onChange={(decisions) =>
                    setPlanningDraft((current) => ({ ...current, decisions }))
                  }
                />
              </>
            )}
            {step === 4 && (
              <>
                <span className="step-label">5 / 5　これから行うこと</span>
                <h3>いまの整理結果です</h3>
                {Boolean(data.unknownCharges?.length) && (
                  <p>
                    請求額が未確認のAI契約が{data.unknownCharges!.length}
                    件あります。表示額は確認済みの請求分です。未確認分の期間と理由を「支払と配分」で確認してください。
                  </p>
                )}
                <p>
                  {isDemoData
                    ? '合成データによる表示例です。'
                    : '保存済みの全費用資料から集計した結果です。'}
                  編集中の変更は、保存するまで反映されません。申告区分ごとの金額比較は、適用条件を結ぶ計算が未接続のため表示していません。
                </p>
                <AnnualOverview
                  year={planningDraft.profile.taxYear}
                  projection={data.costProjection}
                  showAiFilterNote={false}
                  onOpenCosts={() => setShowResultCosts(true)}
                />
                {showResultCosts && (
                  <CostsPage
                    initial={
                      data.costProjection?.year === planningDraft.profile.taxYear
                        ? data.costProjection
                        : undefined
                    }
                    local={false}
                    readOnly
                    onEdit={() => {}}
                  />
                )}
                <div className="onboarding-diagnosis">
                  <section>
                    <h4>入力から見つかった不足情報</h4>
                    {draftDiagnosis.missingFacts.length > 0 ? (
                      <ul>
                        {draftDiagnosis.missingFacts.map((fact) => (
                          <li key={fact}>{fact}</li>
                        ))}
                      </ul>
                    ) : (
                      <p>
                        現在の検査項目では不足を検出していません。原本の確認や税務上の適用条件の確認が完了したことを示すものではありません。
                      </p>
                    )}
                  </section>
                  <section>
                    <h4>現在地</h4>
                    <ul>
                      {planningDraft.taxUnits.map((unit) => (
                        <li key={unit.id}>
                          <strong>{unit.name || '名前未入力'}</strong>：
                          {usageModeLabel(unit.usageMode)}・{lifecycleLabel(unit.lifecycleStatus)}
                        </li>
                      ))}
                    </ul>
                  </section>
                  <section>
                    <h4>今すぐ確認すること</h4>
                    <ul>
                      {draftDiagnosis.immediateActions.slice(0, 3).map((action) => (
                        <li key={action.id}>
                          <strong>{action.title}</strong>
                          <span>{action.reason}</span>
                        </li>
                      ))}
                    </ul>
                  </section>
                  <section>
                    <h4>あとで出来事が起きたら</h4>
                    <ul>
                      {draftDiagnosis.eventTriggeredActions.slice(0, 2).map((action) => (
                        <li key={action.id}>
                          <strong>{action.title}</strong>
                          <span>{action.reason}</span>
                        </li>
                      ))}
                    </ul>
                  </section>
                </div>
                <details className="advanced-fields">
                  <summary>詳しい税務上の注意を見る</summary>
                  <p>
                    表示される処理は候補です。金額を増やすための追加開発や、税務だけを目的に公開日を動かす提案は行いません。実際の使い方と記録を一致させてください。
                  </p>
                </details>
                {unassignedFolderCount > 0 && (
                  <div className="setup-insight">
                    <span>▤</span>
                    <p>
                      <strong>
                        まだ割り当てていないフォルダが{unassignedFolderCount}件あります
                      </strong>
                      <br />
                      保存したあと「フォルダの割当」画面で、どの制作物の作業だったかを決められます。
                      割り当てるまで、その利用分は「対象外・要確認」に残ります。
                    </p>
                  </div>
                )}
              </>
            )}
          </div>
          <div className="onboarding-footer">
            {notice && (
              <div
                className={`setup-notice ${notice.kind}`}
                role={notice.kind === 'error' ? 'alert' : 'status'}
                aria-live="polite"
              >
                <span>{notice.kind === 'success' ? '✓' : notice.kind === 'error' ? '!' : 'ⓘ'}</span>
                {notice.message}
              </div>
            )}
            <div className="modal-actions">
              <button
                className="secondary-button"
                disabled={busy}
                onClick={() => {
                  // Without this, an error raised on the cost step keeps showing
                  // on 対象年 and 制作物 until the next forward click.
                  setNotice(null)
                  if (step === 0) onClose()
                  else onStep(step - 1)
                }}
              >
                {step === 0 ? 'あとで確認' : '戻る'}
              </button>
              {step > 0 && step < 4 && (
                <button
                  className="text-button save-progress"
                  disabled={busy}
                  onClick={saveProgress}
                >
                  ここまで保存
                </button>
              )}
              {step > 0 && step < 4 && onPreviewWorkspace && !apiUnavailable && (
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() => void previewProgress()}
                >
                  変更の影響を確認
                </button>
              )}
              <button
                className="primary-button"
                disabled={busy || runtimeLoading}
                onClick={advance}
              >
                {busy
                  ? step === 0
                    ? scanProgress?.running
                      ? // Naming the provider matters here: the count restarts
                        // at 0 for the second provider, and without the name
                        // the number looks like it went backwards.
                        `${scanProgress.sourceName ?? (scanProgress.provider === 'codex' ? 'Codex' : 'Claude')}を走査中… ${scanProgress.filesScanned}ファイル`
                      : '履歴を確認中…'
                    : '保存中…'
                  : step === 0
                    ? apiUnavailable
                      ? 'デモで次へ'
                      : '履歴を確認して次へ'
                    : step === 3
                      ? apiUnavailable
                        ? 'デモ結果を見る'
                        : onReviewWorkspace
                          ? '影響を確認して保存'
                          : '保存して結果を見る'
                      : step === 4
                        ? '完了'
                        : '次へ'}
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}

export default Onboarding
