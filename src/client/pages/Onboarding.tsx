import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  DashboardData,
  LocalConfiguration,
  ProviderKey,
  RuntimeData,
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
import { diagnosePlanning } from '../../core/diagnosis'
import {
  chargeConfirmationKey,
  invertedContractMessage,
  missingChargeMessage,
  missingChargeProviders,
  needsChargeConfirmation,
  providerWithInvertedContract,
} from '../chargeGuard'
import { focusableElements, trapAction } from '../focusTrap.js'
import { categoryLabel, lifecycleLabel, monthKeyFromLabel, usageModeLabel } from './shared'

function Onboarding({
  step,
  data,
  runtime,
  runtimeLoading,
  configuration,
  planning,
  unassignedFolderCount,
  onStep,
  onScan,
  onSave,
  onSavePlanning,
  onClose,
  onSaved,
}: {
  step: number
  data: DashboardData
  runtime: RuntimeData | null
  runtimeLoading: boolean
  configuration: LocalConfiguration | null
  planning: PlanningSnapshot
  unassignedFolderCount: number
  onStep: (step: number) => void
  onScan: (providers: ProviderKey[]) => Promise<ScanResult>
  onSave: (configuration: LocalConfiguration) => Promise<void>
  onSavePlanning: (planning: PlanningSnapshot) => Promise<void>
  onClose: () => void
  onSaved?: () => void
}) {
  const steps = ['履歴', '対象年', '制作物', '費用', '診断']
  const isDemoData = data.meta.source === 'demo'
  const apiUnavailable = !runtime
  const [selectedProviders, setSelectedProviders] = useState<ProviderKey[]>(['claude', 'codex'])
  const [claudeCharge, setClaudeCharge] = useState<number | undefined>(undefined)
  const [codexCharge, setCodexCharge] = useState<number | undefined>(undefined)
  const [monthlyCharges, setMonthlyCharges] = useState<LocalConfiguration['monthlyCharges']>([])
  const [contracts, setContracts] = useState<LocalConfiguration['contracts']>({
    claude: {},
    codex: {},
  })
  // Remember WHICH providers were warned about, not just that a warning fired.
  // A bare boolean goes stale: warn about Claude, then re-select Codex on an
  // earlier step, and the second press would skip the check entirely and save
  // Codex as 0 yen without ever naming it.
  const [confirmedMissingCharges, setConfirmedMissingCharges] = useState<string | null>(null)
  const [unobservedPercent, setUnobservedPercent] = useState(10)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{
    kind: 'success' | 'error' | 'info'
    message: string
  } | null>(null)
  const [planningDraft, setPlanningDraft] = useState<PlanningSnapshot>(planning)
  const [selectedHistoryProjects, setSelectedHistoryProjects] = useState<Record<string, boolean>>(
    {},
  )
  const onboardingBodyRef = useRef<HTMLDivElement>(null)
  const modalRef = useRef<HTMLElement>(null)
  const rankedProducts = data.products
    .map((product, index) => ({ product, index }))
    .sort((left, right) => right.product.sessions - left.product.sessions)
  const observedHistoryMonths = data.products
    .flatMap((product) => [product.firstObservedMonth, product.lastObservedMonth])
    .filter((month): month is string => Boolean(month))
    .sort()
  const historyRangeText =
    observedHistoryMonths.length > 0
      ? `${observedHistoryMonths[0]}月～${observedHistoryMonths.at(-1)}月`
      : '利用時期を確認中'
  const draftDiagnosis = useMemo(() => diagnosePlanning(planningDraft), [planningDraft])

  useEffect(() => {
    onboardingBodyRef.current?.scrollTo({ top: 0 })
  }, [step])

  useEffect(() => {
    if (!runtime) return
    setSelectedProviders(
      (['claude', 'codex'] as ProviderKey[]).filter(
        (provider) => runtime.providers[provider].detected,
      ),
    )
  }, [runtime])

  useEffect(() => {
    if (!configuration) return
    setClaudeCharge(configuration.charges.claude > 0 ? configuration.charges.claude : undefined)
    setCodexCharge(configuration.charges.codex > 0 ? configuration.charges.codex : undefined)
    setContracts(configuration.contracts)
    setUnobservedPercent(Math.round(configuration.unobservedRatio * 100))
    const saved = new Map(
      configuration.monthlyCharges.map((charge) => [
        `${charge.provider}:${charge.month}`,
        charge.amountJpy,
      ]),
    )
    setMonthlyCharges(
      data.months.flatMap((month) => {
        const monthKey = monthKeyFromLabel(month.label, planning.profile.taxYear)
        return (['claude', 'codex'] as ProviderKey[]).map((provider) => ({
          provider,
          month: monthKey,
          amountJpy: saved.get(`${provider}:${monthKey}`) ?? configuration.charges[provider],
        }))
      }),
    )
  }, [configuration, data.months, planning.profile.taxYear])

  useEffect(() => {
    const fallbackUnit: TaxUnitRecord = {
      id: `tax-unit-${Date.now()}`,
      name: data.products[0]?.name ?? '新しいアプリ',
      unitType: 'new-software',
      usageMode: 'undecided',
      revenueModel: 'undecided',
      lifecycleStatus: 'developing',
      journeyMode: planning.profile.journeyMode,
      monetizationStatus: 'none',
      sameAsExternalVersion: 'undecided',
    }
    const next = planning.taxUnits.length > 0 ? planning : { ...planning, taxUnits: [fallbackUnit] }
    setPlanningDraft(next)
  }, [data.products, planning])

  useEffect(() => {
    const container = modalRef.current
    if (!container) return
    const previouslyFocused = document.activeElement
    focusableElements(container)[0]?.focus()

    function onKeyDown(event: KeyboardEvent) {
      const modal = modalRef.current
      if (!modal) return
      const action = trapAction(event.key, event.shiftKey, modal, document.activeElement)
      if (action === 'ignore') return
      event.preventDefault()
      if (action === 'close') {
        onClose()
        return
      }
      const elements = focusableElements(modal)
      if (action === 'wrap-forward') elements[0]?.focus()
      else elements.at(-1)?.focus()
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus()
    }
  }, [onClose])

  function toggleProvider(provider: ProviderKey) {
    setSelectedProviders((current) =>
      current.includes(provider)
        ? current.filter((item) => item !== provider)
        : [...current, provider],
    )
  }

  function updateProviderCharge(provider: ProviderKey, amount: number | undefined) {
    const normalized = amount === undefined ? undefined : Math.max(0, amount)
    if (provider === 'claude') setClaudeCharge(normalized)
    else setCodexCharge(normalized)
    setConfirmedMissingCharges(null)
    setMonthlyCharges((current) =>
      current.map((charge) =>
        charge.provider === provider ? { ...charge, amountJpy: normalized ?? 0 } : charge,
      ),
    )
  }

  function updateTaxUnit(index: number, patch: Partial<TaxUnitRecord>) {
    setPlanningDraft((current) => ({
      ...current,
      taxUnits: current.taxUnits.map((unit, unitIndex) =>
        unitIndex === index ? { ...unit, ...patch } : unit,
      ),
    }))
  }

  function addHistoryCandidates() {
    const selected = rankedProducts
      .map(({ product }) => product)
      .filter((product) => product.projectKey && selectedHistoryProjects[product.projectKey])
    if (selected.length === 0) {
      setNotice({ kind: 'info', message: '候補を1件以上選んでください。' })
      return
    }

    const units = [...planningDraft.taxUnits]
    selected.forEach((product, index) => {
      const existing = units.find(
        (unit) => unit.name.trim().toLowerCase() === product.name.trim().toLowerCase(),
      )
      if (!existing) {
        units.push({
          id: `tax-unit-history-${Date.now()}-${index}`,
          name: product.name,
          unitType: 'new-software',
          usageMode: 'undecided',
          revenueModel: 'undecided',
          lifecycleStatus: 'developing',
          journeyMode: 'retrospective',
          monetizationStatus: 'none',
          sameAsExternalVersion: 'undecided',
          notes: 'ローカルAI履歴から名称候補を作成。用途・状態・実際の開始日は利用者確認が必要。',
        })
      }
    })

    setPlanningDraft((current) => ({ ...current, taxUnits: units }))
    setSelectedHistoryProjects({})
    setNotice({
      kind: 'success',
      message: `${selected.length}件を履歴から入力しました。用途・状態・実際の開始日を確認してください。`,
    })
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
      setBusy(true)
      try {
        const result = await onScan(selectedProviders)
        const events = Object.values(result.providers).reduce(
          (sum, provider) => sum + (provider?.events ?? 0),
          0,
        )
        setNotice({
          kind: 'success',
          message: `${events.toLocaleString()}件の利用記録をローカルに取り込みました。`,
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
      onStep(4)
      return
    }
    const invalidContract = providerWithInvertedContract(contracts)
    if (invalidContract) {
      setNotice({ kind: 'error', message: invertedContractMessage(invalidContract) })
      return
    }
    const missingCharges = missingChargeProviders(selectedProviders, {
      claude: claudeCharge,
      codex: codexCharge,
    })
    if (needsChargeConfirmation(missingCharges, confirmedMissingCharges)) {
      setConfirmedMissingCharges(chargeConfirmationKey(missingCharges))
      setNotice({ kind: 'error', message: missingChargeMessage(missingCharges) })
      return
    }
    if (apiUnavailable) {
      onClose()
      return
    }
    setBusy(true)
    try {
      await onSave({
        charges: {
          claude: Math.max(0, Math.round(claudeCharge ?? 0)),
          codex: Math.max(0, Math.round(codexCharge ?? 0)),
        },
        monthlyCharges,
        contracts,
        unobservedRatio: Math.min(95, Math.max(0, unobservedPercent)) / 100,
      })
      await onSavePlanning(planningDraft)
      setNotice({ kind: 'success', message: '設定を保存し、ダッシュボードを再集計しました。' })
      onSaved?.()
      window.setTimeout(onClose, 650)
    } catch (error) {
      setNotice({
        kind: 'error',
        message: `保存に失敗しました：${error instanceof Error ? error.message : '不明なエラー'}`,
      })
    } finally {
      setBusy(false)
    }
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
    setBusy(true)
    try {
      await onSavePlanning(planningDraft)
      setNotice({
        kind: 'success',
        message: 'ここまでの入力を保存しました。次回は続きから確認できます。',
      })
    } catch (error) {
      setNotice({
        kind: 'error',
        message: `保存できませんでした。ローカルサーバーを確認して、もう一度お試しください。詳細：${error instanceof Error ? error.message : '不明なエラー'}`,
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section
        className="onboarding-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-title"
        ref={modalRef}
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
                <p>読み取り専用で集計します。プロンプトや応答本文、ソースコードは取得しません。</p>
                <div className="detected-list">
                  {(
                    [
                      ['claude', 'Claude Code', '~/.claude/projects', 'C'],
                      ['codex', 'Codex', '~/.codex/sessions', 'O'],
                    ] as const
                  ).map(([key, label, path, monogram]) => {
                    const detected = runtime?.providers[key].detected ?? isDemoData
                    return (
                      <label className={!detected ? 'provider-undetected' : ''} key={key}>
                        <input
                          type="checkbox"
                          checked={selectedProviders.includes(key)}
                          disabled={!detected || busy || runtimeLoading}
                          onChange={() => toggleProvider(key)}
                        />
                        <span className={`provider-logo ${key === 'codex' ? 'codex' : ''}`}>
                          {monogram}
                        </span>
                        <span>
                          <strong>{label}</strong>
                          <small>{path}</small>
                        </span>
                        <b>{runtimeLoading ? '確認中' : detected ? '検出済み' : '未検出'}</b>
                        <span className="check">{detected ? '✓' : '—'}</span>
                      </label>
                    )
                  })}
                </div>
                <div className="privacy-callout">
                  <span>⌂</span>
                  <p>
                    <strong>データはこのPCの中だけ</strong>
                    <br />
                    外部送信・クラウド同期・テレメトリはありません。
                  </p>
                </div>
                <div className="setup-insight">
                  <span>✓</span>
                  <p>
                    <strong>ここまで分かりました</strong>
                    <br />
                    {selectedProviders.length}
                    種類のAI履歴を確認します。本文やソースコードは読みません。
                  </p>
                </div>
              </>
            )}
            {step === 1 && (
              <>
                <span className="step-label">2 / 5　対象年と申告全体</span>
                <h3>まず、今回整理する年を確認します</h3>
                <p>
                  ここでは申告全体に共通することだけ確認します。開発時期や売上状況は、次の画面で制作物ごとに登録します。
                </p>
                <div className="history-context-bridge">
                  <div>
                    <span>履歴から分かったこと</span>
                    <strong>
                      {data.meta.sessionCount.toLocaleString('ja-JP')}件・{historyRangeText}
                    </strong>
                    <small>利用AI、作業フォルダ、利用量</small>
                  </div>
                  <b>＋</b>
                  <div>
                    <span>この画面で確認</span>
                    <strong>対象年・申告全体</strong>
                    <small>所得区分は未確定でも進められます</small>
                  </div>
                  <b>→</b>
                  <div>
                    <span>次の画面で確認</span>
                    <strong>制作物ごとの現在地</strong>
                    <small>開始時期、売上、利用・公開状況</small>
                  </div>
                </div>
                <p className="answer-later-note">
                  分からない項目は「まだ決めていない」で進められます。
                </p>
                <div className="simple-form-grid">
                  <label>
                    <span>
                      <strong>対象の年</strong>
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
                <details className="advanced-fields">
                  <summary>申告について分かる範囲で答える</summary>
                  <div className="simple-form-grid">
                    <label>
                      <span>
                        <strong>所得の区分</strong>
                        <small>分からなければ未確定のままで進めます</small>
                      </span>
                      <select
                        value={planningDraft.profile.incomeCategory}
                        onChange={(event) =>
                          setPlanningDraft((current) => ({
                            ...current,
                            profile: {
                              ...current.profile,
                              incomeCategory: event.target
                                .value as PlanningSnapshot['profile']['incomeCategory'],
                            },
                          }))
                        }
                      >
                        <option value="undecided">まだ分からない</option>
                        <option value="miscellaneous">雑所得として検討中</option>
                        <option value="business">事業所得として検討中</option>
                      </select>
                    </label>
                    <label>
                      <span>
                        <strong>申告方法</strong>
                        <small>開業届だけで所得区分が決まるものではありません</small>
                      </span>
                      <select
                        value={planningDraft.profile.filingType}
                        onChange={(event) =>
                          setPlanningDraft((current) => ({
                            ...current,
                            profile: {
                              ...current.profile,
                              filingType: event.target
                                .value as PlanningSnapshot['profile']['filingType'],
                            },
                          }))
                        }
                      >
                        <option value="undecided">まだ分からない</option>
                        <option value="white">白色申告</option>
                        <option value="blue">青色申告</option>
                      </select>
                    </label>
                  </div>
                </details>
                <div className="setup-insight">
                  <span>✓</span>
                  <p>
                    <strong>ここまで分かりました</strong>
                    <br />
                    {planningDraft.profile.taxYear}
                    年分として整理します。制作物ごとの開始時期と売上状況は次に確認します。
                  </p>
                </div>
              </>
            )}
            {step === 2 && (
              <>
                <span className="step-label">3 / 5　作っているもの</span>
                <h3>AIを使って何を作っていますか？</h3>
                <p>
                  自分で使うものも、外へ公開するものも登録できます。公開日だけでなく、実際に使い始めた時点も大切です。
                </p>
                {!isDemoData && rankedProducts.length > 0 && (
                  <details className="history-candidate-import">
                    <summary>履歴からプロダクト候補を入力する</summary>
                    <p>
                      AI履歴にある名前・最初と最後の利用日時・利用AIを候補にします。税務上の用途や正式な開始日は自動で決めません。
                    </p>
                    <div className="history-candidate-list">
                      {rankedProducts.slice(0, 12).map(({ product }) => (
                        <label key={product.projectKey ?? product.name}>
                          <input
                            type="checkbox"
                            checked={Boolean(
                              product.projectKey && selectedHistoryProjects[product.projectKey],
                            )}
                            disabled={!product.projectKey}
                            onChange={(event) =>
                              product.projectKey &&
                              setSelectedHistoryProjects((current) => ({
                                ...current,
                                [product.projectKey!]: event.target.checked,
                              }))
                            }
                          />
                          <span>
                            <strong>{product.name}</strong>
                            <small>
                              {product.sessions}セッション　
                              {product.providers?.join('・') || '利用AI確認中'}
                              <br />
                              履歴上：
                              {product.firstObservedAt?.slice(0, 10) ||
                                (product.firstObservedMonth
                                  ? `${product.firstObservedMonth}月`
                                  : '開始時期不明')}{' '}
                              ～{' '}
                              {product.lastObservedAt?.slice(0, 10) ||
                                (product.lastObservedMonth
                                  ? `${product.lastObservedMonth}月`
                                  : '終了時期不明')}
                            </small>
                          </span>
                        </label>
                      ))}
                    </div>
                    {rankedProducts.length > 12 && (
                      <p className="candidate-note">
                        まず利用量の多い12件を表示しています。残りは下の「別の開発をもう1件追加」から手動で入力してください。
                      </p>
                    )}
                    <button
                      type="button"
                      className="primary-button candidate-import-button"
                      onClick={addHistoryCandidates}
                    >
                      選んだ候補を入力
                    </button>
                  </details>
                )}
                <div className="multi-product-guide">
                  <strong>複数の開発があるとき</strong>
                  <p>
                    <b>1つずつ別々に登録</b>
                    します。まず1件目を入力し、下の「別の開発をもう1件追加」を押してください。
                  </p>
                  <details>
                    <summary>どこまでを1つとして分ける？</summary>
                    <ul>
                      <li>
                        <b>別々にする：</b>家計アプリと小説執筆ツールなど、目的や完成条件が違うもの
                      </li>
                      <li>
                        <b>同じまま：</b>同じアプリの軽い修正や通常の更新
                      </li>
                      <li>
                        <b>迷うとき：</b>普段、別の名前で進捗を管理している単位で登録する
                      </li>
                    </ul>
                  </details>
                </div>
                <div className="tax-unit-editor-list">
                  {planningDraft.taxUnits.map((unit, index) => (
                    <article className="tax-unit-editor" key={unit.id}>
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
                        <input
                          type="date"
                          value={lifecycleDate(unit.id, 'development-started')}
                          onChange={(event) =>
                            updateLifecycleDate(unit.id, 'development-started', event.target.value)
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
                          <input
                            type="date"
                            value={lifecycleDate(unit.id, 'first-sale')}
                            onChange={(event) =>
                              updateLifecycleDate(unit.id, 'first-sale', event.target.value)
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
                          <input
                            type="date"
                            value={lifecycleDate(unit.id, 'internal-use-started')}
                            onChange={(event) =>
                              updateLifecycleDate(
                                unit.id,
                                'internal-use-started',
                                event.target.value,
                              )
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
                          <input
                            type="date"
                            value={lifecycleDate(unit.id, 'external-released')}
                            onChange={(event) =>
                              updateLifecycleDate(unit.id, 'external-released', event.target.value)
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
                        <input
                          aria-label={`${label} 契約開始日`}
                          type="date"
                          value={contracts[provider].startedOn ?? ''}
                          onChange={(event) =>
                            setContracts((current) => ({
                              ...current,
                              [provider]: {
                                ...current[provider],
                                startedOn: event.target.value || undefined,
                              },
                            }))
                          }
                        />
                      </label>
                      <label>
                        <span>終了日</span>
                        <input
                          aria-label={`${label} 契約終了日`}
                          type="date"
                          value={contracts[provider].endedOn ?? ''}
                          onChange={(event) =>
                            setContracts((current) => ({
                              ...current,
                              [provider]: {
                                ...current[provider],
                                endedOn: event.target.value || undefined,
                              },
                            }))
                          }
                        />
                      </label>
                      <small>解約していない場合、終了日は空のままにしてください。</small>
                    </div>
                  ))}
                </div>
                {monthlyCharges.length > 0 && (
                  <details className="monthly-charges">
                    <summary>月別料金を編集（{monthlyCharges.length / 2}か月）</summary>
                    <div className="monthly-charge-grid">
                      {data.months.map((month) => {
                        const monthKey = monthKeyFromLabel(
                          month.label,
                          planningDraft.profile.taxYear,
                        )
                        return (
                          <div className="monthly-charge-row" key={monthKey}>
                            <strong>{month.label}</strong>
                            {(['claude', 'codex'] as ProviderKey[]).map((provider) => {
                              const index = monthlyCharges.findIndex(
                                (charge) =>
                                  charge.provider === provider && charge.month === monthKey,
                              )
                              return (
                                <label key={provider}>
                                  <span>{provider === 'claude' ? 'Claude' : 'Codex'}</span>
                                  <input
                                    aria-label={`${month.label} ${provider}料金`}
                                    type="number"
                                    min="0"
                                    value={monthlyCharges[index]?.amountJpy ?? 0}
                                    onChange={(event) =>
                                      setMonthlyCharges((current) =>
                                        current.map((charge, chargeIndex) =>
                                          chargeIndex === index
                                            ? {
                                                ...charge,
                                                amountJpy: event.target.valueAsNumber || 0,
                                              }
                                            : charge,
                                        ),
                                      )
                                    }
                                  />
                                  <span>円</span>
                                </label>
                              )
                            })}
                          </div>
                        )
                      })}
                    </div>
                  </details>
                )}
                <label className="ratio-field">
                  <span>
                    <strong>未取得利用の割合</strong>
                    <small>Webチャットや別PCなど、ローカル履歴に現れない利用</small>
                  </span>
                  <input
                    aria-label="未取得利用割合"
                    type="number"
                    min="0"
                    max="95"
                    value={unobservedPercent}
                    onChange={(event) => setUnobservedPercent(event.target.valueAsNumber || 0)}
                  />
                  <span>%</span>
                </label>
                <div className="cost-editor-section">
                  <div className="cost-editor-heading">
                    <div>
                      <h4>PC・DGXなど</h4>
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
                              acquisitionCostJpy: 0,
                              acquiredOn: `${current.profile.taxYear}-01-01`,
                              convertedFromPrivate: false,
                              businessUseRatio: 1,
                              role: 'アプリ開発',
                              taxUnitId: current.taxUnits[0]?.id,
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
                          <option value="dgx">DGX</option>
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
                          value={item.acquisitionCostJpy}
                          onChange={(event) =>
                            updateEquipment(index, {
                              acquisitionCostJpy: event.target.valueAsNumber || 0,
                            })
                          }
                        />
                      </label>
                      <label>
                        <span>購入日</span>
                        <input
                          type="date"
                          value={item.acquiredOn}
                          onChange={(event) =>
                            updateEquipment(index, { acquiredOn: event.target.value })
                          }
                        />
                      </label>
                      <label>
                        <span>業務で使い始めた日</span>
                        <input
                          type="date"
                          value={item.businessUseStartedOn ?? ''}
                          onChange={(event) =>
                            updateEquipment(index, {
                              businessUseStartedOn: event.target.value || undefined,
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
                                amountJpy: 0,
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
                          value={item.amountJpy}
                          onChange={(event) =>
                            updateHomeCost(index, { amountJpy: event.target.valueAsNumber || 0 })
                          }
                        />
                      </label>
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
                      <label>
                        <span>どの制作物に使う？</span>
                        <select
                          value={item.taxUnitId ?? ''}
                          onChange={(event) =>
                            updateHomeCost(index, { taxUnitId: event.target.value || undefined })
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
                                Math.min(100, Math.max(0, event.target.valueAsNumber || 0)) / 100,
                            })
                          }
                        />
                      </label>
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
                              amountJpy: 0,
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
                        <input
                          type="date"
                          value={item.incurredOn}
                          onChange={(event) =>
                            updateDirectCost(index, { incurredOn: event.target.value })
                          }
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
                          value={item.amountJpy}
                          onChange={(event) =>
                            updateDirectCost(index, { amountJpy: event.target.valueAsNumber || 0 })
                          }
                        />
                      </label>
                      <label>
                        <span>結び付ける制作物</span>
                        <select
                          value={item.taxUnitId ?? ''}
                          onChange={(event) =>
                            updateDirectCost(index, { taxUnitId: event.target.value || undefined })
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
                        <input
                          type="date"
                          value={item.occurredOn ?? ''}
                          onChange={(event) =>
                            updateEvidence(index, { occurredOn: event.target.value || undefined })
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
              </>
            )}
            {step === 4 && (
              <>
                <span className="step-label">5 / 5　これから行うこと</span>
                <h3>いまの整理結果です</h3>
                <p>保存すると、登録した事実から診断と金額を計算し直します。</p>
                <div className="onboarding-diagnosis">
                  <section>
                    <h4>準備の進み具合</h4>
                    <p className="readiness-copy">
                      <strong>
                        {draftDiagnosis.readiness.confirmed} / {draftDiagnosis.readiness.total}
                      </strong>{' '}
                      項目まで確認できました。全部埋めなくても保存して、次回ここから続けられます。
                    </p>
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
              <button
                className="primary-button"
                disabled={busy || runtimeLoading}
                onClick={advance}
              >
                {busy
                  ? step === 0
                    ? '履歴を確認中…'
                    : '保存中…'
                  : step === 0
                    ? apiUnavailable
                      ? 'デモで次へ'
                      : '履歴を確認して次へ'
                    : step === 4
                      ? apiUnavailable
                        ? 'デモを閉じる'
                        : '保存する'
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
