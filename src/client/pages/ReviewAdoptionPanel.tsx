import ConsultationAnswersPanel from './ConsultationAnswersPanel'
import HomeAllocationPanel from './HomeAllocationPanel'
import BalanceFlowPanel from './BalanceFlowPanel'
import BalanceLotTracePanel from './BalanceLotTracePanel'
import OpeningLotCarryPanel from './OpeningLotCarryPanel'
import DirectAllocationPanel from './DirectAllocationPanel'
import EquipmentCalculationsPanel from './EquipmentCalculationsPanel'
import EquipmentAllocationPanel from './EquipmentAllocationPanel'
import { useEffect, useRef, useState } from 'react'
import type { BalancePreview, BalanceReview } from '../../accounting/balanceWorkspace'
import { ApiRequestError, adoptReview, getBalancePreview, getRuntime } from '../api'
import CostsPage from './CostsPage'
import BalanceCostProvenancePanel from './BalanceCostProvenancePanel'
import { yen } from './shared'
import {
  readReviewAttempts,
  writeReviewAttempt,
  removeReviewAttempt,
  type ReviewAttempt,
} from '../reviewRecovery'

export default function ReviewAdoptionPanel({
  year,
  draftRevision,
  blocked,
  datasetId,
}: {
  year: string
  draftRevision: number | null
  blocked: boolean
  datasetId?: string
}) {
  const [preview, setPreview] = useState<BalancePreview | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState<BalanceReview | null>(null)
  const [attempts, setAttempts] = useState<ReviewAttempt[]>([])
  const [recoveryMessage, setRecoveryMessage] = useState('')
  const persisted = useRef<ReviewAttempt | null>(null)
  const lifetime = useRef({ generation: 0 })
  const retry = useRef<{ fingerprint: string; key: string } | null>(null)
  useEffect(() => {
    setAttempts([])
    setRecoveryMessage('')
    persisted.current = null
  }, [datasetId])
  useEffect(() => {
    const state = lifetime.current
    state.generation++
    setPreview(null)
    setSaved(null)
    setError('')
    setBusy(false)
    retry.current = null
    return () => {
      state.generation++
    }
  }, [year, draftRevision, datasetId])
  function inspectAttempts() {
    if (!datasetId) return
    try {
      const result = readReviewAttempts(window.localStorage, datasetId)
      setAttempts(result.records)
      setRecoveryMessage(
        result.unreadable
          ? '読めない形式の控えがあります。削除せず保持しています。'
          : result.records.length
            ? ''
            : '保存結果の確認が必要な控えはありません。',
      )
    } catch {
      setRecoveryMessage('ブラウザの控えを読み取れません。')
    }
  }
  async function send(
    content: ReviewAttempt['request'],
    generation: number,
    recovered?: ReviewAttempt,
  ) {
    const runtime = await getRuntime()
    if (generation !== lifetime.current.generation) return
    if (datasetId && runtime.datasetId !== datasetId)
      throw new Error('接続先のデータが変わっています。再読込してください。')
    let record = recovered
    if (datasetId) {
      if (!record) {
        if (persisted.current?.request.idempotencyKey !== content.idempotencyKey)
          persisted.current = {
            version: 1,
            datasetId,
            createdAt: new Date().toISOString(),
            request: content,
          }
        record = persisted.current!
      }
      try {
        writeReviewAttempt(window.localStorage, record)
      } catch {
        throw new Error(
          '保存要求の控えをブラウザへ記録できないため送信していません。ブラウザの保存領域を確認してください。',
        )
      }
    }
    const result = await adoptReview(runtime.csrfToken, {
      ...content,
      ...(datasetId ? { expectedDatasetId: datasetId } : {}),
    })
    let cleanupFailed = false
    if (record) {
      try {
        removeReviewAttempt(window.localStorage, record)
      } catch {
        cleanupFailed = true
      }
    }
    if (generation !== lifetime.current.generation) return
    setSaved(result.review)
    setPreview(null)
    retry.current = null
    if (record)
      setAttempts((current) =>
        current.filter((item) => item.request.idempotencyKey !== record.request.idempotencyKey),
      )
    setRecoveryMessage(
      cleanupFailed
        ? '年度資料は保存済みですが、ブラウザの控えを削除できませんでした。同じ要求の再試行で重複保存はしません。'
        : '',
    )
  }
  async function resume(record: ReviewAttempt) {
    if (busy || blocked || record.datasetId !== datasetId) return
    const generation = ++lifetime.current.generation
    setBusy(true)
    setError('')
    setSaved(null)
    setPreview(null)
    setReason(record.request.reason)
    try {
      await send(record.request, generation, record)
    } catch (cause) {
      if (generation === lifetime.current.generation)
        setError(cause instanceof Error ? cause.message : '保存結果を確認できませんでした。')
    } finally {
      if (generation === lifetime.current.generation) setBusy(false)
    }
  }
  const validYear = /^\d{4}$/.test(year) && Number(year) >= 1900 && Number(year) <= 9999
  const matches =
    preview?.projection.year === Number(year) && preview?.draftRevision === draftRevision
  const canAdopt =
    matches &&
    !blocked &&
    preview?.previousReviewChainChanged !== true &&
    preview?.snapshot &&
    preview.materials?.referenceCheck.status === 'consistent' &&
    preview.materials?.costLinks?.check.status !== 'invalid' &&
    preview.materials?.balanceFlowCheck?.status !== 'invalid' &&
    preview.materials?.balanceLotTrace?.status !== 'invalid' &&
    preview.materials?.openingLotCarry?.status !== 'invalid' &&
    !preview.materials?.costPresenceCheck?.items.some((row) => row.status === 'conflict') &&
    !preview.materials?.equipmentCarryCheck?.rows.some((row) => row.status === 'mismatch')
  async function inspect() {
    const generation = ++lifetime.current.generation
    setBusy(true)
    setError('')
    setPreview(null)
    setSaved(null)
    retry.current = null
    try {
      const result = await getBalancePreview(Number(year))
      if (generation === lifetime.current.generation) setPreview(result)
    } catch (cause) {
      if (generation === lifetime.current.generation)
        setError(cause instanceof Error ? cause.message : '確認資料を取得できませんでした。')
    } finally {
      if (generation === lifetime.current.generation) setBusy(false)
    }
  }
  async function adopt() {
    if (!preview || !canAdopt || !reason.trim() || busy) return
    const generation = ++lifetime.current.generation
    const content = {
      year: Number(year),
      expectedDraftRevision: preview.draftRevision,
      projectionHash: preview.projectionHash,
      reason: reason.trim(),
    }
    const fingerprint = JSON.stringify(content)
    if (retry.current?.fingerprint !== fingerprint)
      retry.current = { fingerprint, key: crypto.randomUUID() }
    const idempotencyKey = retry.current.key
    setBusy(true)
    setError('')
    try {
      await send({ ...content, idempotencyKey }, generation)
    } catch (cause) {
      if (generation !== lifetime.current.generation) return
      setError(cause instanceof Error ? cause.message : '年度資料を保存できませんでした。')
      if (cause instanceof ApiRequestError && cause.status === 409) {
        setPreview(null)
        retry.current = null
      }
    } finally {
      if (generation === lifetime.current.generation) setBusy(false)
    }
  }
  return (
    <section className="panel" aria-label="年度資料の採用と訂正">
      <h2>{year}年の年度資料を確認して残す</h2>
      <p>
        費用・判断・利用量・残高と未算定の状態を、その時点の資料として固定します。税務上の適用条件・金額の由来が検証済みになる操作ではありません。既存版がある年は元の版を残した訂正版になります。
      </p>
      {datasetId && (
        <section aria-label="年度資料の保存要求の復旧">
          <h3>前回の保存結果を確認する</h3>
          <p>
            送信前に保存要求をこのブラウザの同じ接続先へ控えます。再試行は、保存済みならその資料を返し、未保存なら確認時の版と一致する場合だけ保存します。入力途中の理由や資料全体のバックアップではありません。
          </p>
          <button disabled={busy} onClick={inspectAttempts}>
            前回の保存要求を確認
          </button>
          {recoveryMessage && <p role="status">{recoveryMessage}</p>}
          {attempts.map((record) => (
            <article key={record.request.idempotencyKey}>
              <p>
                {record.request.year}年 / 残高入力の版 {record.request.expectedDraftRevision} /{' '}
                {record.createdAt}
              </p>
              <p>理由：{record.request.reason}</p>
              <details>
                <summary>保存要求の全内容</summary>
                <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                  {JSON.stringify(record.request, null, 2)}
                </pre>
              </details>
              <button disabled={busy || blocked} onClick={() => void resume(record)}>
                同じ保存要求を再試行
              </button>
              <button
                disabled={busy}
                onClick={() => {
                  try {
                    removeReviewAttempt(window.localStorage, record)
                    inspectAttempts()
                  } catch {
                    setRecoveryMessage('控えを削除できませんでした。')
                  }
                }}
              >
                この要求の控えを削除
              </button>
              <p>
                控えの削除は保存済み年度資料を取り消しません。再試行で版の変更が通知された場合は、資料を確認し直してください。
              </p>
            </article>
          ))}
        </section>
      )}
      {blocked && (
        <p>入力中の残高を保存し、入力エラーや競合を解消してから年度資料を確認してください。</p>
      )}
      <button
        disabled={busy || blocked || !validYear || draftRevision === null}
        onClick={() => void inspect()}
      >
        保存する年度資料を確認
      </button>
      {error && <p role="alert">{error}</p>}
      {saved && (
        <p role="status">
          {saved.year}年の{saved.correctsReviewId ? '訂正版' : '年度資料'}を保存しました。資料ID：
          {saved.id}。
          <a
            href={
              '/api/balances/reviews/' + encodeURIComponent(saved.id) + '/export?format=markdown'
            }
            download
          >
            保存した資料をダウンロード
          </a>
        </p>
      )}
      {preview && (
        <>
          {!matches && (
            <p role="alert">残高の保存版が変わっています。残高を読み直して確認してください。</p>
          )}
          <p>
            残高入力の版 {preview.draftRevision} / 料金・計画の版{' '}
            {preview.materials?.workspaceRevision ?? '未取得'}
          </p>
          <p>
            訂正元：{preview.currentReviewId ?? 'なし'} / 前年資料：
            {preview.previousReviewId ?? 'なし'}
          </p>
          {preview.previousReviewChainChanged && (
            <section aria-label="過年度訂正の未反映">
              <p role="alert">
                過年度の訂正が前年資料に未反映のため、この年度資料は採用できません。古い年度から順に内容を確認して訂正版を採用し、この確認資料を読み直してください。入力した理由は保持されます。
              </p>
              {preview.previousReviewChanges?.map((change) => (
                <p key={change.referencingYear}>
                  {change.year}年の変更が{change.referencingYear}年資料に未反映です。
                  参照していた版：{change.storedReviewId ?? 'なし'} ／ 現在の版：
                  {change.currentReviewId ?? 'なし'}
                </p>
              ))}
            </section>
          )}
          <p>
            既知の期首小計：{yen.format(preview.projection.totals.knownOpeningJpy)} /
            既知の期末小計：{yen.format(preview.projection.totals.knownClosingJpy)} / 不明な残高：
            {preview.projection.totals.unknownAccountIds.length}件
          </p>
          {!preview.projection.accounts.length && (
            <p>対象年の残高は未登録です。残高がないとの確認ではありません。</p>
          )}
          {preview.snapshot && (
            <ConsultationAnswersPanel
              requireQuestionBasis
              snapshot={preview.snapshot}
              year={preview.projection.year}
            />
          )}
          {preview.materials ? (
            <>
              <CostsPage
                initial={preview.materials.costs}
                evidence={preview.materials.planning.evidence}
                recordState="preview"
                local
                readOnly
                onEdit={() => {}}
              />
              <EquipmentCalculationsPanel
                rows={preview.materials.equipmentCalculations}
                carry={preview.materials.equipmentCarryCheck}
              />
              <HomeAllocationPanel
                year={preview.projection.year}
                costs={preview.materials.planning.homeCosts}
                units={preview.materials.planning.taxUnits}
              />
              <DirectAllocationPanel
                year={preview.projection.year}
                costs={preview.materials.planning.directCosts}
                units={preview.materials.planning.taxUnits}
              />
              <EquipmentAllocationPanel
                year={preview.projection.year}
                methods={preview.materials.planning.equipmentMethods}
                equipment={preview.materials.planning.equipment}
                taxUnits={preview.materials.planning.taxUnits}
              />
              {preview.materials.costLinks && (
                <BalanceCostProvenancePanel check={preview.materials.costLinks.check} />
              )}
              <OpeningLotCarryPanel carry={preview.materials.openingLotCarry} />
              <BalanceLotTracePanel
                trace={preview.materials.balanceLotTrace}
                costs={preview.materials.costLinks?.costs ?? [preview.materials.costs]}
              />
              <BalanceFlowPanel
                costs={preview.materials.costLinks?.costs ?? [preview.materials.costs]}
                check={preview.materials.balanceFlowCheck}
                snapshot={preview.snapshot}
              />
              <h3>固定する判断</h3>
              <h4>年度別の費用項目確認</h4>
              {preview.materials.costPresenceCheck ? (
                <ul>
                  {preview.materials.costPresenceCheck.items.map((row) => (
                    <li key={row.category} role={row.status === 'conflict' ? 'alert' : undefined}>
                      {row.taxYear}年 / {row.label}:{' '}
                      {
                        {
                          unreviewed: '未確認',
                          'has-records': '対象記録あり',
                          'not-applicable': '該当なし（本人記録）',
                          deferred: '保留',
                          conflict: '不一致・採用不可',
                        }[row.status]
                      }
                      <br />
                      {row.explanation}
                      {row.declaration && ` 理由: ${row.declaration.reason}`}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>この資料には年度別判定がありません。確認済みとは扱いません。</p>
              )}
              <p>
                保留や未確認はその状態で資料に残します。採用は税務条件の確認完了ではありません。
              </p>
              <ul>
                {preview.materials.planning.decisions.map((decision) => (
                  <li key={decision.id}>
                    {decision.taxYear}年 / {decision.selectedCandidate ?? decision.candidate} /{' '}
                    {decision.reason ?? '根拠未登録'}
                  </li>
                ))}
              </ul>
              {preview.materials.referenceCheck.issues.length > 0 && (
                <div role="alert">
                  <p>参照の問題を解消してから保存してください。</p>
                  <ul>
                    {preview.materials.referenceCheck.issues.map((issue, index) => (
                      <li key={index}>
                        {issue.recordId}：{issue.message}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          ) : (
            <p role="alert">費用・判断の資料を取得できていないため保存できません。</p>
          )}
          <details>
            <summary>保存対象の全入力・計算結果を確認</summary>
            <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
              {JSON.stringify(preview, null, 2)}
            </pre>
          </details>
          <label>
            この内容を残す理由・訂正の理由
            <textarea
              maxLength={2000}
              disabled={busy}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          <button disabled={busy || !canAdopt || !reason.trim()} onClick={() => void adopt()}>
            {preview.currentReviewId
              ? 'この内容を訂正版として保存'
              : 'この内容を年度資料として保存'}
          </button>
        </>
      )}
    </section>
  )
}
