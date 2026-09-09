import WorkspaceAttemptPanel from './client/pages/WorkspaceAttemptPanel'
import {
  retainWorkspaceAttempt,
  removeWorkspaceAttempt,
  type WorkspaceAttempt,
} from './client/workspaceAttempt'
import { useEffect, useMemo, useRef, useState } from 'react'
import RestoreSourcesPanel from './client/pages/RestoreSourcesPanel'
import {
  demoDiagnosis,
  demoLedger,
  demoPlanning,
  getDashboardData,
  isLocalRuntime,
  type Allocation,
  type DashboardData,
  type TaxGroup,
} from './client/dashboard'
import {
  getFolders,
  getWorkspace,
  saveWorkspace,
  previewWorkspace,
  ApiRequestError,
  getHistorySources,
  getScanProgress,
  getPlanningExport,
  getRuntime,
  createHistorySource,
  removeHistorySource,
  saveRetention,
  scanHistory,
  testHistorySource,
  updateHistorySource,
} from './client/api'
import type {
  FolderSummary,
  HistorySource,
  HistorySourceInput,
  HistorySourceTestResult,
  LocalConfiguration,
  ProviderKey,
  RuntimeData,
  ScanMode,
  ScanResult,
} from './client/types'
import type {
  Diagnosis,
  PlanningSnapshot,
  ProjectClassification,
  ProjectRuleRecord,
} from './planning/types'
import { annualAiView, belongsToYear } from './client/annualView'
import AnnualOverview from './client/pages/AnnualOverview'
import AnnualReviewSummary from './client/pages/AnnualReviewSummary'
import Onboarding from './client/pages/Onboarding'
import type { ConsultationNavigation } from './client/consultationNavigation'
import FolderAssignmentPage from './client/pages/FolderAssignmentPage'
import CostsPage from './client/pages/CostsPage'
import BalancesPage from './client/pages/BalancesPage'
import WorkspaceImpactPanel, {
  type WorkspaceImpactState,
} from './client/pages/WorkspaceImpactPanel'
import WorkspaceConflictPanel, {
  type WorkspaceComparison,
} from './client/pages/WorkspaceConflictPanel'
import type { WorkspaceContents } from './core/workspaceMerge'
import RecordStatusPanel from './client/pages/RecordStatusPanel'
import { mergeWorkspaceDrafts } from './core/workspaceMerge'
import {
  CLASSIFICATION_LABELS,
  categoryLabel,
  EmptyState,
  GROUP_CLASS,
  incomeCategoryLabel,
  lifecycleLabel,
  PanelHeading,
  ruleId,
  usageModeLabel,
  yen,
} from './client/pages/shared'
import type { WorkspaceDraft, WorkspaceView, WorkspaceSave } from './planning/workspace'
import './index.css'

type Page = 'summary' | 'evidence' | 'folders' | 'guide' | 'costs' | 'balances'
type Provider = 'すべて' | 'Claude Code' | 'Codex'

