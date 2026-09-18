import SourceAdjustmentsEditor from './client/pages/SourceAdjustmentsEditor'
import TreatmentHandoffPanel from './client/pages/TreatmentHandoffPanel'
import { draftTreatmentDecision, refreshTreatmentDecision } from './core/costTreatmentDraft'
import type { AnnualCostProjection } from './accounting/costs'
import CostTreatmentFactsEditor from './client/pages/CostTreatmentFactsEditor'
import { editCostTreatmentFacts, type CostTreatmentFacts } from './core/costTreatmentFacts'
import { editSourceAdjustment } from './core/sourceAdjustmentEdit'
import type { SourceAdjustmentRecord } from './core/sourceAdjustments'
import { useEffect, useMemo, useRef, useState } from 'react'
import WorkspaceAttemptPanel from './client/pages/WorkspaceAttemptPanel'
import { retainWorkspaceAttempt, removeWorkspaceAttempt, type WorkspaceAttempt } from './client/workspaceAttempt'
import RestoreSourcesPanel from './client/pages/RestoreSourcesPanel'
import { demoDiagnosis, demoPlanning, getDashboardData, isLocalRuntime, type Allocation, type DashboardData, type TaxGroup } from './client/dashboard'
import {
  getFolders, getWorkspace, saveWorkspace, previewWorkspace, ApiRequestError,
  getHistorySources, getScanProgress, getRuntime, createHistorySource,
  removeHistorySource, saveRetention, scanHistory, testHistorySource, updateHistorySource,
} from './client/api'
import type {
  FolderSummary, HistorySource, HistorySourceInput, HistorySourceTestResult,
  LocalConfiguration, ProviderKey, RuntimeData, ScanMode, ScanResult,
} from './client/types'
import type { Diagnosis, PlanningSnapshot, ProjectClassification, ProjectRuleRecord } from './planning/types'
import { annualAiView, belongsToYear } from './client/annualView'
import Onboarding from './client/pages/Onboarding'
import type { ConsultationNavigation } from './client/consultationNavigation'
import FolderAssignmentPage from './client/pages/FolderAssignmentPage'
import CostsPage from './client/pages/CostsPage'
import BalancesPage from './client/pages/BalancesPage'
import SummaryPage from './client/pages/SummaryPage'
import EvidencePage from './client/pages/EvidencePage'
import TaxGuidePage from './client/pages/TaxGuidePage'
import WorkspaceImpactPanel, { type WorkspaceImpactState } from './client/pages/WorkspaceImpactPanel'
import WorkspaceConflictPanel, { type WorkspaceComparison } from './client/pages/WorkspaceConflictPanel'
import { mergeWorkspaceDrafts, type WorkspaceContents } from './core/workspaceMerge'
import { isNewWorkspace, workspaceChangeKind } from './core/workspaceChange'
import { incomeCategoryLabel, ruleId } from './client/pages/shared'
import type { WorkspaceDraft, WorkspaceView, WorkspaceSave } from './planning/workspace'
import './index.css'

type Page = 'summary' | 'evidence' | 'folders' | 'guide' | 'costs' | 'balances'
type Provider = 'すべて' | 'Claude Code' | 'Codex'
const pageTitles: Record<Page, string> = {
  summary: '今年どうなる？', evidence: 'なぜそうなる？', folders: 'フォルダの割当',
  guide: '税務の言葉を知る', costs: '支払と配分', balances: '残高と繰越し',
}
const descriptions: Record<Page, string> = {
  summary: '対象年の全費用、計算できた範囲と未確定の扱いを確認します。',
  evidence: '実際の請求・配分基準・制作物・根拠のつながりを確認します。',
  folders: 'AI履歴の作業フォルダを、制作物と作業内容へ結び付けます。',
  guide: '取得価額や資本的支出など、判断に必要な言葉を確認します。',
  costs: 'AI料金・設備・自宅費用・直接費を同じ資料で確認します。不明な費用基礎も残します。',
  balances: '種類別の期首・増減・期末と、判断・原価の対応を確認します。',
}

