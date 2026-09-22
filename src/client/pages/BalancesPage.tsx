import DateInput from './DateInput'
import TreatmentBalanceDraftPanel from './TreatmentBalanceDraftPanel'
import SoftwareAcquisitionPanel from './SoftwareAcquisitionPanel'
import type { ConsultationNavigation } from '../consultationNavigation'
import { decisionIsConfirmed } from '../../core/decisionConfirmation'
import { checkBalanceReferences } from '../../core/balanceReferences'
import ReviewRecordsPanel from './ReviewRecordsPanel'
import BalanceConflictPanel from './BalanceConflictPanel'
import PendingBalanceEditor from './PendingBalanceEditor'
import ReviewAdoptionPanel from './ReviewAdoptionPanel'
import BalanceCostLinksEditor from './BalanceCostLinksEditor'
import BalanceFlowEditor from './BalanceFlowEditor'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AmountState, BalanceMovement, BalanceSnapshot } from '../../accounting/types'
import type { BalanceDraft } from '../../accounting/balanceWorkspace'
import type { DecisionRecord, PlanningSnapshot } from '../../planning/types'
import type { LocalConfiguration } from '../types'
import { balanceSnapshotSchema } from '../../accounting/balanceSchema'
import { buildAnnualBalances } from '../../core/annualBalances'
import { ApiRequestError, getBalanceDraft, getRuntime, saveBalanceDraft } from '../api'
import { yen } from './shared'
import {
  listRecoveries,
  balanceSaveFingerprint,
  removeRecovery,
  writeRecovery,
  type BalanceRecovery,
} from '../balanceRecovery'

const kinds = { construction: '制作中', asset: '資産', prepaid: '前払' }
const movementKinds = {
  addition: '増加',
  expense: '費用化',
  reduction: 'その他減少',
  transfer: '振替',
}
function amountText(value: AmountState) {
  return value.status === 'known'
    ? yen.format(value.amountJpy)
    : '不明：' + value.reasons.join(' / ')
}
function failure(error: unknown) {
  return error instanceof Error ? error.message : '残高資料を読み込めませんでした。'
}