function App() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [page, setPage] = useState<Page>('summary')
  const [balancesOpened, setBalancesOpened] = useState(false)
  const [balanceNavigation, setBalanceNavigation] = useState<{
    year: number
    request: number
    datasetId?: string
  }>()
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
  const [comparison, setComparison] = useState<WorkspaceComparison | null>(null)
  const [resolvedSaveCount, setResolvedSaveCount] = useState(0)
  const [resolvedSaveMessage, setResolvedSaveMessage] = useState(
    '比較して選んだ内容を保存しました。入力を続けられます。',
  )
  const [impact, setImpact] = useState<WorkspaceImpactState | null>(null)
  const impactRequest = useRef(0)
  const reviewCompletion = useRef<((saved: boolean) => void) | null>(null)

  useEffect(() => {
    setLoadError(null)
    setRuntimeLoading(true)
    if (!isLocalRuntime()) {
      getDashboardData().then(setData)
      setRuntimeLoading(false)
      return
    }
    let cancelled = false
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
    })()
      .catch((error: unknown) => {
        if (!cancelled) {
          setLoadError(
            error instanceof Error && error.message
              ? error.message
              : 'ローカルデータの読込に失敗しました。',
          )
        }
      })
      .finally(() => {
        if (!cancelled) setRuntimeLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [loadAttempt])

  useEffect(() => {
    if (runtime?.restoreRequiresReconnect) {
      autoOnboardingShown.current = true
      return
    }
    if (
      onboarding ||
      runtimeLoading ||
      autoOnboardingShown.current ||
      !data ||
      data.meta.source !== 'local' ||
      !configuration
    )
      return
    const hasAnyCharge =
      configuration.charges.claude === null ||
      configuration.charges.claude > 0 ||
      configuration.charges.codex === null ||
      configuration.charges.codex > 0 ||
      configuration.monthlyCharges.length > 0 ||
      configuration.chargePeriods.some(
        (charge) => charge.amountJpy === null || charge.amountJpy > 0,
      )
    if (!hasAnyCharge || data.meta.sessionCount === 0) {
      autoOnboardingShown.current = true
      setOnboardingStep(data.meta.sessionCount > 0 ? 1 : 0)
      openOnboarding()
    }
  }, [configuration, data, runtimeLoading, onboarding, runtime?.restoreRequiresReconnect])

  function applyWorkspace(next: WorkspaceView, saved = false): void {
    workspaceBase.current = structuredClone({
      revision: next.revision,
      configuration: next.configuration,
      planning: next.planning,
    })
    if (saved && editorBaseRef.current) updateEditorBase(structuredClone(workspaceBase.current))
    setData(next.dashboard)
    setConfiguration(next.configuration)
    setPlanningState(next.planning)
    setDiagnosis(next.diagnosis)
  }

  async function refreshUsageViews(): Promise<void> {
    const sequence = ++refreshSequence.current
    const [nextWorkspace, nextFolders, nextSources] = await Promise.all([
      getWorkspace(),
      getFolders(),
      getHistorySources(),
    ])
    if (sequence !== refreshSequence.current) return
    applyWorkspace(nextWorkspace)
    setFolders(nextFolders.folders)
    setHistorySources(nextSources.sources)
  }
  async function runScan(
    providers: ProviderKey[],
    mode: ScanMode = 'incremental',
  ): Promise<ScanResult> {
    const activeRuntime = runtime ?? (await getRuntime())
    if (!runtime) setRuntime(activeRuntime)
    const result = await scanHistory(activeRuntime.csrfToken, providers, mode)
    await refreshUsageViews()
    return result
  }

  async function withCsrf<T>(action: (csrfToken: string) => Promise<T>): Promise<T> {
    const activeRuntime = runtime ?? (await getRuntime())
    if (!runtime) setRuntime(activeRuntime)
    return action(activeRuntime.csrfToken)
  }

  async function saveHistorySource(source: HistorySourceInput, sourceId?: string): Promise<void> {
    await withCsrf((csrfToken) =>
      sourceId
        ? updateHistorySource(csrfToken, sourceId, source)
        : createHistorySource(csrfToken, source),
    )
    await refreshUsageViews()
  }

  function testSourceVisibility(source: HistorySourceInput): Promise<HistorySourceTestResult> {
    return withCsrf((csrfToken) => testHistorySource(csrfToken, source))
  }

  async function deleteHistorySource(sourceId: string): Promise<void> {
    await withCsrf((csrfToken) => removeHistorySource(csrfToken, sourceId))
    await refreshUsageViews()
  }

  async function storeRetention(
    days: number,
  ): Promise<{ days: number; previousDays?: number; backupFileName?: string }> {
    const activeRuntime = runtime ?? (await getRuntime())
    if (!runtime) setRuntime(activeRuntime)
    const result = await saveRetention(activeRuntime.csrfToken, days)
    // Refetch: the retention box and the summary banner both read from
    // `runtime`. Without this they keep showing the old period, contradicting
    // the success message -- and reopening the box would offer to re-apply the
    // value the user just replaced.
    setRuntime(await getRuntime())
    return result
  }

  async function storeWorkspace(
    nextConfiguration: LocalConfiguration,
    nextPlanning: PlanningSnapshot,
  ): Promise<void> {
    const base = editorBaseRef.current ?? workspaceBase.current
    if (!base) throw new Error('保存元の版を読み込めていません。画面を再読込してください。')
    await commitWorkspace(nextConfiguration, nextPlanning, base)
  }

  async function readComparison(current: WorkspaceComparison): Promise<void> {
    setComparison(current)
    try {
      const latest = await getWorkspace()
      setComparison((value) => (value === current ? { ...current, latest } : value))
    } catch (error) {
      setComparison((value) =>
        value === current
          ? {
              ...current,
              loadError:
                error instanceof Error ? error.message : '最新の内容を読み込めませんでした。',
            }
          : value,
      )
    }
  }

  async function commitWorkspace(
    nextConfiguration: LocalConfiguration,
    nextPlanning: PlanningSnapshot,
    base: WorkspaceDraft,
    previewHash?: string,
  ): Promise<void> {
    const activeRuntime = runtime ?? (await getRuntime())
    if (!runtime) setRuntime(activeRuntime)
    const body = {
      expectedRevision: base.revision,
      configuration: nextConfiguration,
      planning: nextPlanning,
      ...(previewHash ? { previewHash } : {}),
    }
    const previous = pendingSave.current
    const sameRequest =
      previous && JSON.stringify({ ...previous, requestId: undefined }) === JSON.stringify(body)
    const request = sameRequest
      ? previous
      : structuredClone({ ...body, requestId: crypto.randomUUID() })
    pendingSave.current = request
    if (recoveredWorkspace.current) {
      const currentRuntime = await getRuntime()
      if (currentRuntime.datasetId !== runtime?.datasetId)
        throw new Error('接続先のデータが変わっています。再読込してください。')
      const latest = await getWorkspace()
      const desired = { configuration: nextConfiguration, planning: nextPlanning }
      if (mergeWorkspaceDrafts(desired, desired, latest).changes.length === 0) {
        pendingSave.current = null
        recoveredWorkspace.current = false
        applyWorkspace(latest, true)
        return
      }
      if (
        base.revision !== latest.revision ||
        mergeWorkspaceDrafts(base, base, latest).changes.length
      ) {
        setComparison({
          base: structuredClone(base),
          local: request,
          latest,
          requirePreview: Boolean(previewHash),
        })
        throw new Error('控えの保存元から内容が変わっています。最新との比較で確認してください。')
      }
    }
    const attempt = activeRuntime.datasetId
      ? retainWorkspaceAttempt({
          version: 1,
          datasetId: activeRuntime.datasetId,
          createdAt: new Date().toISOString(),
          base: structuredClone(base),
          request,
        })
      : null
    try {
      const next = await saveWorkspace(activeRuntime.csrfToken, request)
      pendingSave.current = null
      refreshSequence.current++
      applyWorkspace(next, true)
      if (attempt) {
        try {
          removeWorkspaceAttempt(window.localStorage, attempt)
        } catch {
          // The server commit succeeded. A retained copy can be reconciled
          // idempotently later; cleanup failure must not undo that success.
        }
      }
      recoveredWorkspace.current = false
    } catch (error) {
      if (
        error instanceof ApiRequestError &&
        error.status === 409 &&
        error.code === 'workspace_conflict'
      ) {
        if (previewHash) setImpact(null)
        await readComparison({
          base: structuredClone(base),
          local: request,
          latest: null,
          requirePreview: Boolean(previewHash),
        })
      }
      throw error
    }
  }

  async function retryWorkspaceAttempt(record: WorkspaceAttempt): Promise<void> {
    const freshRuntime = await getRuntime()
    if (freshRuntime.datasetId !== record.datasetId)
      throw new Error('接続先の資料が変わっています。再読込して確認してください。')
    // Revalidate the retained request before sending its original ID and content.
    const localCopy = retainWorkspaceAttempt(record)
    const retained = localCopy ?? record
    try {
      const next = await saveWorkspace(freshRuntime.csrfToken, retained.request)
      refreshSequence.current++
      applyWorkspace(next)
      if (localCopy) {
        try {
          removeWorkspaceAttempt(window.localStorage, localCopy)
        } catch {
          // Keep a successful save successful even when cleanup is blocked.
        }
      }
    } catch (error) {
      if (
        error instanceof ApiRequestError &&
        error.status === 409 &&
        error.code === 'workspace_conflict'
      ) {
        await readComparison({
          base: retained.base,
          local: retained.request,
          latest: null,
          requirePreview: Boolean(retained.request.previewHash),
        })
        throw new Error(
          '別の保存で内容が変わっています。最新との比較で確認してください。元の要求は保持しています。',
        )
      }
      throw error
    }
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
    setRulesError(null)
    setResolvedSaveMessage('比較して選んだ内容を保存しました。入力を続けられます。')
    setResolvedSaveCount((value) => value + 1)
    try {
      setFolders((await getFolders()).folders)
    } catch {
      setRulesError('選んだ内容は保存しました。フォルダ一覧の再読込に失敗しています。')
    }
  }

  async function loadImpact(current: WorkspaceImpactState): Promise<void> {
    const request = ++impactRequest.current
    setImpact(current)
    try {
      const activeRuntime = runtime ?? (await getRuntime())
      const report = await previewWorkspace(activeRuntime.csrfToken, current.input)
      if (request !== impactRequest.current) return
      setImpact((value) =>
        value === current ? { ...current, report, error: undefined, stale: false } : value,
      )
    } catch (error) {
      if (request !== impactRequest.current) return
      if (
        error instanceof ApiRequestError &&
        error.status === 409 &&
        error.code === 'workspace_conflict'
      ) {
        setImpact(null)
        await readComparison({
          base: current.base,
          local: { ...current.input, requestId: crypto.randomUUID() },
          latest: null,
          requirePreview: true,
        })
      } else
        setImpact((value) =>
          value === current
            ? {
                ...current,
                error: error instanceof Error ? error.message : '影響を確認できませんでした。',
              }
            : value,
        )
    }
  }

  async function openWorkspacePreview(
    nextConfiguration: LocalConfiguration,
    nextPlanning: PlanningSnapshot,
    base = editorBaseRef.current ?? workspaceBase.current,
  ): Promise<void> {
    if (!base) throw new Error('保存元の版を読み込めていません。')
    await loadImpact({
      base: structuredClone(base),
      input: structuredClone({
        expectedRevision: base.revision,
        configuration: nextConfiguration,
        planning: nextPlanning,
      }),
      report: null,
    })
  }

  async function reviewWorkspace(
    nextConfiguration: LocalConfiguration,
    nextPlanning: PlanningSnapshot,
  ): Promise<boolean> {
    const completed = new Promise<boolean>((resolve) => {
      reviewCompletion.current = resolve
    })
    try {
      await openWorkspacePreview(nextConfiguration, nextPlanning)
    } catch (error) {
      reviewCompletion.current?.(false)
      reviewCompletion.current = null
      throw error
    }
    return completed
  }

  async function saveImpact(): Promise<void> {
    if (!impact?.report || impact.stale) return
    try {
      await commitWorkspace(
        impact.input.configuration,
        impact.input.planning,
        impact.base,
        impact.report.previewHash,
      )
    } catch (error) {
      if (error instanceof ApiRequestError && error.code === 'preview_changed')
        setImpact((current) => (current ? { ...current, stale: true, error: error.message } : null))
      throw error
    }
    setImpact(null)
    setRulesError(null)
    setResolvedSaveMessage('変更の影響を確認した内容を保存しました。入力を続けられます。')
    setResolvedSaveCount((value) => value + 1)
    reviewCompletion.current?.(true)
    reviewCompletion.current = null
    try {
      setFolders((await getFolders()).folders)
    } catch {
      setRulesError('変更は保存しました。フォルダ一覧の再読込に失敗しています。')
    }
  }

  async function storeRules(rules: ProjectRuleRecord[]): Promise<void> {
    setRulesBusy(true)
    try {
      if (!configuration) throw new Error('料金設定を読み込めていません。')
      await openWorkspacePreview(configuration, { ...planning, projectRules: rules })
      setRulesError(null)
    } catch (error) {
      const detail = error instanceof Error ? error.message : '保存できませんでした。'
      setRulesError(detail)
    } finally {
      setRulesBusy(false)
    }
  }
  async function reclassifyAllocation(
    row: Allocation,
    classification: ProjectClassification,
  ): Promise<void> {
    if (!row.projectKey || !row.monthKey) return
    const effectiveFrom = `${row.monthKey}-01`
    const id = ruleId(row.projectKey, effectiveFrom)
    const existing = planning.projectRules.find((rule) => rule.id === id)
    const others = planning.projectRules.filter((rule) => rule.id !== id)

    await storeRules([
      ...others,
      {
        id,
        projectKey: row.projectKey,
        effectiveFrom,
        effectiveTo: existing?.effectiveTo,
        // `existing` is looked up by the id derived from this row's
        // (projectKey, month), which only matches a rule that already starts
        // on that exact day. The rule that actually governs this row's
        // product may have a different id (e.g. it started earlier and
        // covers this month by range). Prefer the row's own resolved
        // taxUnitId -- what dashboard.ts says currently governs this
        // allocation -- and only fall back to `existing` when the row
        // itself carries no product (nothing to inherit from).
        taxUnitId: row.taxUnitId ?? existing?.taxUnitId,
        classification,
        reason: '配賦明細から変更',
      },
    ])
  }

  const allocations = useMemo(() => {
    if (!data) return []
    return data.allocations.filter(
      (row) =>
        (page !== 'summary' || belongsToYear(row, planning.profile.taxYear)) &&
        (provider === 'すべて' || row.provider === provider) &&
        (product === 'すべて' || row.product === product),
    )
  }, [data, product, provider, page, planning.profile.taxYear])

  if (loadError) {
    return (
      <main className="loading-shell" aria-busy="false">
        <div className="radar-mark">D</div>
        <h1>ローカルデータを読み込めませんでした</h1>
        <p role="alert">{loadError}</p>
        <p>DevTaxが起動していることを確認して、もう一度読み込んでください。</p>
        <button
          type="button"
          className="primary-button"
          onClick={() => setLoadAttempt((attempt) => attempt + 1)}
        >
          もう一度読み込む
        </button>
      </main>
    )
  }

  if (!data) {
    return (
      <main className="loading-shell" aria-busy="true">
        <div className="radar-mark">D</div>
        <p>ローカルの利用履歴を集計しています…</p>
      </main>
    )
  }

  const annual = annualAiView(data, planning.profile.taxYear)
  const representativeTotals = allocations.reduce(
    (sum, row) => {
      sum[row.group] += row.amount
      return sum
    },
    { current: 0, future: 0, review: 0 } as Record<TaxGroup, number>,
  )
  const filteredTotals =
    provider === 'すべて' && product === 'すべて'
      ? annual.months.reduce(
          (sum, month) => ({
            current: sum.current + month.current,
            future: sum.future + month.future,
            review: sum.review + month.review,
          }),
          { current: 0, future: 0, review: 0 },
        )
      : representativeTotals

  const products = ['すべて', ...new Set(data.allocations.map((row) => row.product))]
  const unassignedFolderCount = folders.filter((folder) => folder.unassignedSessionCount > 0).length
  const filteredMonths = annual.months.map((month) => {
    if (provider === 'すべて' && product === 'すべて') return month
    const rows = allocations.filter((row) => row.month === month.label)
    return {
      ...month,
      current: rows.reduce((sum, row) => sum + (row.group === 'current' ? row.amount : 0), 0),
      future: rows.reduce((sum, row) => sum + (row.group === 'future' ? row.amount : 0), 0),
      review: rows.reduce((sum, row) => sum + (row.group === 'review' ? row.amount : 0), 0),
    }
  })

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#top" aria-label="DevTax ホーム">
          <span className="radar-mark">D</span>
          <span>
            <strong>DevTax</strong>
            <small>AI原価を、説明できる数字に。</small>
          </span>
        </a>

        <nav aria-label="メインナビゲーション">
          <button
            className={page === 'costs' ? 'nav-item active' : 'nav-item'}
            onClick={() => setPage('costs')}
          >
            <span aria-hidden="true">01</span>
            <span>
              支払と配分<small>全費用の原額・期間・対応先</small>
            </span>
          </button>
          <button
            className={page === 'balances' ? 'nav-item active' : 'nav-item'}
            onClick={() => {
              setBalancesOpened(true)
              setPage('balances')
            }}
          >
            <span aria-hidden="true">02</span>
            <span>
              残高と繰越し<small>期首・増減・期末の記録</small>
            </span>
          </button>
          <button
            className={page === 'summary' ? 'nav-item active' : 'nav-item'}
            onClick={() => setPage('summary')}
          >
            <span aria-hidden="true">⌁</span>
            <span>
              今年どうなる？<small>対象年の費用と確認事項</small>
            </span>
          </button>
          <button
            className={page === 'evidence' ? 'nav-item active' : 'nav-item'}
            onClick={() => setPage('evidence')}
          >
            <span aria-hidden="true">≡</span>
            <span>
              なぜそうなる？<small>配賦と根拠ログ</small>
            </span>
          </button>
          <button
            className={page === 'folders' ? 'nav-item active' : 'nav-item'}
            onClick={() => setPage('folders')}
          >
            <span aria-hidden="true">▤</span>
            <span>
              フォルダの割当
              <small>履歴と制作物を結ぶ</small>
            </span>
          </button>
          <button
            className={page === 'guide' ? 'nav-item active' : 'nav-item'}
            onClick={() => setPage('guide')}
          >
            <span aria-hidden="true">?</span>
            <span>
              税務QA<small>言葉と境界を知る</small>
            </span>
          </button>
        </nav>

        <div className="sidebar-status">
          <div className="status-line">
            <span className="pulse" />
            <span>{data.meta.source === 'local' ? 'ローカル接続中' : '合成データデモ'}</span>
          </div>
          <strong>{data.meta.sessionCount.toLocaleString()}件の利用記録</strong>
          <small>最終走査 {data.meta.lastSynced}</small>
          <button
            className="quiet-button"
            onClick={() => {
              setOnboardingStep(0)
              openOnboarding()
            }}
          >
            設定を確認
          </button>
        </div>
        <p className="local-note">
          {data.meta.source === 'local'
            ? '通常集計は履歴本文を保存・外部送信しません'
            : '実在する履歴・請求額・パスは含みません'}
        </p>
      </aside>

      <div className="workspace" id="top">
        <header className="topbar">
          <div>
            <span className="eyebrow">{page === 'costs' ? '計画に設定した年' : '対象年'}</span>
            <strong>{planning.profile.taxYear}年</strong>
            <span className="profile-pill">
              {incomeCategoryLabel(planning.profile.incomeCategory)}
            </span>
          </div>
          <div className="top-actions">
            <span className={data.meta.source === 'local' ? 'source-badge live' : 'source-badge'}>
              {data.meta.source === 'local' ? '実データ' : 'デモデータ'}
            </span>
            {data.meta.source !== 'demo' && (
              <button
                className="primary-button"
                onClick={() => {
                  setOnboardingStep(3)
                  openOnboarding()
                }}
              >
                ＋ 月次確認
              </button>
            )}
          </div>
        </header>

        <main className="content">
          {runtime?.datasetId && data.meta.source === 'local' && (
            <WorkspaceAttemptPanel
              key={runtime.datasetId}
              datasetId={runtime.datasetId}
              disabled={onboarding || rulesBusy || Boolean(comparison) || Boolean(impact)}
              onRetry={retryWorkspaceAttempt}
            />
          )}
          {runtime?.restoreRequiresReconnect && (
            <RestoreSourcesPanel
              onComplete={() =>
                setRuntime((current) => current && { ...current, restoreRequiresReconnect: false })
              }
            />
          )}
          {Boolean(data.unknownCharges?.length) && (
            <section className="panel" aria-label="未確認のAI請求額">
              <strong>請求額が未確認のAI契約が{data.unknownCharges!.length}件あります</strong>
              <p>
                AIの金額集計は確認済みの請求分です。未確認分の原額・期間・理由は「支払と配分」で確認できます。
              </p>
              <ul>
                {data.unknownCharges!.map((charge) => (
                  <li key={charge.id}>
                    {charge.provider === 'claude' ? 'Claude Code' : 'Codex'}：
                    {charge.serviceStartedOn}～{charge.serviceEndedOn} / {charge.reason}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {data.meta.source === 'demo' && (
            <section className="public-demo-banner" aria-labelledby="public-demo-title">
              <span className="demo-shield" aria-hidden="true">
                ✓
              </span>
              <div className="demo-banner-copy">
                <span className="demo-label">公開デモ・合成データ</span>
                <strong id="public-demo-title">
                  AIサブスク費用を、税務説明できるプロダクト原価へ。
                </strong>
                <p>
                  この画面に実在の履歴・請求額・パスは含まれません。 GitHub版はClaude
                  Code／Codexの履歴をPC内だけで集計します。
                </p>
              </div>
              <button
                className="demo-cta"
                onClick={() => setPage(page === 'summary' ? 'evidence' : 'summary')}
              >
                {page === 'summary' ? '月次集計の根拠を辿る' : '年間サマリーへ戻る'}
                <span aria-hidden="true">{page === 'summary' ? ' →' : ' ←'}</span>
              </button>
            </section>
          )}
          <section className="page-heading">
            <div>
              <span className="eyebrow">
                {page === 'balances'
                  ? '今年の増減と翌年への引継ぎ'
                  : page === 'costs'
                    ? '支払から費用の行き先へ'
                    : page === 'summary'
                      ? '年間の見通し'
                      : page === 'evidence'
                        ? '数字の根拠'
                        : page === 'folders'
                          ? '履歴と制作物の対応'
                          : 'やさしい税務ガイド'}
              </span>
              <h1>
                {page === 'balances'
                  ? '残高と繰越し'
                  : page === 'costs'
                    ? '支払と配分'
                    : page === 'summary'
                      ? '今年どうなる？'
                      : page === 'evidence'
                        ? 'なぜそうなる？'
                        : page === 'folders'
                          ? 'フォルダの割当'
                          : '税務の言葉を知る'}
              </h1>
              <p>
                {page === 'balances'
                  ? '制作物に関係する種類別残高を記録し、今年の増減と期末を確認します。'
                  : page === 'costs'
                    ? 'AI料金・設備・自宅費用・直接費を同じ資料で確認します。不明な費用基礎も原額と理由を残します。'
                    : page === 'summary'
                      ? '対象年の全費用、計算できた範囲と未確定の扱いを確認します。原額から今年・翌年への説明をつなぎます。'
                      : page === 'evidence'
                        ? '月額料金からAIサービス・月・作っているものまで、数字の由来を辿れます。'
                        : page === 'folders'
                          ? 'AI履歴の作業フォルダを、制作物と作業内容へ結び付けます。ここで割り当てた内容が配賦額の分類になります。'
                          : '取得価額や資本的支出を、1文の結論と具体例から確認できます。'}
              </p>
            </div>
            {(page === 'summary' || page === 'evidence') && (
              <div className="filters" aria-label="表示フィルター">
                <label>
                  <span>AIサービス</span>
                  <select
                    value={provider}
                    onChange={(event) => setProvider(event.target.value as Provider)}
                  >
                    <option>すべて</option>
                    <option>Claude Code</option>
                    <option>Codex</option>
                  </select>
                </label>
                <label>
                  <span>作っているもの</span>
                  <select value={product} onChange={(event) => setProduct(event.target.value)}>
                    {products.map((item) => (
                      <option key={item}>{item}</option>
                    ))}
                  </select>
                </label>
              </div>
            )}
          </section>

          {balancesOpened && (
            <div hidden={page !== 'balances'}>
              <BalancesPage
                onReviewAnswer={(context) => {
                  setOnboardingStep(context.answer.kind === 'fact' ? 2 : 3)
                  openOnboarding(context)
                }}
                navigation={balanceNavigation}
                key={runtime?.datasetId}
                datasetId={runtime?.datasetId}
                planning={planning}
                configuration={configuration}
                local={data.meta.source === 'local'}
                onManageUnits={() => {
                  setOnboardingStep(2)
                  openOnboarding()
                }}
              />
            </div>
          )}
          {page === 'balances' ? null : page === 'costs' ? (
            <CostsPage
              initial={data.costProjection}
              evidence={planning.evidence}
              local={data.meta.source === 'local'}
              onEdit={() => {
                setOnboardingStep(3)
                openOnboarding()
              }}
            />
          ) : page === 'summary' ? (
            <SummaryPage
              key={runtime?.datasetId}
              onOpenBalances={() => {
                setBalanceNavigation((previous) => ({
                  year: planning.profile.taxYear,
                  request: (previous?.request ?? 0) + 1,
                  datasetId: runtime?.datasetId,
                }))
                setBalancesOpened(true)
                setPage('balances')
              }}
              data={data}
              planning={planning}
              diagnosis={diagnosis}
              months={filteredMonths}
              undatedMonths={annual.undatedMonths}
              onOpenCosts={() => setPage('costs')}
              totals={filteredTotals}
              onOpenEvidence={(allocation) => {
                setSelectedAllocation(allocation)
                setPage('evidence')
              }}
              onOpenGuide={() => setPage('guide')}
              onOpenOnboarding={() => {
                setOnboardingStep(0)
                openOnboarding()
              }}
              retention={runtime?.retention ?? null}
            />
          ) : page === 'evidence' ? (
            <EvidencePage
              data={data}
              planning={planning}
              diagnosis={diagnosis}
              allocations={allocations}
              selected={selectedAllocation}
              onSelect={setSelectedAllocation}
              busy={rulesBusy}
              error={rulesError}
              onReclassify={reclassifyAllocation}
            />
          ) : page === 'folders' ? (
            <FolderAssignmentPage
              folders={folders}
              planning={planning}
              busy={rulesBusy}
              error={rulesError}
              onSaveRules={storeRules}
            />
          ) : (
            <TaxGuidePage />
          )}
        </main>
      </div>

      {onboarding && (
        <Onboarding
          consultation={consultationContext}
          workspaceBase={editorBase ?? undefined}
          onRestoreWorkspaceBase={async (base) => {
            const currentRuntime = await getRuntime()
            if (!runtime?.datasetId || currentRuntime.datasetId !== runtime.datasetId)
              throw new Error('接続先のデータが変わっています。再読込してください。')
            recoveredWorkspace.current = true
            updateEditorBase(structuredClone(base))
          }}
          step={onboardingStep}
          data={data}
          runtime={runtime}
          runtimeLoading={runtimeLoading}
          historySources={historySources}
          configuration={editorBase?.configuration ?? configuration}
          planning={editorBase?.planning ?? planning}
          unassignedFolderCount={unassignedFolderCount}
          onStep={setOnboardingStep}
          onScan={runScan}
          onSaveHistorySource={saveHistorySource}
          onTestHistorySource={testSourceVisibility}
          onRemoveHistorySource={deleteHistorySource}
          onSaveWorkspace={storeWorkspace}
          onPreviewWorkspace={openWorkspacePreview}
          onReviewWorkspace={reviewWorkspace}
          suspended={comparison !== null || impact !== null}
          resolvedSaveCount={resolvedSaveCount}
          resolvedSaveMessage={resolvedSaveMessage}
          onSaveRetention={storeRetention}
          onClose={() => {
            updateEditorBase(null)
            setOnboarding(false)
            setOnboardingStep(0)
          }}
          onSaved={() => {
            if (unassignedFolderCount > 0) setPage('folders')
          }}
        />
      )}
      {impact && (
        <WorkspaceImpactPanel
          key={impact.report?.previewHash ?? 'loading'}
          impact={impact}
          onSave={saveImpact}
          onRefresh={() =>
            void loadImpact({ ...impact, report: null, error: undefined, stale: false })
          }
          onCancel={() => {
            impactRequest.current++
            setImpact(null)
            reviewCompletion.current?.(false)
            reviewCompletion.current = null
          }}
        />
      )}
      {comparison && (
        <WorkspaceConflictPanel
          key={`${comparison.local.requestId}:${comparison.latest?.revision ?? 'loading'}`}
          comparison={comparison}
          onSave={resolveComparison}
          onCancel={() => {
            setComparison(null)
            reviewCompletion.current?.(false)
            reviewCompletion.current = null
          }}
          onRetry={() => void readComparison({ ...comparison, loadError: undefined })}
        />
      )}
    </div>
  )
}

function SummaryPage({
  onOpenBalances,
  data,
  undatedMonths,
  onOpenCosts,
  planning,
  diagnosis,
  months,
  totals,
  onOpenEvidence,
  onOpenGuide,
  onOpenOnboarding,
  retention,
}: {
  onOpenBalances: () => void
  data: DashboardData
  planning: PlanningSnapshot
  diagnosis: Diagnosis
  undatedMonths: number
  onOpenCosts: () => void
  months: DashboardData['months']
  totals: Record<TaxGroup, number>
  onOpenEvidence: (allocation: Allocation) => void
  onOpenGuide: () => void
  onOpenOnboarding: () => void
  retention: RuntimeData['retention'] | null
}) {
  const annualTotal = totals.current + totals.future + totals.review

  const maxMonth = Math.max(
    ...months.map((month) => month.current + month.future + month.review),
    1,
  )

  return (
    <>
      {retention &&
        retention.claude.autoDelete.kind === 'configured' &&
        (retention.claude.alreadyLosing ||
          (retention.claude.daysUntilNextLoss ?? Infinity) <= 30) && (
          <div className="retention-banner" role="status">
            <strong>
              {retention.claude.alreadyLosing
                ? 'Claude Codeの古い履歴が、すでに削除されている可能性があります'
                : `Claude Codeの最も古い履歴が、あと${retention.claude.daysUntilNextLoss}日で削除される見込みです`}
            </strong>
            <span>
              削除された履歴は復元できません。保持する日数は「はじめの準備」の最初のステップで変更できます。
            </span>
            <button className="text-button" onClick={onOpenOnboarding}>
              はじめの準備を開く →
            </button>
          </div>
        )}
      <AnnualOverview
        year={planning.profile.taxYear}
        projection={data.costProjection}
        onOpenCosts={onOpenCosts}
      />
      <AnnualReviewSummary
        year={planning.profile.taxYear}
        local={data.meta.source === 'local'}
        onOpenBalances={onOpenBalances}
      />
      <RecordStatusPanel
        planning={planning}
        sessionCount={data.meta.sessionCount}
        onEdit={onOpenOnboarding}
      />
      <section className="diagnosis-grid" aria-label="現在地診断と次の行動">
        <article className="panel position-panel">
          <PanelHeading
            title="現在地診断"
            subtitle="登録した事実から生成。税務判断を確定するものではありません"
          />
          <ul className="position-list">
            {diagnosis.currentPosition.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <div className="usage-overview">
            {planning.taxUnits.slice(0, 3).map((unit) => (
              <div key={unit.id}>
                <strong>{unit.name}</strong>
                <span>{usageModeLabel(unit.usageMode)}</span>
                <small>{lifecycleLabel(unit.lifecycleStatus)}</small>
              </div>
            ))}
          </div>
        </article>
        <article className="panel action-panel">
          <PanelHeading
            title="次にやること"
            subtitle="税額ではなく、実態と証拠を整える順番です"
            trailing={<span className="action-count">不足 {diagnosis.missingFacts.length}件</span>}
          />
          <ol className="action-list">
            {diagnosis.immediateActions.slice(0, 3).map((action) => (
              <li key={action.id}>
                <span className={`priority-dot ${action.priority}`} aria-hidden="true" />
                <div>
                  <strong>{action.title}</strong>
                  <p>{action.reason}</p>
                </div>
              </li>
            ))}
          </ol>
          {diagnosis.eventTriggeredActions[0] && (
            <details className="event-action">
              <summary>イベントが起きたら行うこと</summary>
              <p>
                <strong>{diagnosis.eventTriggeredActions[0].title}</strong>
                <br />
                {diagnosis.eventTriggeredActions[0].reason}
              </p>
            </details>
          )}
        </article>
      </section>
      <h2>{planning.profile.taxYear}年のAI料金の分類内訳</h2>
      <p>
        以下は選択したAIサービス・制作物の、確認済み料金の分類です。全費用の税務計算や採用済み残高ではありません。
      </p>
      {undatedMonths > 0 && (
        <p role="status">
          対象年を確認できない月が{undatedMonths}件あるため、この年の集計には含めていません。
        </p>
      )}
      <section className="summary-grid" aria-label="対象年のAI分類内訳">
        {(['current', 'future', 'review'] as TaxGroup[]).map((group) => (
          <article className={`metric-card ${GROUP_CLASS[group]}`} key={group}>
            <div className="metric-top">
              <span className="metric-icon" aria-hidden="true">
                {group === 'current' ? '↘' : group === 'future' ? '◇' : '!'}
              </span>
              <span className="metric-kicker">
                {group === 'current' ? '今年' : group === 'future' ? 'これから' : 'あとで確認'}
              </span>
            </div>
            <h2>
              {group === 'current'
                ? '当年処理に分類したAI料金'
                : group === 'future'
                  ? '開発原価等に分類したAI料金'
                  : '私用・未分類・配分未算定等'}
            </h2>
            <strong className="metric-value">{yen.format(totals[group])}</strong>
            <div className="metric-foot">
              <span>{annualTotal ? Math.round((totals[group] / annualTotal) * 100) : 0}%</span>
              <span>
                {group === 'current'
                  ? '当年の処理候補'
                  : group === 'future'
                    ? '開発中・未供用'
                    : '未分類・私用'}
              </span>
            </div>
          </article>
        ))}
      </section>

      <ol className="value-flow" aria-label="DevTaxの処理フロー">
        <li>
          <span>01</span>
          <div>
            <strong>利用履歴を読む</strong>
            <small>Claude Code・Codex</small>
          </div>
        </li>
        <li>
          <span>02</span>
          <div>
            <strong>定額料金を配賦</strong>
            <small>加重トークン・プロダクト</small>
          </div>
        </li>
        <li>
          <span>03</span>
          <div>
            <strong>税務候補と根拠を残す</strong>
            <small>通常経費・取得価額・要確認</small>
          </div>
        </li>
      </ol>

      <div className="main-grid">
        <section className="panel chart-panel">
          <PanelHeading
            title="対象年のAI料金の行き先"
            subtitle="AIサービスごとに配賦した月額の積み上げ"
            trailing={
              <span className="confidence">
                対応付け済み {data.meta.mappedRate}% ・ 分類済み {data.meta.classifiedRate}%
              </span>
            }
          />
          {months.length === 0 ? (
            <EmptyState
              message="対象年に対応するAI料金の集計がありません。支払・契約期間と履歴の対象月を確認してください。"
              action={
                <button className="primary-button" onClick={onOpenOnboarding}>
                  はじめの準備を開く
                </button>
              }
            />
          ) : (
            <>
              <div className="chart-legend" aria-hidden="true">
                <span>
                  <i className="dot coral" />
                  当年処理への分類
                </span>
                <span>
                  <i className="dot indigo" />
                  開発原価等への分類
                </span>
                <span>
                  <i className="dot amber" />
                  要確認
                </span>
              </div>
              <div
                className="bar-chart"
                role="img"
                aria-label={`${months[0].label}から${months.at(-1)?.label}までの費用配賦積み上げグラフ`}
              >
                <div className="axis-label top">{yen.format(maxMonth)}</div>
                <div className="axis-label middle">{yen.format(Math.round(maxMonth / 2))}</div>
                {months.map((month) => (
                  <div className="bar-column" key={month.label}>
                    <div className="bar-value">
                      {yen.format(month.current + month.future + month.review)}
                    </div>
                    <div className="bar-track">
                      {(['review', 'future', 'current'] as TaxGroup[]).map((group) => (
                        <div
                          key={group}
                          className={`bar-part ${GROUP_CLASS[group]}`}
                          style={{ height: `${(month[group] / maxMonth) * 100}%` }}
                          title={`${{ current: '当年処理への分類', future: '開発原価等への分類', review: '私用・未分類等' }[group]} ${yen.format(month[group])}`}
                        />
                      ))}
                    </div>
                    <strong>
                      {month.label}
                      {month.unknownChargeIds?.length ? ' / 請求額未確認あり' : ''}
                    </strong>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>

        <section className="panel guide-panel">
          <PanelHeading
            title="入力・履歴の確認事項"
            subtitle="保存した入力と取り込んだ履歴からの案内です。確認完了の評価ではありません。"
          />
          <ul className="guide-list">
            {data.guidance.map((item) => (
              <li key={item.title}>
                <span className={`guide-symbol ${item.severity}`} aria-hidden="true">
                  {item.severity === 'warning' ? '!' : '✓'}
                </span>
                <div>
                  <strong>{item.title}</strong>
                  <p>{item.description}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className="panel alerts-panel">
        <PanelHeading
          title="AI分類額の参考境界"
          subtitle="全期間のAI分類額による参考表示です。対象年の全費用・採用済み取得価額の判定は未接続です。"
          trailing={
            <button className="text-button" onClick={onOpenGuide}>
              判定ルールを見る →
            </button>
          }
        />
        <div className="alert-list">
          {data.boundaries.length === 0 ? (
            <EmptyState
              message={
                data.unknownCharges?.length
                  ? '未確認のAI請求額があるため、金額境界の表示を保留しています。請求額を確認すると再計算します。'
                  : '金額境界を確認できる資産がまだありません。フォルダの割当で制作物を決めて分類すると、10万円などの境界に近づいた資産がここに出ます。'
              }
            />
          ) : (
            data.boundaries.map((boundary) => {
              const pct = Math.min((boundary.amount / boundary.threshold) * 100, 100)
              const allocation = data.allocations.find((row) => row.asset === boundary.asset)
              return (
                <button
                  className="boundary-row"
                  key={boundary.asset}
                  onClick={() => allocation && onOpenEvidence(allocation)}
                >
                  <div className="asset-monogram">{boundary.product.slice(-1)}</div>
                  <div className="boundary-name">
                    <strong>{boundary.asset}</strong>
                    <span>{boundary.kind}</span>
                  </div>
                  <div className="progress-wrap">
                    <div className="progress-meta">
                      <span>{yen.format(boundary.amount)}</span>
                      <span>{boundary.thresholdLabel}</span>
                    </div>
                    <div className="progress">
                      <i style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                  <span className={`boundary-status ${boundary.tone}`}>{boundary.status}</span>
                  <span aria-hidden="true">›</span>
                </button>
              )
            })
          )}
        </div>
      </section>

      <footer className="tax-disclaimer">
        <span aria-hidden="true">ⓘ</span>
        本画面は税務処理の候補と確認事項を示すもので、税務判断を確定するものではありません。
      </footer>
    </>
  )
}

function EvidencePage({
  data,
  planning,
  diagnosis,
  allocations,
  selected,
  onSelect,
  busy,
  error,
  onReclassify,
}: {
  data: DashboardData
  planning: PlanningSnapshot
  diagnosis: Diagnosis
  allocations: Allocation[]
  selected: Allocation | null
  onSelect: (row: Allocation | null) => void
  busy: boolean
  error: string | null
  onReclassify: (row: Allocation, classification: ProjectClassification) => Promise<void>
}) {
  const active = selected ?? allocations[0] ?? null
  const asset = data.assets.find((item) => item.name === active?.asset) ?? data.assets[0]

  async function downloadLedger() {
    const blob =
      data.meta.source === 'local'
        ? await getPlanningExport('markdown')
        : new Blob(
            [
              `# DevTax 相談用出力\n\n年分: ${planning.profile.taxYear}\n\n` +
                demoLedger.byTaxUnit
                  .map(
                    (item) => `- ${item.name}: ${yen.format(item.amountJpy)} / ${item.candidate}`,
                  )
                  .join('\n'),
            ],
            { type: 'text/markdown' },
          )
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `devtax-${planning.profile.taxYear}.md`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <>
      {error && (
        <div className="setup-notice error" role="alert" aria-live="polite">
          <span>!</span>
          {error}
        </div>
      )}
      <section className="panel evidence-table-panel">
        <PanelHeading
          title="配賦明細"
          subtitle={`${allocations.length}件 · 月額料金をAIサービス内の利用比率で配賦`}
          trailing={
            <button className="export-button" onClick={downloadLedger}>
              相談用Markdown
            </button>
          }
        />
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>月</th>
                <th>AIサービス</th>
                <th>作っているもの</th>
                <th>費用をまとめる単位</th>
                <th>工程</th>
                <th className="number">利用割合</th>
                <th className="number">配賦額</th>
                <th>税務候補</th>
              </tr>
            </thead>
            <tbody>
              {allocations.length === 0 && (
                <tr>
                  <td colSpan={8}>
                    <EmptyState message="表示できる配賦明細がありません。履歴を走査し、フォルダを制作物へ割り当てると、月ごとの内訳がここに出ます。" />
                  </td>
                </tr>
              )}
              {allocations.map((row) => (
                <tr key={row.id} className={active?.id === row.id ? 'selected-row' : ''}>
                  <td>
                    <button
                      className="row-open-button"
                      onClick={() => onSelect(row)}
                      aria-label={`${row.month} ${row.provider} ${row.product}、配賦額${yen.format(row.amount)}の根拠を表示`}
                    >
                      {row.month}
                    </button>
                  </td>
                  <td>
                    <span className={`provider-logo ${row.provider === 'Codex' ? 'codex' : ''}`}>
                      {row.provider === 'Codex' ? 'O' : 'C'}
                    </span>
                    {row.provider}
                  </td>
                  <td>
                    <strong>{row.product}</strong>
                  </td>
                  <td>{row.asset}</td>
                  <td>{row.stage}</td>
                  <td className="number">
                    {row.usageRate === null ? '未算定' : `${row.usageRate}%`}
                  </td>
                  <td className="number">
                    <strong>{yen.format(row.amount)}</strong>
                  </td>
                  <td>
                    {row.projectKey && row.monthKey ? (
                      <select
                        value={row.classification ?? 'unclassified'}
                        disabled={busy}
                        onChange={(event) =>
                          onReclassify(row, event.target.value as ProjectClassification)
                        }
                        aria-label={`${row.month} ${row.product}の分類を変更`}
                      >
                        {Object.entries(CLASSIFICATION_LABELS).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className={`tax-chip ${GROUP_CLASS[row.group]}`}>
                        {row.taxCandidate}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {active && asset && (
        <div className="evidence-grid">
          <section className="panel asset-card">
            <PanelHeading title="資産別の累積原価" subtitle={`${asset.product} / ${asset.name}`} />
            <div className="asset-total">
              <span>累積取得価額候補</span>
              <strong>{yen.format(asset.total)}</strong>
              <span className="status-chip">{asset.inService ? '供用中' : '開発中・未供用'}</span>
            </div>
            <dl className="cost-breakdown">
              <div>
                <dt>AIサブスク配賦額</dt>
                <dd>{yen.format(asset.aiCost)}</dd>
              </div>
              <div>
                <dt>外注費</dt>
                <dd>{yen.format(asset.outsource)}</dd>
              </div>
              <div>
                <dt>その他直接費</dt>
                <dd>{yen.format(asset.other)}</dd>
              </div>
              <div className="total-line">
                <dt>翌年以後へ残る見込</dt>
                <dd>{yen.format(asset.futureBalance)}</dd>
              </div>
            </dl>
            <p className="scope-warning">
              このカードの金額はAIサブスクの配賦額だけです。入力済みの外注費・その他直接費・設備の償却費は、費用台帳とMarkdown出力には出ますが、この金額にはまだ合算していません。10万円等の境界は、資産全体の取得価額で確認してください。
            </p>
            <div className="asset-progress">
              <div>
                <span>10万円境界まで</span>
                <strong>{yen.format(Math.max(100000 - asset.total, 0))}</strong>
              </div>
              <div className="progress">
                <i style={{ width: `${Math.min(asset.total / 1000, 100)}%` }} />
              </div>
            </div>
          </section>

          <section className="panel decision-card">
            <PanelHeading title="判定説明" subtitle="現在の登録事実に基づく候補" />
            <div className="decision-head">
              <span className="decision-icon">◇</span>
              <div>
                <small>判定候補</small>
                <strong>{active.taxCandidate}</strong>
              </div>
              <span className="confidence">信頼度 {active.confidence}</span>
            </div>
            <dl className="decision-list">
              <div>
                <dt>適用ルール</dt>
                <dd>{active.rule}</dd>
              </div>
              <div>
                <dt>根拠</dt>
                <dd>{active.reason}</dd>
              </div>
              <div>
                <dt>不足情報</dt>
                <dd className="missing">{active.missing}</dd>
              </div>
            </dl>
            <p className="decision-next">
              この候補の確認・修正は、上の「設定を確認」から事実と証拠を更新すると再計算されます。
            </p>
          </section>

          <section className="panel log-card">
            <PanelHeading title="根拠ログ" subtitle="本文を保存せずメタデータだけを表示" />
            <div className="session-summary">
              <span className={`provider-logo ${active.provider === 'Codex' ? 'codex' : ''}`}>
                {active.provider === 'Codex' ? 'O' : 'C'}
              </span>
              <div>
                <strong>
                  {active.provider} · {active.session.date}
                </strong>
                <small>{active.session.id}</small>
              </div>
              <span className="privacy-chip">本文なし</span>
            </div>
            <dl className="log-grid">
              <div>
                <dt>作業フォルダ</dt>
                <dd>{active.session.folder}</dd>
              </div>
              <div>
                <dt>Git branch</dt>
                <dd>{active.session.branch}</dd>
              </div>
              <div>
                <dt>Model</dt>
                <dd>{active.session.model}</dd>
              </div>
              <div>
                <dt>加重トークン</dt>
                <dd>
                  {active.session.tokens === null
                    ? '対象外（支払の確認行）'
                    : active.session.tokens.toLocaleString()}
                </dd>
              </div>
              <div>
                <dt>分類ルール</dt>
                <dd>{active.session.classification}</dd>
              </div>
              <div>
                <dt>手動修正</dt>
                <dd>{active.session.manualEdit}</dd>
              </div>
            </dl>
          </section>
        </div>
      )}

      <PlanningEvidenceSections
        planning={planning}
        costProjection={data.costProjection}
        diagnosis={diagnosis}
      />
    </>
  )
}

function PlanningEvidenceSections({
  planning,
  costProjection,
  diagnosis,
}: {
  planning: PlanningSnapshot
  costProjection: DashboardData['costProjection']
  diagnosis: Diagnosis
}) {
  return (
    <section className="planning-ledger" aria-labelledby="planning-ledger-title">
      <div className="planning-ledger-heading">
        <span className="eyebrow">記録した内容</span>
        <h2 id="planning-ledger-title">制作物・設備・自宅費用・証拠</h2>
        <p>
          金額の結論だけでなく、誰が使うか、いつ正式利用したか、どの計算式を使ったかまで辿れます。
        </p>
      </div>
      <div className="ledger-card-grid">
        <article className="panel ledger-card">
          <PanelHeading
            title="制作物と改良計画"
            subtitle={`${planning.taxUnits.length}件 · 自分利用と公開を別イベントで管理`}
          />
          <ul className="compact-record-list">
            {planning.taxUnits.map((unit) => (
              <li key={unit.id}>
                <div>
                  <strong>{unit.name}</strong>
                  <span>{usageModeLabel(unit.usageMode)}</span>
                </div>
                <small>{lifecycleLabel(unit.lifecycleStatus)}</small>
              </li>
            ))}
          </ul>
          <p className="ledger-footnote">期間付き分類ルール {planning.projectRules.length}件</p>
        </article>
        <article className="panel ledger-card">
          <PanelHeading
            title="パソコン・GPU機器等"
            subtitle={`${planning.equipment.length}件 · 業務割合と制作物割合を分離`}
          />
          <ul className="compact-record-list">
            {planning.equipment.map((item) => (
              <li key={item.id}>
                <div>
                  <strong>{item.name}</strong>
                  <span>
                    {item.acquisitionCostJpy === null
                      ? `購入額不明：${item.unknownAmountReason}`
                      : yen.format(item.acquisitionCostJpy)}{' '}
                    · {item.role}
                  </span>
                </div>
                <small>
                  業務 {Math.round(item.businessUseRatio * 100)}% / 制作物{' '}
                  {Math.round(item.projectAllocationRatio * 100)}%
                </small>
              </li>
            ))}
          </ul>
        </article>
        <article className="panel ledger-card">
          <PanelHeading
            title="家賃・電気・通信"
            subtitle={`${planning.homeCosts.length}件 · 計算式と採用理由を保存`}
          />
          <ul className="compact-record-list">
            {planning.homeCosts.map((item) => (
              <li key={item.id}>
                <div>
                  <strong>
                    {item.month} {categoryLabel(item.category)}
                  </strong>
                  <span>{item.basis}</span>
                </div>
                <small>
                  {item.amountJpy === null
                    ? `支払額不明：${item.unknownAmountReason}`
                    : yen.format(item.amountJpy)}
                  {' / '}業務割合 {Math.round(item.businessUseRatio * 100)}%
                </small>
              </li>
            ))}
          </ul>
        </article>
        <article className="panel ledger-card">
          <PanelHeading
            title="証拠と不足情報"
            subtitle={`${planning.evidence.length}件 · Gitがなくてもメモや外部記録を保存`}
          />
          <ul className="compact-record-list evidence-records">
            {planning.evidence.map((item) => (
              <li key={item.id}>
                <div>
                  <strong>{item.note}</strong>
                  <span>{item.occurredOn ?? '日付未登録'}</span>
                </div>
                <small>{item.strength}</small>
              </li>
            ))}
            {diagnosis.missingFacts.map((fact) => (
              <li className="missing-record" key={fact}>
                <div>
                  <strong>不足</strong>
                  <span>{fact}</span>
                </div>
                <small>要確認</small>
              </li>
            ))}
          </ul>
        </article>
      </div>
      <article className="panel ledger-balance">
        <PanelHeading
          title="全費用の配分チェック"
          subtitle="支払と配分の画面と同じ費用基礎を表示します。詳細は支払と配分で確認できます。"
        />
        {!costProjection ? (
          <p>この表示には全費用の資料が登録されていません。</p>
        ) : (
          <>
            <p>
              {costProjection.year}
              年の作業中資料。税務上の当年費用・資産残高の確定値ではありません。
            </p>
            <dl>
              <div>
                <dt>算定済みの費用基礎</dt>
                <dd>{yen.format(costProjection.totals.knownBasisJpy)}</dd>
              </div>
              <div>
                <dt>通常業務</dt>
                <dd>{yen.format(costProjection.totals.generalJpy)}</dd>
              </div>
              <div>
                <dt>制作物へ配賦</dt>
                <dd>{yen.format(costProjection.totals.taxUnitJpy)}</dd>
              </div>
              <div>
                <dt>私用</dt>
                <dd>{yen.format(costProjection.totals.privateJpy)}</dd>
              </div>
              <div>
                <dt>未配分・配分未算定</dt>
                <dd>{yen.format(costProjection.totals.unallocatedJpy)}</dd>
              </div>
              <div>
                <dt>捕捉外の利用</dt>
                <dd>{yen.format(costProjection.totals.unobservedJpy)}</dd>
              </div>
              <div>
                <dt>端数調整</dt>
                <dd>{yen.format(costProjection.totals.roundingJpy)}</dd>
              </div>
              <div>
                <dt>費用基礎が未算定</dt>
                <dd>{costProjection.totals.unknownBasisIds.length}件</dd>
              </div>
            </dl>
          </>
        )}
      </article>
    </section>
  )
}

const TAX_GUIDE_ITEMS = [
  {
    term: '取得価額とは？',
    answer: '資産を買う・作るために直接必要だった金額を、使用開始まで集めたものです。',
    example:
      '新規アプリの実装に直接使ったAIサブスク配賦額は、自作ソフトウェアの取得価額に含める候補になります。',
    check: 'その作業は特定の資産へ直接対応するか。一般学習・保守・私用が混ざっていないか。',
  },
  {
    term: '資本的支出とは？',
    answer: '既存資産の価値を高めたり、使える期間を延ばしたりする改良費です。',
    example:
      '既存アプリへ独立した大型機能を追加する開発は候補です。小さな不具合修正や現状維持は通常経費の候補になり得ます。',
    check:
      '一つの改良計画として何を増強したか。通常の維持管理との境界を仕様・Issue・リリース記録で説明できるか。',
  },
  {
    term: '通常経費との違いは？',
    answer: '当年の活動を維持する費用か、将来にも効果が残る資産形成の費用かが大きな分岐です。',
    example:
      '稼働中サービスの軽微なバグ修正は通常経費、新規ソフトウェアの完成へ直接必要な実装は取得価額の候補です。',
    check: '支払名目だけで決めず、実際の作業目的・成果・供用状況を確認する。',
  },
  {
    term: '制作原価とは？',
    answer: '販売するコンテンツや棚卸資産を作るために直接かかった費用として集める候補です。',
    example: '販売用デジタル教材の本文生成に直接使ったAI利用分を、作品・商品単位で集計します。',
    check: '販売目的の成果物か、いつ売上原価になるか、仕掛中の扱いを含めて申告時に確認する。',
  },
  {
    term: '前払費用とは？',
    answer: '支払い済みでも、まだ提供を受けていない将来期間のサービスに対応する金額です。',
    example:
      '年払い契約のうち翌年分は候補になり得ます。一方、今月すでに利用したAI料金を単に翌年へ移す制度ではありません。',
    check: '契約期間、サービス提供済みの期間、短期前払費用の適用可否を契約書・請求書で確認する。',
  },
  {
    term: '10万円・20万円の境界は？',
    answer:
      '原則として、10万円未満は当年費用、10万円以上20万円未満は通常償却または3年の一括償却、20万円以上は通常の減価償却を検討します。',
    example:
      '99,999円は10万円未満、100,000円は10万円以上です。200,000円ちょうども「20万円未満」には入りません。',
    check:
      '青色申告者の少額特例など別制度の要件、取得・製作日、所得区分、年間上限も個別に確認する。',
  },
  {
    term: '金額の判定単位は？',
    answer:
      'AIの月額料金1行ではなく、完成する一つの資産や一つの改良計画ごとに集めた金額が判定の出発点です。',
    example:
      '月3万円を4か月使って一つのアプリを作った場合、各月3万円だけを見て10万円未満とは判断しません。',
    check:
      'リポジトリ名だけで機械的に分けず、仕様・用途・一体で機能する範囲から税務上の単位を確認する。',
  },
  {
    term: '供用開始とは？',
    answer: '資産が完成しただけでなく、本来の目的のため実際に使い始めた時点です。',
    example:
      '開発中のテストだけなら未供用候補。顧客向けサービスや正式な制作工程で使い始めれば供用開始候補です。',
    check: '初回リリース、正式採用、運用ログなど、実際に使い始めた日を示す証拠を残す。',
  },
  {
    term: '直接対応費と証拠は？',
    answer:
      '特定のプロダクトへ合理的に結び付く利用分だけを、同じ方法で継続配賦することが説明力につながります。',
    example:
      'Claude Code／Codexの加重トークン、作業フォルダ、Gitブランチを使い、月額料金をプロダクト別に配賦します。',
    check:
      '請求書、配賦ルール、セッションメタデータ、手動修正理由、仕様・コミット・供用日の記録を保存する。',
  },
  {
    term: '旧版から新版へ作り直すときは？',
    answer:
      '大幅な仕様変更で新しいソフトウェアを製作し、完成後に旧版を使わない場合は、旧版残価を新版の原材料費に含める取扱いの検討対象です。',
    example:
      '旧パイプラインを廃止し、M1〜M5で構造を再設計する場合は、単なる機能追加か新しい資産かを移行記録で説明します。',
    check:
      '大幅な仕様変更、旧版廃止、移行日、二重控除がないことを確認する。旧版を10万円未満として全額費用化済みなら、移す残価は通常0円です。',
  },
  {
    term: '公開前なら未供用ですか？',
    answer:
      '公開前という事実だけでは決まりません。本来の目的で正式原稿や本番工程に使い始めたかを確認します。',
    example:
      '評価用コピーで比較するだけなら開発・試験寄りですが、新版の出力を正式原稿へ採用すれば供用済みとなる可能性があります。',
    check: 'テストのみ／正式採用、初回本番利用日、リリース記録、正式原稿への反映履歴を残す。',
  },
  {
    term: 'このMVPで未計算のものは？',
    answer:
      '設備、家賃・電気・通信、直接費は概算候補を計算します。交通費、暗号資産益との所得集計、最終的な償却額や税額はまだ確定しません。',
    example:
      '私用から転用したPCの未償却残高や耐用年数が未入力なら、無理に計算せず「要確認」として残します。',
    check:
      '申告時は所得区分、供用日、耐用年数、償却方法、取得価額に含める範囲を確認し、必要に応じて税理士へ相談する。',
  },
] as const

function TaxGuidePage() {
  return (
    <>
      <section className="guide-intro">
        <div>
          <span className="guide-intro-label">まずここから</span>
          <h2>月額料金を、そのまま税務処理しない。</h2>
          <p>
            まず「何を作るための利用か」を資産・改良計画単位で集め、
            金額境界と供用状況を確認します。DevTaxは判断を確定せず、候補と不足証拠を示します。
          </p>
        </div>
        <ol className="guide-route" aria-label="税務候補を確認する順序">
          <li>
            <span>1</span>
            <strong>作業目的</strong>
            <small>新規・改良・保守・私用</small>
          </li>
          <li>
            <span>2</span>
            <strong>費用をまとめる単位</strong>
            <small>一つのアプリ・改良計画</small>
          </li>
          <li>
            <span>3</span>
            <strong>時点と金額</strong>
            <small>供用開始・合計額</small>
          </li>
          <li>
            <span>4</span>
            <strong>証拠</strong>
            <small>履歴・仕様・請求書</small>
          </li>
        </ol>
      </section>

      <section className="tax-qa-grid" aria-label="税務用語のよくある質問">
        {TAX_GUIDE_ITEMS.map((item, index) => (
          <details className="tax-qa-card" key={item.term} open={index < 2}>
            <summary>
              <span>{String(index + 1).padStart(2, '0')}</span>
              <strong>{item.term}</strong>
              <i aria-hidden="true">＋</i>
            </summary>
            <div className="tax-qa-answer">
              <p className="one-line-answer">{item.answer}</p>
              <dl>
                <div>
                  <dt>例</dt>
                  <dd>{item.example}</dd>
                </div>
                <div>
                  <dt>確認</dt>
                  <dd>{item.check}</dd>
                </div>
              </dl>
            </div>
          </details>
        ))}
      </section>

      <section className="official-sources" aria-labelledby="official-sources-title">
        <div>
          <span aria-hidden="true">↗</span>
          <div>
            <h2 id="official-sources-title">国税庁の公式資料で確認する</h2>
            <p>個別事情や制度改正で結論は変わります。申告前は原文と専門家へ確認してください。</p>
          </div>
        </div>
        <ul>
          <li>
            <a
              href="https://www.nta.go.jp/law/tsutatsu/kihon/shotoku/08/06.htm"
              target="_blank"
              rel="noreferrer"
            >
              自己の製作に係るソフトウェアの取得価額等
            </a>
          </li>
          <li>
            <a
              href="https://www.nta.go.jp/law/tsutatsu/kihon/shotoku/05/07.htm"
              target="_blank"
              rel="noreferrer"
            >
              資本的支出と修繕費等
            </a>
          </li>
          <li>
            <a
              href="https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/2100.htm"
              target="_blank"
              rel="noreferrer"
            >
              減価償却のあらまし
            </a>
          </li>
          <li>
            <a
              href="https://www.nta.go.jp/law/tsutatsu/kihon/shotoku/08/12.htm"
              target="_blank"
              rel="noreferrer"
            >
              少額減価償却資産・一括償却資産
            </a>
          </li>
        </ul>
      </section>

      <footer className="tax-disclaimer">
        <span aria-hidden="true">ⓘ</span>
        このQAは一般的な整理候補です。資産計上・必要経費・申告内容を確定するものではありません。
      </footer>
    </>
  )
}

export default App