export default function App() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [page, setPage] = useState<Page>('summary')
  const [balancesOpened, setBalancesOpened] = useState(false)
  const [balanceNavigation, setBalanceNavigation] = useState<{ year: number; request: number; datasetId?: string; contributionId?: string }>()
  const [provider, setProvider] = useState<Provider>('すべて')
  const [product, setProduct] = useState('すべて')
  const [onboarding, setOnboarding] = useState(false)
  const [consultationContext, setConsultationContext] = useState<ConsultationNavigation>()
  const [onboardingStep, setOnboardingStep] = useState(0)
  const [selectedAllocation, setSelectedAllocation] = useState<Allocation | null>(null)
  const [runtime, setRuntime] = useState<RuntimeData | null>(null)
  const [configuration, setConfiguration] = useState<LocalConfiguration | null>(null)
  const [planning, setPlanningState] = useState<PlanningSnapshot>(demoPlanning)
  const [diagnosis, setDiagnosis] = useState<Diagnosis>(demoDiagnosis)
  const [folders, setFolders] = useState<FolderSummary[]>([])
  const [historySources, setHistorySources] = useState<HistorySource[]>([])
  const [rulesBusy, setRulesBusy] = useState(false)
  const [rulesError, setRulesError] = useState<string | null>(null)
  const [runtimeLoading, setRuntimeLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const autoOnboardingShown = useRef(false)
  const pendingSave = useRef<WorkspaceSave | null>(null)
  const workspaceBase = useRef<WorkspaceDraft | null>(null)
  const recoveredWorkspace = useRef(false)
  const [editorBase, setEditorBase] = useState<WorkspaceDraft | null>(null)
  const editorBaseRef = useRef<WorkspaceDraft | null>(null)
  const refreshSequence = useRef(0)
  const [comparison, setComparison] = useState<WorkspaceComparison | null>(null)
  const [resolvedSaveCount, setResolvedSaveCount] = useState(0)
  const [resolvedSaveMessage, setResolvedSaveMessage] = useState('比較して選んだ内容を保存しました。入力を続けられます。')
  const [impact, setImpact] = useState<WorkspaceImpactState | null>(null)
  const impactRequest = useRef(0)
  const reviewCompletion = useRef<((saved: boolean) => void) | null>(null)

  function updateEditorBase(next: WorkspaceDraft | null): void {
    editorBaseRef.current = next
    setEditorBase(next)
  }
  function openOnboarding(context?: ConsultationNavigation): void {
    setConsultationContext(context)
    recoveredWorkspace.current = false
    updateEditorBase(workspaceBase.current ? structuredClone(workspaceBase.current) : null)
    setOnboarding(true)
  }

  useEffect(() => {
    setLoadError(null)
    setRuntimeLoading(true)
    let cancelled = false
    if (!isLocalRuntime()) {
      void getDashboardData().then((next) => { if (!cancelled) setData(next) })
        .catch((error: unknown) => { if (!cancelled) setLoadError(error instanceof Error ? error.message : 'デモを読み込めませんでした。') })
        .finally(() => { if (!cancelled) setRuntimeLoading(false) })
      return () => { cancelled = true }
    }
    void (async () => {
      const nextRuntime = await getRuntime()
      if (cancelled) return
      setRuntime(nextRuntime)
      await refreshUsageViews()
      const startupDeadline = Date.now() + 5 * 60 * 1_000
      let loadingReleased = false
      while (!cancelled) {
        const progress = await getScanProgress()
        if (!progress.running && !progress.startupPending) break
        if (!loadingReleased && Date.now() >= startupDeadline) {
          loadingReleased = true
          setRuntimeLoading(false)
        }
        await new Promise((resolve) => setTimeout(resolve, 250))
      }
      if (!cancelled) await refreshUsageViews()
    })().catch((error: unknown) => {
      if (!cancelled) setLoadError(error instanceof Error && error.message ? error.message : 'ローカルデータの読込に失敗しました。')
    }).finally(() => { if (!cancelled) setRuntimeLoading(false) })
    return () => { cancelled = true }
  }, [loadAttempt])

  useEffect(() => {
    if (runtime?.restoreRequiresReconnect) { autoOnboardingShown.current = true; return }
    if (onboarding || runtimeLoading || autoOnboardingShown.current || !data || data.meta.source !== 'local' || !configuration) return
    autoOnboardingShown.current = true
    if (isNewWorkspace({ configuration, planning }, data.meta.sessionCount)) {
      setOnboardingStep(0)
      openOnboarding()
    }
  }, [configuration, data, planning, runtimeLoading, onboarding, runtime?.restoreRequiresReconnect])

  function applyWorkspace(next: WorkspaceView, saved = false): void {
    workspaceBase.current = structuredClone({ revision: next.revision, configuration: next.configuration, planning: next.planning })
    if (saved && editorBaseRef.current) updateEditorBase(structuredClone(workspaceBase.current))
    setData(next.dashboard)
    setConfiguration(next.configuration)
    setPlanningState(next.planning)
    setDiagnosis(next.diagnosis)
  }
  async function refreshUsageViews(): Promise<void> {
    const sequence = ++refreshSequence.current
    const [nextWorkspace, nextFolders, nextSources] = await Promise.all([getWorkspace(), getFolders(), getHistorySources()])
    if (sequence !== refreshSequence.current) return
    applyWorkspace(nextWorkspace)
    setFolders(nextFolders.folders)
    setHistorySources(nextSources.sources)
  }
  async function runScan(providers: ProviderKey[], mode: ScanMode = 'incremental'): Promise<ScanResult> {
    const activeRuntime = runtime ?? await getRuntime()
    if (!runtime) setRuntime(activeRuntime)
    const result = await scanHistory(activeRuntime.csrfToken, providers, mode)
    await refreshUsageViews()
    return result
  }
  async function withCsrf<T>(action: (csrfToken: string) => Promise<T>): Promise<T> {
    const activeRuntime = runtime ?? await getRuntime()
    if (!runtime) setRuntime(activeRuntime)
    return action(activeRuntime.csrfToken)
  }
  async function saveHistorySource(source: HistorySourceInput, sourceId?: string): Promise<void> {
    await withCsrf((token) => sourceId ? updateHistorySource(token, sourceId, source) : createHistorySource(token, source))
    await refreshUsageViews()
  }
  function testSourceVisibility(source: HistorySourceInput): Promise<HistorySourceTestResult> {
    return withCsrf((token) => testHistorySource(token, source))
  }
  async function deleteHistorySource(sourceId: string): Promise<void> {
    await withCsrf((token) => removeHistorySource(token, sourceId))
    await refreshUsageViews()
  }
  async function storeRetention(days: number): Promise<{ days: number; previousDays?: number; backupFileName?: string }> {
    const activeRuntime = runtime ?? await getRuntime()
    if (!runtime) setRuntime(activeRuntime)
    const result = await saveRetention(activeRuntime.csrfToken, days)
    setRuntime(await getRuntime())
    return result
  }
  async function storeWorkspace(nextConfiguration: LocalConfiguration, nextPlanning: PlanningSnapshot): Promise<void> {
    const base = editorBaseRef.current ?? workspaceBase.current
    if (!base) throw new Error('保存元の版を読み込めていません。画面を再読込してください。')
    await commitWorkspace(nextConfiguration, nextPlanning, base)
  }
  async function readComparison(current: WorkspaceComparison): Promise<void> {
    setComparison(current)
    try {
      const latest = await getWorkspace()
      setComparison((value) => value === current ? { ...current, latest } : value)
    } catch (error) {
      setComparison((value) => value === current ? {
        ...current, loadError: error instanceof Error ? error.message : '最新の内容を読み込めませんでした。',
      } : value)
    }
  }
  async function commitWorkspace(nextConfiguration: LocalConfiguration, nextPlanning: PlanningSnapshot, base: WorkspaceDraft, previewHash?: string): Promise<void> {
    const activeRuntime = runtime ?? await getRuntime()
    if (!runtime) setRuntime(activeRuntime)
    const body = { expectedRevision: base.revision, configuration: nextConfiguration, planning: nextPlanning, ...(previewHash ? { previewHash } : {}) }
    const previous = pendingSave.current
    const sameRequest = previous && JSON.stringify({ ...previous, requestId: undefined }) === JSON.stringify(body)
    const request = sameRequest ? previous : structuredClone({ ...body, requestId: crypto.randomUUID() })
    pendingSave.current = request
    if (recoveredWorkspace.current) {
      const currentRuntime = await getRuntime()
      if (currentRuntime.datasetId !== runtime?.datasetId) throw new Error('接続先のデータが変わっています。再読込してください。')
      const latest = await getWorkspace()
      const desired = { configuration: nextConfiguration, planning: nextPlanning }
      if (mergeWorkspaceDrafts(desired, desired, latest).changes.length === 0) {
        pendingSave.current = null
        recoveredWorkspace.current = false
        applyWorkspace(latest, true)
        return
      }
      if (base.revision !== latest.revision || mergeWorkspaceDrafts(base, base, latest).changes.length) {
        setComparison({ base: structuredClone(base), local: request, latest, requirePreview: Boolean(previewHash) })
        throw new Error('控えの保存元から内容が変わっています。最新との比較で確認してください。')
      }
    }
    const attempt = activeRuntime.datasetId ? retainWorkspaceAttempt({
      version: 1, datasetId: activeRuntime.datasetId, createdAt: new Date().toISOString(), base: structuredClone(base), request,
    }) : null
    try {
      const next = await saveWorkspace(activeRuntime.csrfToken, request)
      pendingSave.current = null
      refreshSequence.current++
      applyWorkspace(next, true)
      if (attempt) {
        try { removeWorkspaceAttempt(window.localStorage, attempt) } catch { /* Server success is not undone by local cleanup failure. */ }
      }
      recoveredWorkspace.current = false
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 409 && error.code === 'workspace_conflict') {
        if (previewHash) setImpact(null)
        await readComparison({ base: structuredClone(base), local: request, latest: null, requirePreview: Boolean(previewHash) })
      }
      throw error
    }
  }
  async function retryWorkspaceAttempt(record: WorkspaceAttempt): Promise<void> {
    const freshRuntime = await getRuntime()
    if (freshRuntime.datasetId !== record.datasetId) throw new Error('接続先の資料が変わっています。再読込して確認してください。')
    const localCopy = retainWorkspaceAttempt(record)
    const retained = localCopy ?? record
    try {
      const next = await saveWorkspace(freshRuntime.csrfToken, retained.request)
      refreshSequence.current++
      applyWorkspace(next)
      if (localCopy) {
        try { removeWorkspaceAttempt(window.localStorage, localCopy) } catch { /* Keep successful save successful. */ }
      }
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 409 && error.code === 'workspace_conflict') {
        await readComparison({ base: retained.base, local: retained.request, latest: null, requirePreview: Boolean(retained.request.previewHash) })
        throw new Error('別の保存で内容が変わっています。最新との比較で確認してください。元の要求は保持しています。')
      }
      throw error
    }
  }
  async function afterResolvedSave(message: string): Promise<void> {
    setRulesError(null)
    setResolvedSaveMessage(message)
    setResolvedSaveCount((value) => value + 1)
    try { setFolders((await getFolders()).folders) }
    catch { setRulesError('変更は保存しました。フォルダ一覧の再読込に失敗しています。') }
  }
  async function resolveComparison(contents: WorkspaceContents): Promise<void> {
    if (!comparison?.latest) return
    if (comparison.requirePreview) {
      const base = comparison.latest
      setComparison(null)
      await openWorkspacePreview(contents.configuration, contents.planning, base)
      return
    }
    await commitWorkspace(contents.configuration, contents.planning, comparison.latest)
    setComparison(null)
    await afterResolvedSave('比較して選んだ内容を保存しました。入力を続けられます。')
  }
  async function loadImpact(current: WorkspaceImpactState): Promise<void> {
    const request = ++impactRequest.current
    setImpact(current)
    try {
      const activeRuntime = runtime ?? await getRuntime()
      const report = await previewWorkspace(activeRuntime.csrfToken, current.input)
      if (request !== impactRequest.current) return
      setImpact((value) => value === current ? { ...current, report, error: undefined, stale: false } : value)
    } catch (error) {
      if (request !== impactRequest.current) return
      if (error instanceof ApiRequestError && error.status === 409 && error.code === 'workspace_conflict') {
        setImpact(null)
        await readComparison({ base: current.base, local: { ...current.input, requestId: crypto.randomUUID() }, latest: null, requirePreview: true })
      } else {
        setImpact((value) => value === current ? { ...current, error: error instanceof Error ? error.message : '影響を確認できませんでした。' } : value)
      }
    }
  }
  async function openWorkspacePreview(nextConfiguration: LocalConfiguration, nextPlanning: PlanningSnapshot, base = editorBaseRef.current ?? workspaceBase.current): Promise<void> {
    if (!base) throw new Error('保存元の版を読み込めていません。')
    await loadImpact({
      base: structuredClone(base),
      input: structuredClone({ expectedRevision: base.revision, configuration: nextConfiguration, planning: nextPlanning }), report: null,
    })
  }
  async function reviewWorkspace(nextConfiguration: LocalConfiguration, nextPlanning: PlanningSnapshot): Promise<boolean> {
    const base = editorBaseRef.current ?? workspaceBase.current
    if (base && workspaceChangeKind(base, { configuration: nextConfiguration, planning: nextPlanning }) !== 'calculation') {
      await storeWorkspace(nextConfiguration, nextPlanning)
      return true
    }
    const completed = new Promise<boolean>((resolve) => { reviewCompletion.current = resolve })
    try { await openWorkspacePreview(nextConfiguration, nextPlanning) }
    catch (error) {
      reviewCompletion.current?.(false)
      reviewCompletion.current = null
      throw error
    }
    return completed
  }
  async function saveImpact(): Promise<void> {
    if (!impact?.report || impact.stale) return
    try { await commitWorkspace(impact.input.configuration, impact.input.planning, impact.base, impact.report.previewHash) }
    catch (error) {
      if (error instanceof ApiRequestError && error.code === 'preview_changed') setImpact((current) => current ? { ...current, stale: true, error: error.message } : null)
      throw error
    }
    setImpact(null)
    reviewCompletion.current?.(true)
    reviewCompletion.current = null
    await afterResolvedSave('変更の影響を確認した内容を保存しました。入力を続けられます。')
  }
  async function reviewAdjustment(next: SourceAdjustmentRecord | null, previous: SourceAdjustmentRecord | null): Promise<boolean> {
    const base = workspaceBase.current
    if (!base || onboarding || comparison || impact || reviewCompletion.current)
      throw new Error('別の入力・確認が進行中です。その内容を保存またはキャンセルしてから操作してください。')
    const sourceAdjustments = editSourceAdjustment(base.planning.sourceAdjustments ?? [], next, previous)
    return reviewWorkspace(base.configuration, { ...base.planning, sourceAdjustments })
  }
  async function reviewTreatment(next: CostTreatmentFacts | null, previous: CostTreatmentFacts | null): Promise<boolean> {
    const base = workspaceBase.current
    if (!base || onboarding || comparison || impact || reviewCompletion.current)
      throw new Error('別の入力・確認が進行中です。その内容を保存またはキャンセルしてから操作してください。')
    const costTreatmentFacts = editCostTreatmentFacts(base.planning.costTreatmentFacts ?? [], next, previous)
    return reviewWorkspace(base.configuration, { ...base.planning, costTreatmentFacts })
  }
  async function reviewTreatmentDecision(costs: AnnualCostProjection, contributionId: string, existingId?: string): Promise<boolean> {
    const base = workspaceBase.current
    if (!base || onboarding || comparison || impact || reviewCompletion.current)
      throw new Error('別の入力・確認が進行中です。先に保存またはキャンセルしてください。')
    const decision = existingId
      ? refreshTreatmentDecision(costs, base.planning, contributionId, existingId)
      : draftTreatmentDecision(costs, base.planning, contributionId, crypto.randomUUID(), new Date().toISOString())
    const decisions = existingId ? base.planning.decisions.map((row) => row.id === existingId ? decision : row)
      : [...base.planning.decisions, decision]
    return reviewWorkspace(base.configuration, { ...base.planning, decisions })
  }
  async function storeRules(rules: ProjectRuleRecord[]): Promise<void> {
    setRulesBusy(true)
    try {
      if (!configuration) throw new Error('料金設定を読み込めていません。')
      await openWorkspacePreview(configuration, { ...planning, projectRules: rules })
      setRulesError(null)
    } catch (error) { setRulesError(error instanceof Error ? error.message : '保存できませんでした。') }
    finally { setRulesBusy(false) }
  }
  async function reclassifyAllocation(row: Allocation, classification: ProjectClassification): Promise<void> {
    if (!row.projectKey || !row.monthKey) return
    const effectiveFrom = `${row.monthKey}-01`
    const id = ruleId(row.projectKey, effectiveFrom)
    const existing = planning.projectRules.find((rule) => rule.id === id)
    await storeRules([
      ...planning.projectRules.filter((rule) => rule.id !== id),
      { id, projectKey: row.projectKey, effectiveFrom, effectiveTo: existing?.effectiveTo,
        taxUnitId: row.taxUnitId ?? existing?.taxUnitId, classification, reason: '配賦明細から変更' },
    ])
  }
  const allocations = useMemo(() => data ? data.allocations.filter((row) =>
    (page !== 'summary' || belongsToYear(row, planning.profile.taxYear)) &&
    (provider === 'すべて' || row.provider === provider) && (product === 'すべて' || row.product === product),
  ) : [], [data, product, provider, page, planning.profile.taxYear])

  if (loadError) return <main className="loading-shell" aria-busy="false">
    <div className="radar-mark">D</div><h1>ローカルデータを読み込めませんでした</h1>
    <p role="alert">{loadError}</p><p>DevTaxが起動していることを確認して、もう一度読み込んでください。</p>
    <button type="button" className="primary-button" onClick={() => setLoadAttempt((attempt) => attempt + 1)}>もう一度読み込む</button>
  </main>
  if (!data) return <main className="loading-shell" aria-busy="true"><div className="radar-mark">D</div><p>ローカルの利用履歴を集計しています…</p></main>

  const annual = annualAiView(data, planning.profile.taxYear)
  const representativeTotals = allocations.reduce((sum, row) => { sum[row.group] += row.amount; return sum }, { current: 0, future: 0, review: 0 } as Record<TaxGroup, number>)
  const filteredTotals = provider === 'すべて' && product === 'すべて'
    ? annual.months.reduce((sum, month) => ({ current: sum.current + month.current, future: sum.future + month.future, review: sum.review + month.review }), { current: 0, future: 0, review: 0 })
    : representativeTotals
  const products = ['すべて', ...new Set(data.allocations.map((row) => row.product))]
  const unassignedFolderCount = folders.filter((folder) => folder.unassignedSessionCount > 0).length
  const filteredMonths = annual.months.map((month) => {
    if (provider === 'すべて' && product === 'すべて') return month
    const rows = allocations.filter((row) => row.month === month.label)
    return { ...month,
      current: rows.reduce((sum, row) => sum + (row.group === 'current' ? row.amount : 0), 0),
      future: rows.reduce((sum, row) => sum + (row.group === 'future' ? row.amount : 0), 0),
      review: rows.reduce((sum, row) => sum + (row.group === 'review' ? row.amount : 0), 0),
    }
  })
  const relevantUnknown = (data.unknownCharges ?? []).filter((charge) =>
    charge.serviceStartedOn <= `${planning.profile.taxYear}-12-31` && charge.serviceEndedOn >= `${planning.profile.taxYear}-01-01`,
  )
  function openBalances() {
    setBalanceNavigation((previous) => ({ year: planning.profile.taxYear, request: (previous?.request ?? 0) + 1, datasetId: runtime?.datasetId }))
    setBalancesOpened(true)
    setPage('balances')
  }
  function editAt(step: number) { setOnboardingStep(step); openOnboarding() }

  return <div className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="#top" aria-label="DevTax ホーム"><span className="radar-mark">D</span><span><strong>DevTax</strong><small>原価を、説明できる数字に。</small></span></a>
      <nav aria-label="メインナビゲーション">
        {([
          ['costs', '01', '支払と配分', '全費用の原額・期間・対応先'],
          ['balances', '02', '残高と繰越し', '期首・増減・期末の記録'],
          ['summary', '⌁', '今年どうなる？', '対象年の費用と確認事項'],
          ['evidence', '≡', 'なぜそうなる？', '配賦と根拠ログ'],
          ['folders', '▤', 'フォルダの割当', '履歴と制作物を結ぶ'],
          ['guide', '?', '税務QA', '言葉と境界を知る'],
        ] as const).map(([target, icon, title, detail]) => <button key={target} className={page === target ? 'nav-item active' : 'nav-item'} onClick={() => {
          if (target === 'balances') setBalancesOpened(true)
          setPage(target)
        }}><span aria-hidden="true">{icon}</span><span>{title}<small>{detail}</small></span></button>)}
      </nav>
      <div className="sidebar-status">
        <div className="status-line"><span className="pulse" /><span>{data.meta.source === 'local' ? 'ローカル接続中' : '合成データデモ'}</span></div>
        <strong>{data.meta.sessionCount.toLocaleString()}件の利用記録</strong><small>最終走査 {data.meta.lastSynced}</small>
        <button className="quiet-button" onClick={() => editAt(0)}>設定を確認</button>
      </div>
      <p className="local-note">{data.meta.source === 'local' ? '通常集計は履歴本文を保存・外部送信しません' : '実在する履歴・請求額・パスは含みません'}</p>
    </aside>
    <div className="workspace" id="top">
      <header className="topbar">
        <div><span className="eyebrow">{page === 'costs' ? '計画に設定した年' : '対象年'}</span><strong>{planning.profile.taxYear}年</strong><span className="profile-pill">{incomeCategoryLabel(planning.profile.incomeCategory)}</span></div>
        <div className="top-actions"><span className={data.meta.source === 'local' ? 'source-badge live' : 'source-badge'}>{data.meta.source === 'local' ? '実データ' : 'デモデータ'}</span>
          {data.meta.source !== 'demo' && <button className="primary-button" onClick={() => editAt(3)}>＋ 月次確認</button>}
        </div>
      </header>
      <main className="content">
        {runtime?.datasetId && data.meta.source === 'local' && <WorkspaceAttemptPanel key={runtime.datasetId} datasetId={runtime.datasetId} disabled={onboarding || rulesBusy || Boolean(comparison) || Boolean(impact)} onRetry={retryWorkspaceAttempt} />}
        {runtime?.restoreRequiresReconnect && <RestoreSourcesPanel onComplete={() => setRuntime((current) => current && { ...current, restoreRequiresReconnect: false })} />}
        {relevantUnknown.length > 0 && <section className="panel" aria-label="未確認のAI請求額">
          <strong>対象年の請求額が未確認のAI契約が{relevantUnknown.length}件あります</strong>
          <p>未確認分の原額・期間・理由は「支払と配分」で確認できます。既知の小計へ0円として含めていません。</p>
          <ul>{relevantUnknown.map((charge) => <li key={charge.id}>{charge.provider === 'claude' ? 'Claude Code' : 'Codex'}：{charge.serviceStartedOn}～{charge.serviceEndedOn} / {charge.reason}</li>)}</ul>
        </section>}
        {data.meta.source === 'demo' && <section className="public-demo-banner" aria-labelledby="public-demo-title">
          <span className="demo-shield" aria-hidden="true">✓</span>
          <div className="demo-banner-copy"><span className="demo-label">公開デモ・合成データ</span><strong id="public-demo-title">支払から、説明できるプロダクト原価へ。</strong>
            <p>この画面に実在の履歴・請求額・パスは含まれません。デモも共通の費用計算を使用します。</p>
          </div><button className="demo-cta" onClick={() => setPage(page === 'summary' ? 'evidence' : 'summary')}>{page === 'summary' ? '月次集計の根拠を辿る →' : '年間サマリーへ戻る ←'}</button>
        </section>}
        <section className="page-heading"><div><h1>{pageTitles[page]}</h1><p>{descriptions[page]}</p></div>
          {(page === 'summary' || page === 'evidence') && <div className="filters" aria-label="表示フィルター">
            <label><span>AIサービス</span><select value={provider} onChange={(event) => setProvider(event.target.value as Provider)}><option>すべて</option><option>Claude Code</option><option>Codex</option></select></label>
            <label><span>作っているもの</span><select value={product} onChange={(event) => setProduct(event.target.value)}>{products.map((item) => <option key={item}>{item}</option>)}</select></label>
          </div>}
        </section>
        {balancesOpened && <div hidden={page !== 'balances'}><BalancesPage
          onReviewAnswer={(context) => { setOnboardingStep(context.answer.kind === 'fact' ? 2 : 3); openOnboarding(context) }}
          navigation={balanceNavigation} key={runtime?.datasetId} datasetId={runtime?.datasetId}
          planning={planning} configuration={configuration} local={data.meta.source === 'local'} onManageUnits={() => editAt(2)}
        /></div>}
        <div hidden={page !== 'costs'}><CostsPage
          initial={data.costProjection} evidence={planning.evidence} local={data.meta.source === 'local'} onEdit={() => editAt(3)}
          treatmentEditor={runtime?.datasetId ? (projection) => <div key={runtime.datasetId}>
            <CostTreatmentFactsEditor projection={projection} planning={planning}
              disabled={onboarding || rulesBusy || Boolean(comparison) || Boolean(impact)} onReview={reviewTreatment} />
            <TreatmentHandoffPanel costs={projection} planning={planning}
              disabled={onboarding || rulesBusy || Boolean(comparison) || Boolean(impact)}
              onDecision={reviewTreatmentDecision} onBalance={(year, contributionId) => {
                setBalanceNavigation((previous) => ({ year, contributionId, request: (previous?.request ?? 0) + 1, datasetId: runtime.datasetId }))
                setBalancesOpened(true); setPage('balances')
              }} />
          </div> : undefined}
          adjustmentsEditor={runtime?.datasetId ? (projection) => <SourceAdjustmentsEditor
            key={runtime.datasetId} datasetId={runtime.datasetId!} projection={projection}
            records={planning.sourceAdjustments ?? []} evidence={planning.evidence}
            disabled={onboarding || rulesBusy || Boolean(comparison) || Boolean(impact)} onReview={reviewAdjustment}
          /> : undefined}
        /></div>
        {page === 'balances' || page === 'costs' ? null
          : page === 'summary' ? <SummaryPage key={runtime?.datasetId} onOpenBalances={openBalances} data={data} planning={planning} diagnosis={diagnosis} months={filteredMonths} undatedMonths={annual.undatedMonths} onOpenCosts={() => setPage('costs')} totals={filteredTotals} onOpenOnboarding={() => editAt(0)} retention={runtime?.retention ?? null} />
            : page === 'evidence' ? <EvidencePage data={data} planning={planning} diagnosis={diagnosis} allocations={allocations} selected={selectedAllocation} onSelect={setSelectedAllocation} busy={rulesBusy} error={rulesError} onReclassify={reclassifyAllocation} />
              : page === 'folders' ? <FolderAssignmentPage folders={folders} planning={planning} busy={rulesBusy} error={rulesError} onSaveRules={storeRules} />
                : <TaxGuidePage />}
      </main>
    </div>
    {onboarding && <Onboarding
      consultation={consultationContext} workspaceBase={editorBase ?? undefined}
      onRestoreWorkspaceBase={async (base) => {
        const currentRuntime = await getRuntime()
        if (!runtime?.datasetId || currentRuntime.datasetId !== runtime.datasetId) throw new Error('接続先のデータが変わっています。再読込してください。')
        recoveredWorkspace.current = true
        updateEditorBase(structuredClone(base))
      }}
      step={onboardingStep} data={data} runtime={runtime} runtimeLoading={runtimeLoading} historySources={historySources}
      configuration={editorBase?.configuration ?? configuration} planning={editorBase?.planning ?? planning}
      unassignedFolderCount={unassignedFolderCount} onStep={setOnboardingStep} onScan={runScan}
      onSaveHistorySource={saveHistorySource} onTestHistorySource={testSourceVisibility} onRemoveHistorySource={deleteHistorySource}
      onSaveWorkspace={storeWorkspace} onPreviewWorkspace={openWorkspacePreview} onReviewWorkspace={reviewWorkspace}
      suspended={comparison !== null || impact !== null} resolvedSaveCount={resolvedSaveCount} resolvedSaveMessage={resolvedSaveMessage}
      onSaveRetention={storeRetention}
      onClose={() => { updateEditorBase(null); setOnboarding(false); setOnboardingStep(0) }}
      onSaved={() => { if (unassignedFolderCount > 0) setPage('folders') }}
    />}
    {impact && <WorkspaceImpactPanel key={impact.report?.previewHash ?? 'loading'} impact={impact} onSave={saveImpact}
      onRefresh={() => void loadImpact({ ...impact, report: null, error: undefined, stale: false })}
      onCancel={() => { impactRequest.current++; setImpact(null); reviewCompletion.current?.(false); reviewCompletion.current = null }}
    />}
    {comparison && <WorkspaceConflictPanel key={`${comparison.local.requestId}:${comparison.latest?.revision ?? 'loading'}`}
      comparison={comparison} onSave={resolveComparison}
      onCancel={() => { setComparison(null); reviewCompletion.current?.(false); reviewCompletion.current = null }}
      onRetry={() => void readComparison({ ...comparison, loadError: undefined })}
    />}
  </div>
}