export default function BalancesPage({
  planning,
  configuration,
  local,
  onManageUnits,
  datasetId,
  navigation,
  onReviewAnswer,
  onReviewSoftwareAnnualDecision,
}: {
  planning: PlanningSnapshot
  configuration: LocalConfiguration | null
  local: boolean
  onManageUnits: () => void
  datasetId?: string
  navigation?: { year: number; request: number; datasetId?: string; contributionId?: string }
  onReviewAnswer?: (context: ConsultationNavigation) => void
  onReviewSoftwareAnnualDecision?: (
    decision: DecisionRecord,
    expectedRevision: number,
  ) => Promise<boolean>
}) {
  const [draft, setDraft] = useState<BalanceDraft | null>(null)
  const [year, setYear] = useState(String(planning.profile.taxYear))
  const appliedNavigation = useRef<number | null>(null)
  useEffect(() => {
    if (
      !navigation ||
      navigation.datasetId !== datasetId ||
      appliedNavigation.current === navigation.request
    )
      return
    if (!Number.isInteger(navigation.year) || navigation.year < 1900 || navigation.year > 9999)
      return
    appliedNavigation.current = navigation.request
    setYear(String(navigation.year))
  }, [navigation, datasetId])
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [conflict, setConflict] = useState(false)
  const baseDraft = useRef<BalanceDraft | null>(null)
  const [comparisonLatest, setComparisonLatest] = useState<BalanceDraft | null>(null)
  const sequence = useRef({ generation: 0 })
  const saveAttempt = useRef<{ fingerprint: string; requestId: string } | null>(null)
  const recoveryEditor = useRef<string | null>(null)
  const recoveryOwn = useRef<BalanceRecovery | null>(null)
  const recoverySource = useRef<BalanceRecovery | null>(null)
  const [recoveries, setRecoveries] = useState<BalanceRecovery[]>([])
  const [recoveryError, setRecoveryError] = useState('')
  const [recoveryNotice, setRecoveryNotice] = useState('')
  function persistInput(value: BalanceDraft, base = baseDraft.current, selectedYear = year) {
    if (!local || !datasetId || !base) return
    try {
      recoveryEditor.current ??= crypto.randomUUID()
      const record: BalanceRecovery = {
        version: 1,
        datasetId,
        editorId: recoveryEditor.current,
        recordId: crypto.randomUUID(),
        sequence: (recoveryOwn.current?.sequence ?? 0) + 1,
        savedAt: new Date().toISOString(),
        base: { revision: base.revision, snapshot: base.snapshot },
        snapshot: value.snapshot,
        year: selectedYear,
        ...(saveAttempt.current ? { saveAttempt: { ...saveAttempt.current } } : {}),
      }
      const result = writeRecovery(window.localStorage, record)
      recoveryOwn.current = record
      setRecoveryError(
        result.cleanupFailed
          ? '新しい控えを保存しましたが、古い控えの整理ができませんでした。'
          : '',
      )
      setRecoveryNotice(
        '編集中の入力をこのブラウザに控えました。DBへの保存・年度資料の採用とは別です。',
      )
    } catch {
      setRecoveryError(
        '復旧用の控えを保存できません。この画面の入力は残っていますが、閉じる前に作業中の残高を保存してください。',
      )
    }
  }
  const clearRecovery = useCallback(
    (saved = false) => {
      if (!datasetId) return
      try {
        setRecoveryError('')
        if (recoveryOwn.current || recoverySource.current)
          setRecoveryNotice('この画面で使った復旧用の控えを整理しました。')
        for (const record of [recoveryOwn.current, ...(saved ? [recoverySource.current] : [])])
          if (record && !removeRecovery(window.localStorage, record))
            setRecoveryNotice('別画面で更新された復旧用入力は保持しました。')
        recoveryOwn.current = null
        recoverySource.current = null
        setRecoveries([])
      } catch {
        setRecoveryError('保存は完了しましたが、ブラウザの復旧用控えを整理できませんでした。')
      }
    },
    [datasetId],
  )
  function inspectRecoveries() {
    if (!datasetId) return
    try {
      const result = listRecoveries(window.localStorage, datasetId)
      setRecoveries(result.records.filter((row) => row.editorId !== recoveryEditor.current))
      setRecoveryError(
        result.unreadable ? '読めない復旧用入力があります。自動削除していません。' : '',
      )
      setRecoveryNotice('同じ保存資料の控えを表示しています。別の画面が編集中の可能性もあります。')
    } catch {
      setRecoveryError('このブラウザの復旧用入力を読み込めませんでした。')
    }
  }
  async function recoverInput(record: BalanceRecovery) {
    if (busy || dirty || record.datasetId !== datasetId) return
    const request = ++sequence.current.generation
    setBusy(true)
    setError(null)
    try {
      const latest = await getBalanceDraft()
      if (request !== sequence.current.generation) return
      if (latest.datasetId !== datasetId)
        throw new Error('接続中の保存資料が変わっています。画面を再読込してください。')
      if (balanceSaveFingerprint(latest.snapshot) === balanceSaveFingerprint(record.snapshot)) {
        setDraft(latest)
        baseDraft.current = latest
        setNotice('復旧用入力は現在の保存内容と一致しています。重ねて保存していません。')
        return
      }
      const base: BalanceDraft = { ...record.base, datasetId }
      const restored: BalanceDraft = {
        revision: record.base.revision,
        snapshot: structuredClone(record.snapshot),
        datasetId,
      }
      const changed =
        latest.revision !== base.revision ||
        balanceSaveFingerprint(latest.snapshot) !== balanceSaveFingerprint(base.snapshot)
      baseDraft.current = base
      saveAttempt.current = record.saveAttempt ?? null
      recoverySource.current = record
      persistInput(restored, base, record.year)
      setDraft(restored)
      setYear(record.year)
      setDirty(true)
      setConflict(changed)
      setComparisonLatest(changed ? latest : null)
      setNotice(
        '入力を復旧しました。保存済みの資料は変更していません。内容を確認してから保存してください。',
      )
    } catch (cause) {
      if (request === sequence.current.generation) setError(failure(cause))
    } finally {
      if (request === sequence.current.generation) setBusy(false)
    }
  }
  const load = useCallback(async () => {
    const request = ++sequence.current.generation
    setBusy(true)
    setError(null)
    try {
      const saved = await getBalanceDraft()
      if (request !== sequence.current.generation) return
      if (datasetId && saved.datasetId !== datasetId)
        throw new Error('接続中の保存資料が変わっています。画面を再読込してください。')
      clearRecovery()
      setDraft(saved)
      baseDraft.current = saved
      setComparisonLatest(null)
      saveAttempt.current = null
      setDirty(false)
      setConflict(false)
      setNotice('')
    } catch (cause) {
      if (request === sequence.current.generation) setError(failure(cause))
    } finally {
      if (request === sequence.current.generation) setBusy(false)
    }
  }, [datasetId, clearRecovery])
  useEffect(() => {
    const state = sequence.current
    if (local) void load()
    return () => {
      state.generation++
    }
  }, [local, load])
  const calculated = useMemo(() => {
    if (!draft) return { projection: null, error: null }
    try {
      const validated = balanceSnapshotSchema.parse(draft.snapshot)
      return { projection: buildAnnualBalances(validated, Number(year)), error: null }
    } catch (cause) {
      return {
        projection: null,
        error:
          cause instanceof Error && cause.name === 'ZodError'
            ? '名前・制作物・期首・日付・金額・理由・根拠の入力を確認してください。'
            : failure(cause),
      }
    }
  }, [draft, year])
  const referenceCheck = useMemo(() => {
    if (!draft) return null
    if (!dirty && draft.referenceCheck) return draft.referenceCheck
    if (configuration)
      return checkBalanceReferences(draft.snapshot, planning, configuration.chargePeriods ?? [])
    return dirty ? null : (draft.referenceCheck ?? null)
  }, [draft, planning, configuration, dirty])
  function edit(change: (snapshot: BalanceSnapshot) => void) {
    if (!draft || busy) return
    const next = structuredClone(draft.snapshot)
    change(next)
    saveAttempt.current = null
    persistInput({ ...draft, snapshot: next })
    setDraft({ ...draft, snapshot: next })
    setComparisonLatest(null)
    setDirty(true)
    setNotice('')
  }
  async function save() {
    if (!draft || !calculated.projection || busy || conflict) return
    const request = ++sequence.current.generation
    const fingerprint = balanceSaveFingerprint(draft.snapshot, draft.revision)
    if (saveAttempt.current?.fingerprint !== fingerprint)
      saveAttempt.current = { fingerprint, requestId: crypto.randomUUID() }
    const requestId = saveAttempt.current.requestId
    persistInput(draft)
    setBusy(true)
    setError(null)
    try {
      const runtime = await getRuntime()
      if (datasetId && runtime.datasetId !== datasetId)
        throw new Error(
          '接続中の保存資料が変わっています。入力を保持して画面を再読込してください。',
        )
      const saved = await saveBalanceDraft(
        runtime.csrfToken,
        draft.snapshot,
        draft.revision,
        requestId,
      )
      if (request !== sequence.current.generation) return
      setDraft({ ...saved, costDescriptions: draft.costDescriptions })
      clearRecovery(true)
      setDirty(false)
      baseDraft.current = saved
      setConflict(false)
      setComparisonLatest(null)
      saveAttempt.current = null
      setNotice('作業中の残高を保存しました。税務上の扱いの採用ではありません。')
    } catch (cause) {
      if (request !== sequence.current.generation) return
      setError(failure(cause))
      if (cause instanceof ApiRequestError && cause.status === 409) setConflict(true)
    } finally {
      if (request === sequence.current.generation) setBusy(false)
    }
  }
  async function compareLatest() {
    if (busy || !draft || !baseDraft.current) return
    const request = ++sequence.current.generation
    setBusy(true)
    setError(null)
    setComparisonLatest(null)
    try {
      const latest = await getBalanceDraft()
      if (request === sequence.current.generation) setComparisonLatest(latest)
    } catch (cause) {
      if (request === sequence.current.generation) setError(failure(cause))
    } finally {
      if (request === sequence.current.generation) setBusy(false)
    }
  }
  const sources = [
    ...(configuration?.chargePeriods ?? []).map((row) => ({
      id: 'ai:charge:' + row.id,
      label: row.planName + ' / ' + row.serviceStartedOn,
    })),
    ...planning.directCosts.map((row) => ({
      id: 'direct:' + row.id,
      label: '直接費 / ' + row.incurredOn + ' / ' + row.costType,
    })),
    ...planning.equipment.map((row) => ({ id: 'equipment:' + row.id, label: row.name })),
    ...planning.homeCosts.map((row) => ({
      id: 'home:' + row.id,
      label: row.month + ' / ' + row.category,
    })),
    ...planning.evidence.map((row) => ({ id: row.id, label: '根拠 / ' + row.note })),
  ]
  function changeKind(index: number, kind: BalanceMovement['kind']) {
    edit((snapshot) => {
      const old = snapshot.movements[index]!
      const base = {
        id: old.id,
        occurredOn: old.occurredOn,
        amountJpy: old.amountJpy,
        sourceIds: old.sourceIds,
        decisionId: old.decisionId,
        reason: old.reason,
        ...(kind === 'addition' || old.balanceAllocations === undefined
          ? {}
          : { balanceAllocations: old.balanceAllocations }),
      }
      const accountId = old.kind === 'transfer' ? old.fromAccountId : old.accountId
      snapshot.movements[index] =
        kind === 'transfer'
          ? { ...base, kind, fromAccountId: accountId, toAccountId: '' }
          : { ...base, kind, accountId }
    })
  }
  if (!local)
    return <p>残高の入力・保存はローカル版で利用できます。デモの値を残高として保存しません。</p>
  return (
    <section className="cost-page" aria-label="残高の入力と年次確認">
      {datasetId && (
        <section aria-label="ブラウザに控えた残高入力の復旧">
          {/* Outcomes and warnings stay visible even while the rarely used panel is folded. */}
          {recoveryNotice && <p role="status">{recoveryNotice}</p>}
          {recoveryError && <p role="alert">{recoveryError}</p>}
          <details open={recoveries.length > 0 || undefined}>
          <summary>前回の編集中入力を復旧（このブラウザの控え）</summary>
          <p>
            入力の控えは、このブラウザの同じ接続先に保存します。ブラウザのデータ削除や別PCへの移行では引き継がれず、DBバックアップにも含まれません。
          </p>
          <button type="button" disabled={busy} onClick={inspectRecoveries}>
            復旧できる入力を確認
          </button>
          {recoveries.map((record) => (
            <article key={record.editorId}>
              <p>
                {new Date(record.savedAt).toLocaleString('ja-JP')} / 保存元の版{' '}
                {record.base.revision} / 残高 {record.snapshot.accounts.length}件・増減{' '}
                {record.snapshot.movements.length}件・未判断{' '}
                {record.snapshot.pendingDecisions.length}件
              </p>
              <details>
                <summary>控えた入力の全内容</summary>
                <pre>
                  {JSON.stringify(
                    record.snapshot,
                    (_key, value) =>
                      typeof value === 'number' && Number.isNaN(value) ? '数値入力が空欄' : value,
                    2,
                  )}
                </pre>
              </details>
              <button
                type="button"
                disabled={busy || dirty}
                onClick={() => void recoverInput(record)}
              >
                この入力を復旧して確認
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  try {
                    if (!removeRecovery(window.localStorage, record))
                      setRecoveryError('別画面で更新されています。最新の控えを確認してください。')
                    else inspectRecoveries()
                  } catch {
                    setRecoveryError('復旧用入力を削除できませんでした。')
                  }
                }}
              >
                この控えを削除
              </button>
            </article>
          ))}
          {dirty && recoveries.length > 0 && (
            <p>現在の入力を保存するか、保存済みを読み直してから別の控えを復旧できます。</p>
          )}
          </details>
        </section>
      )}
      <p>
        記録した期首と増減を種類別に計算し、費用・判断と一緒に年度資料へ保存できます。制作物・根拠の存在と判断の対象を照合しますが、金額の由来・適用条件は未検証で、全費用の税務計算結果ではありません。
      </p>
      {error && (
        <p role="alert">
          {error} {draft && '入力中の内容はこの画面に保持しています。'}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {!draft ? (
        <>
          <p>{busy ? '残高を読み込んでいます。' : '残高を取得できていません。'}</p>
          <button disabled={busy} onClick={() => void load()}>
            残高を再読込
          </button>
        </>
      ) : (
        <>
          <div className="cost-toolbar">
            <label>
              残高を確認する年{' '}
              <input
                type="number"
                min="1900"
                max="9999"
                value={year}
                onChange={(e) => {
                  setYear(e.target.value)
                  if (dirty) persistInput(draft, baseDraft.current, e.target.value)
                }}
              />
            </label>
            <span>
              {dirty ? '保存前の入力による計算' : '保存済みの入力による計算'} / 保存版{' '}
              {draft.revision}
            </span>
            <button
              className="primary-button"
              disabled={busy || !dirty || conflict || !calculated.projection}
              onClick={() => void save()}
            >
              作業中の残高を保存
            </button>
            <button className="secondary-button" disabled={busy} onClick={() => void load()}>
              {dirty ? '入力を破棄して保存済みを読み直す' : '保存済みを読み直す'}
            </button>
          </div>
          {local && <SoftwareAcquisitionPanel datasetId={datasetId} snapshot={draft.snapshot}
            planning={planning} busy={busy || conflict} edit={edit}
            onReviewAnnualDecision={onReviewSoftwareAnnualDecision} />}
          {local && navigation?.contributionId && <TreatmentBalanceDraftPanel
            request={{ ...navigation, contributionId: navigation.contributionId }} datasetId={datasetId}
            snapshot={draft.snapshot} planning={planning} disabled={busy || conflict}
            onApply={(snapshot) => edit((current) => Object.assign(current, snapshot))}
          />}
          {conflict && (
            <div>
              <p role="alert">
                別の画面で残高が更新されています。この入力を上書き保存できません。最新の記録と比較して、残す内容を選択できます。
              </p>
              <button disabled={busy} onClick={() => void compareLatest()}>
                入力を保持して最新と比較
              </button>
            </div>
          )}
          {comparisonLatest && baseDraft.current && (
            <BalanceConflictPanel
              key={comparisonLatest.revision}
              base={baseDraft.current}
              local={draft.snapshot}
              latest={comparisonLatest}
              year={Number(year)}
              onCancel={() => setComparisonLatest(null)}
              onApply={(snapshot) => {
                if (busy) return
                baseDraft.current = comparisonLatest
                setDraft({ revision: comparisonLatest.revision, snapshot })
                setDirty(true)
                setConflict(false)
                setComparisonLatest(null)
                saveAttempt.current = null
                persistInput({ revision: comparisonLatest.revision, snapshot }, comparisonLatest)
                setError(null)
                setNotice(
                  '選択結果を入力へ反映しました。残高と参照を確認してから保存してください。',
                )
              }}
            />
          )}
          {calculated.error && <p role="alert">{calculated.error}</p>}
          <article className="panel" aria-label="残高の参照確認">
            <h2>根拠と判断の対応を確認</h2>
            <p>
              {!dirty && draft.referenceCheck
                ? '読込時の保存資料（料金・計画の版 ' +
                  draft.referenceCheck.workspaceRevision +
                  '）による照合です。'
                : '編集中の残高と画面が保持する資料による照合です。'}
              作業中の記録は問題を残して保存できますが、確認済みの年度資料として採用したことにはなりません。最新の保存資料による照合は残高の再読込で更新します。
            </p>
            {!referenceCheck ? (
              <p>照合に必要な資料を取得できていません。</p>
            ) : referenceCheck.issues.length === 0 ? (
              <p>
                参照先の存在・判断の確認状態・対象年と制作物について、不一致は見つかりませんでした。税務上の適用条件と金額の正しさの検証ではありません。
              </p>
            ) : (
              <>
                <p role="status">確認が必要な対応：{referenceCheck.issues.length}件</p>
                <ul>
                  {referenceCheck.issues.map((issue, index) => (
                    <li key={index}>
                      {issue.recordType === 'account'
                        ? '残高'
                        : issue.recordType === 'movement'
                          ? '増減'
                          : '未判断'}
                      「
                      {draft.snapshot.accounts.find((row) => row.id === issue.recordId)?.name ??
                        issue.recordId}
                      」：{issue.message}（参照：{issue.referenceId}）
                    </li>
                  ))}
                </ul>
              </>
            )}
          </article>
          {calculated.projection && (
            <article className="panel cost-overview">
              <h2>{year}年の残高増減</h2>
              <p>
                期首 ＋ 増加 ＋ 振替受入 − 振替払出 − 費用化 − その他減少 ＝
                期末。不明残高は数値の小計に含めません。
              </p>
              <dl className="cost-totals">
                <div>
                  <dt>既知の期首小計</dt>
                  <dd>{yen.format(calculated.projection.totals.knownOpeningJpy)}</dd>
                </div>
                <div>
                  <dt>既知の期末小計</dt>
                  <dd>{yen.format(calculated.projection.totals.knownClosingJpy)}</dd>
                </div>
                <div>
                  <dt>不明な残高</dt>
                  <dd>{calculated.projection.totals.unknownAccountIds.length}件</dd>
                </div>
              </dl>
              {calculated.projection.accounts.length === 0 && (
                <p>この年の残高は未登録です。残高がないと確認したことを意味しません。</p>
              )}
              {calculated.projection.accounts.map((row) => (
                <section key={row.accountId}>
                  <h3>
                    {row.name} / {kinds[row.kind]}
                  </h3>
                  <dl className="cost-totals">
                    <div>
                      <dt>期首</dt>
                      <dd>{amountText(row.opening)}</dd>
                    </div>
                    <div>
                      <dt>増加</dt>
                      <dd>{yen.format(row.additionsJpy)}</dd>
                    </div>
                    <div>
                      <dt>振替受入</dt>
                      <dd>{yen.format(row.transfersInJpy)}</dd>
                    </div>
                    <div>
                      <dt>振替払出</dt>
                      <dd>{yen.format(row.transfersOutJpy)}</dd>
                    </div>
                    <div>
                      <dt>費用化</dt>
                      <dd>{yen.format(row.expensesJpy)}</dd>
                    </div>
                    <div>
                      <dt>その他減少</dt>
                      <dd>{yen.format(row.reductionsJpy)}</dd>
                    </div>
                    <div>
                      <dt>期末</dt>
                      <dd>{amountText(row.closing)}</dd>
                    </div>
                  </dl>
                </section>
              ))}
              {calculated.projection.pendingDecisions.map((row) => (
                <p key={row.id}>
                  未判断：{amountText(row.amount)} / {row.reasons.join(' / ')}
                </p>
              ))}
            </article>
          )}
          <fieldset disabled={busy}>
            <legend>期首残高の入力</legend>
            <p>
              制作物を選び、記録を始める年の期首を入力します。購入額をそのまま期首へ入れず、根拠となる資料を確認してください。
            </p>
            {planning.taxUnits.length === 0 && (
              <button type="button" onClick={onManageUnits}>
                制作物を登録する
              </button>
            )}
            <button
              type="button"
              className="secondary-button"
              onClick={() =>
                edit((snapshot) =>
                  snapshot.accounts.push({
                    id: crypto.randomUUID(),
                    taxUnitId: '',
                    name: '',
                    kind: 'construction',
                    openingYear: planning.profile.taxYear,
                    opening: {
                      status: 'unknown',
                      amountJpy: null,
                      reasons: ['期首残高の確認待ち'],
                    },
                  }),
                )
              }
            >
              残高を追加
            </button>
            {draft.snapshot.accounts.map((account, index) => {
              const referenced =
                draft.snapshot.movements.some((m) =>
                  m.kind === 'transfer'
                    ? m.fromAccountId === account.id || m.toAccountId === account.id
                    : m.accountId === account.id,
                ) || draft.snapshot.pendingDecisions.some((p) => p.accountIds.includes(account.id))
              return (
                <article className="panel cost-source" key={account.id}>
                  <div className="cost-toolbar">
                    <label>
                      残高名{' '}
                      <input
                        value={account.name}
                        onChange={(e) =>
                          edit((s) => {
                            s.accounts[index]!.name = e.target.value
                          })
                        }
                      />
                    </label>
                    <label>
                      残高の制作物{' '}
                      <select
                        value={account.taxUnitId}
                        onChange={(e) =>
                          edit((s) => {
                            s.accounts[index]!.taxUnitId = e.target.value
                          })
                        }
                      >
                        <option value="">選択してください</option>
                        {planning.taxUnits.map((unit) => (
                          <option key={unit.id} value={unit.id}>
                            {unit.name}
                          </option>
                        ))}
                        {account.taxUnitId &&
                          !planning.taxUnits.some((u) => u.id === account.taxUnitId) && (
                            <option value={account.taxUnitId}>現在の制作物一覧にない参照</option>
                          )}
                      </select>
                    </label>
                    <label>
                      残高の種類{' '}
                      <select
                        value={account.kind}
                        onChange={(e) =>
                          edit((s) => {
                            s.accounts[index]!.kind = e.target.value as typeof account.kind
                          })
                        }
                      >
                        {Object.entries(kinds).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      記録開始年{' '}
                      <input
                        type="number"
                        value={Number.isFinite(account.openingYear) ? account.openingYear : ''}
                        min="1900"
                        max="9999"
                        onChange={(e) =>
                          edit((s) => {
                            s.accounts[index]!.openingYear = e.target.valueAsNumber
                          })
                        }
                      />
                    </label>
                    <label>
                      記録開始年の期首額{' '}
                      <input
                        type="number"
                        min="0"
                        step="1"
                        placeholder="不明"
                        value={account.opening.status === 'known' ? account.opening.amountJpy : ''}
                        onChange={(e) =>
                          edit((s) => {
                            s.accounts[index]!.opening =
                              e.target.value === ''
                                ? {
                                    status: 'unknown',
                                    amountJpy: null,
                                    reasons: ['期首残高の確認待ち'],
                                  }
                                : { status: 'known', amountJpy: e.target.valueAsNumber }
                          })
                        }
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() =>
                        edit((s) => {
                          s.accounts[index]!.opening = {
                            status: 'unknown',
                            amountJpy: null,
                            reasons: ['期首残高の確認待ち'],
                          }
                        })
                      }
                    >
                      期首額を不明に戻す
                    </button>
                    {account.opening.status === 'unknown' && (
                      <label>
                        期首額が不明な理由{' '}
                        <textarea
                          value={account.opening.reasons.join('\n')}
                          onChange={(e) =>
                            edit((s) => {
                              s.accounts[index]!.opening = {
                                status: 'unknown',
                                amountJpy: null,
                                reasons: e.target.value.split('\n'),
                              }
                            })
                          }
                        />
                      </label>
                    )}
                    <button
                      type="button"
                      disabled={referenced}
                      onClick={() =>
                        edit((s) => {
                          s.accounts.splice(index, 1)
                        })
                      }
                    >
                      この残高を削除
                    </button>
                    {referenced && (
                      <small>増減または未判断から参照されているため削除できません。</small>
                    )}
                  </div>
                </article>
              )
            })}
          </fieldset>
          <fieldset disabled={busy}>
            <legend>増減・振替の入力</legend>
            <p>金額・日付・根拠と判断を記録します。振替は移動元と移動先を一組として保存します。</p>
            {!planning.decisions.some((d) => decisionIsConfirmed(d)) && (
              <p>
                確認済みの判断記録がありません。増減の保存には判断が必要です。「月次確認」の費用画面で、扱いと根拠を記録して確認してください。
              </p>
            )}
            <button
              type="button"
              className="secondary-button"
              onClick={() =>
                edit((s) =>
                  s.movements.push({
                    id: crypto.randomUUID(),
                    kind: 'addition',
                    accountId: '',
                    occurredOn: year + '-01-01',
                    amountJpy: NaN,
                    sourceIds: [],
                    decisionId: '',
                    reason: '',
                  }),
                )
              }
            >
              増減を追加
            </button>
            {draft.snapshot.movements.map((movement, index) => (
              <article className="panel cost-source" key={movement.id}>
                <div className="cost-toolbar">
                  <label>
                    増減の種類{' '}
                    <select
                      value={movement.kind}
                      onChange={(e) => changeKind(index, e.target.value as BalanceMovement['kind'])}
                    >
                      {Object.entries(movementKinds).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    {movement.kind === 'transfer' ? '振替元' : '対象残高'}{' '}
                    <select
                      value={
                        movement.kind === 'transfer' ? movement.fromAccountId : movement.accountId
                      }
                      onChange={(e) =>
                        edit((s) => {
                          const row = s.movements[index]!
                          if (row.kind === 'transfer') row.fromAccountId = e.target.value
                          else row.accountId = e.target.value
                        })
                      }
                    >
                      <option value="">選択してください</option>
                      {draft.snapshot.accounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name || '名前未入力'}
                        </option>
                      ))}
                    </select>
                  </label>
                  {movement.kind === 'transfer' && (
                    <label>
                      振替先{' '}
                      <select
                        value={movement.toAccountId}
                        onChange={(e) =>
                          edit((s) => {
                            const row = s.movements[index]!
                            if (row.kind === 'transfer') row.toAccountId = e.target.value
                          })
                        }
                      >
                        <option value="">選択してください</option>
                        {draft.snapshot.accounts.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name || '名前未入力'}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <label>
                    増減日{' '}
                    <DateInput
                      value={movement.occurredOn}
                      onValueChange={(value) =>
                        edit((s) => {
                          s.movements[index]!.occurredOn = value
                        })
                      }
                    />
                  </label>
                  <label>
                    増減額{' '}
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={Number.isFinite(movement.amountJpy) ? movement.amountJpy : ''}
                      onChange={(e) =>
                        edit((s) => {
                          s.movements[index]!.amountJpy = e.target.valueAsNumber
                        })
                      }
                    />
                  </label>
                  <label>
                    判断記録{' '}
                    <select
                      value={movement.decisionId}
                      onChange={(e) =>
                        edit((s) => {
                          s.movements[index]!.decisionId = e.target.value
                        })
                      }
                    >
                      <option value="">選択してください</option>
                      {planning.decisions
                        .filter((d) => decisionIsConfirmed(d))
                        .map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.taxYear}年 / {d.selectedCandidate ?? d.candidate} / {d.reason}
                          </option>
                        ))}
                      {movement.decisionId &&
                        !planning.decisions.some(
                          (d) => d.id === movement.decisionId && decisionIsConfirmed(d),
                        ) && (
                          <option value={movement.decisionId}>
                            現在の確認済み判断一覧にない参照
                          </option>
                        )}
                    </select>
                  </label>
                  <label>
                    増減の理由{' '}
                    <textarea
                      value={movement.reason}
                      onChange={(e) =>
                        edit((s) => {
                          s.movements[index]!.reason = e.target.value
                        })
                      }
                    />
                  </label>
                </div>
                {movement.kind === 'addition' && (
                  <BalanceCostLinksEditor
                    movement={movement}
                    snapshot={draft.snapshot}
                    taxUnitId={
                      draft.snapshot.accounts.find((row) => row.id === movement.accountId)
                        ?.taxUnitId
                    }
                    onChange={(links, sourceIds, amountJpy) =>
                      edit((s) => {
                        const row = s.movements[index]!
                        if (row.kind === 'addition') {
                          row.costAllocations = links
                          row.sourceIds = sourceIds
                          if (amountJpy !== undefined) row.amountJpy = amountJpy
                        }
                      })
                    }
                  />
                )}
                {movement.kind !== 'addition' && (
                  <BalanceFlowEditor
                    descriptions={draft.costDescriptions?.items}
                    movement={movement}
                    snapshot={draft.snapshot}
                    onChange={(links) =>
                      edit((s) => {
                        s.movements[index]!.balanceAllocations = links
                      })
                    }
                  />
                )}
                <fieldset>
                  <legend>根拠となる費用・資料</legend>
                  {[
                    ...sources,
                    ...movement.sourceIds
                      .filter((id) => !sources.some((source) => source.id === id))
                      .map((id) => ({ id, label: '現在の一覧にない根拠参照：' + id })),
                  ].map((source) => (
                    <label key={source.id} className="balance-source-choice">
                      <input
                        type="checkbox"
                        checked={movement.sourceIds.includes(source.id)}
                        onChange={(e) =>
                          edit((s) => {
                            s.movements[index]!.sourceIds = e.target.checked
                              ? [...movement.sourceIds, source.id]
                              : movement.sourceIds.filter((id) => id !== source.id)
                          })
                        }
                      />
                      {source.label}
                    </label>
                  ))}
                </fieldset>
                <button
                  type="button"
                  onClick={() =>
                    edit((s) => {
                      s.movements.splice(index, 1)
                    })
                  }
                >
                  この増減を削除
                </button>
              </article>
            ))}
          </fieldset>
        </>
      )}
      {draft && (
        <PendingBalanceEditor
          onReviewAnswer={onReviewAnswer}
          snapshot={draft.snapshot}
          planning={planning}
          sources={sources}
          year={Number(year)}
          busy={busy}
          edit={edit}
        />
      )}
      <ReviewRecordsPanel />
      <ReviewAdoptionPanel
        datasetId={datasetId}
        year={year}
        draftRevision={draft?.revision ?? null}
        blocked={dirty || busy || conflict || !calculated.projection}
      />
    </section>
  )
}
