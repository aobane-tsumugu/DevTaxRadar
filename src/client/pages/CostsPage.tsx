import SourceAdjustmentDetails from './SourceAdjustmentDetails'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { AnnualCostProjection, CostTarget } from '../../accounting/costs'
import { getCostProjection } from '../api'
import { yen } from './shared'
import CostTracePanel from './CostTracePanel'
import EvidenceReferences, { type EvidenceExplanation } from './EvidenceReferences'

function targetName(target: CostTarget, projection: AnnualCostProjection): string {
  if (target.kind === 'tax-unit')
    return (
      projection.byTaxUnit.find((unit) => unit.taxUnitId === target.taxUnitId)?.name ??
      target.taxUnitId
    )
  return {
    general: '通常業務',
    private: '私用',
    unallocated: '未配分・配分未算定',
    unobserved: '捕捉外の利用',
    rounding: '端数調整',
  }[target.kind]
}

export default function CostsPage({
  initial,
  onEdit,
  local,
  readOnly = false,
  recordState = 'draft',
  evidence,
  adjustmentsEditor,
}: {
  adjustmentsEditor?: (projection: AnnualCostProjection) => ReactNode
  initial?: AnnualCostProjection
  onEdit: () => void
  local: boolean
  readOnly?: boolean
  recordState?: 'draft' | 'preview' | 'recorded'
  evidence?: readonly EvidenceExplanation[]
}) {
  const [projection, setProjection] = useState(initial)
  const [year, setYear] = useState(String(initial?.year ?? new Date().getFullYear()))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const request = useRef({ generation: 0 })
  useEffect(() => {
    const sequence = request.current
    sequence.generation++
    setProjection(initial)
    setYear(String(initial?.year ?? new Date().getFullYear()))
    setBusy(false)
    setError(null)
    return () => {
      sequence.generation++
    }
  }, [initial])
  async function loadYear() {
    const id = ++request.current.generation
    setBusy(true)
    setError(null)
    try {
      const next = await getCostProjection(Number(year))
      if (id === request.current.generation) setProjection(next)
    } catch (cause) {
      if (id === request.current.generation)
        setError(cause instanceof Error ? cause.message : '費用資料の読込に失敗しました。')
    } finally {
      if (id === request.current.generation) setBusy(false)
    }
  }
  const validYear = /^\d{4}$/.test(year) && Number(year) >= 1900
  return (
    <section className="cost-page" aria-label="全費用の原額と配分">
      {!readOnly && (
        <div className="cost-toolbar">
          <button className="primary-button" onClick={onEdit}>
            費用を入力・確認
          </button>
          {local && (
            <>
              <label>
                確認する年{' '}
                <input
                  type="number"
                  min="1900"
                  max="9999"
                  value={year}
                  onChange={(event) => setYear(event.target.value)}
                />
              </label>
              <button
                className="secondary-button"
                disabled={busy || !validYear}
                onClick={() => void loadYear()}
              >
                この年を表示
              </button>
            </>
          )}
        </div>
      )}
      {error && <p role="alert">{error}。表示中の資料は更新されていません。</p>}
      {!readOnly && local && projection && adjustmentsEditor?.(projection)}
      {busy ? (
        <p role="status">費用資料を読み込んでいます。</p>
      ) : !projection ? (
        <p>この表示には全費用の資料が登録されていません。</p>
      ) : (
        <>
          <article className="panel cost-overview">
            <h2>{projection.year}年の費用基礎と対応先</h2>
            <p>
              支払・購入の原額から、この年に対応する費用基礎を分けています。
              {recordState === 'recorded'
                ? '以下は指定した保存版に固定された配分資料です。'
                : recordState === 'preview'
                  ? '以下は採用前の確認用配分資料です。'
                  : '以下は作業中の配分資料です。'}
              税務上の当年費用、採用済みの資産残高とは区別してください。
            </p>
            <dl className="cost-totals">
              <div>
                <dt>算定済みの費用基礎</dt>
                <dd>{yen.format(projection.totals.knownBasisJpy)}</dd>
              </div>
              <div>
                <dt>制作物へ対応</dt>
                <dd>{yen.format(projection.totals.taxUnitJpy)}</dd>
              </div>
              <div>
                <dt>通常業務</dt>
                <dd>{yen.format(projection.totals.generalJpy)}</dd>
              </div>
              <div>
                <dt>私用</dt>
                <dd>{yen.format(projection.totals.privateJpy)}</dd>
              </div>
              <div>
                <dt>未配分・配分未算定</dt>
                <dd>{yen.format(projection.totals.unallocatedJpy)}</dd>
              </div>
              <div>
                <dt>捕捉外の利用</dt>
                <dd>{yen.format(projection.totals.unobservedJpy)}</dd>
              </div>
              <div>
                <dt>端数調整</dt>
                <dd>{yen.format(projection.totals.roundingJpy)}</dd>
              </div>
              <div>
                <dt>費用基礎が未算定</dt>
                <dd>{projection.totals.unknownBasisIds.length}件（上の金額へ含めない）</dd>
              </div>
            </dl>
            <p>
              対応先の合計は算定済みの費用基礎に一致しています。未算定の原額は次の明細に残しています。
            </p>
          </article>
          <article className="panel cost-overview">
            <h2>制作物ごとの対応額</h2>
            <ul className="cost-unit-list">
              {projection.byTaxUnit.map((unit) => (
                <li key={unit.taxUnitId}>
                  <strong>{unit.name}</strong>
                  <span>算定済み分 {yen.format(unit.amountJpy)}</span>
                  {unit.unknownBasisIds.length > 0 && (
                    <span>
                      この制作物に関連する費用基礎が未算定 {unit.unknownBasisIds.length}件
                    </span>
                  )}
                </li>
              ))}
            </ul>
            {!projection.byTaxUnit.length && (
              <p>制作物はまだ登録されていません。対応先が不明な支払も保持します。</p>
            )}
          </article>
          <h2>原額・期間・配分の明細</h2>
          <CostTracePanel projection={projection} evidence={evidence} />
          {!projection.sources.length && (
            <p>{projection.year}年に対応する費用源がありません。他の年の記録は削除していません。</p>
          )}
          {projection.sources.map((source) => (
            <article className="panel cost-source" key={source.id}>
              <h3>{source.label}</h3>
              <p>
                <strong>
                  {source.kind === 'opening-balance' ? '入力された旧版残高' : '支払・購入の原額'}{' '}
                  {source.originalAmountJpy === null
                    ? '不明'
                    : yen.format(source.originalAmountJpy)}
                </strong>
              </p>
              {source.unknownOriginalAmountReasons?.map((reason, index) => (
                <p key={index}>原額が不明な理由：{reason}</p>
              ))}
              {source.servicePeriod && (
                <p>
                  利用期間 {source.servicePeriod.startedOn} ～ {source.servicePeriod.endedOn}
                </p>
              )}
              {source.incurredOn && <p>発生日 {source.incurredOn}</p>}
              {source.acquiredOn && <p>取得日 {source.acquiredOn}</p>}
              {source.billedOn && <p>請求日 {source.billedOn}</p>}
              <p>証拠参照 {source.evidenceIds.length}件 / 原額を費用基礎へ重ねて加算しません。</p>
              <EvidenceReferences ids={source.evidenceIds} records={evidence} />
              <SourceAdjustmentDetails records={source.adjustments ?? []} />
              {projection.bases
                .filter((basis) => basis.sourceId === source.id)
                .map((basis) => (
                  <div className="cost-basis" key={basis.id}>
                    <h4>
                      {basis.period.startedOn} ～ {basis.period.endedOn} の費用基礎
                    </h4>
                    <p>
                      <strong>
                        {basis.amount.status === 'known'
                          ? yen.format(basis.amount.amountJpy)
                          : '未算定'}
                      </strong>
                    </p>
                    {basis.amount.status === 'unknown' && (
                      <ul>
                        {basis.amount.reasons.map((reason) => (
                          <li key={reason}>{reason}</li>
                        ))}
                      </ul>
                    )}
                    <p>{basis.method.explanation}</p>
                    {basis.warnings.length > 0 && (
                      <ul>
                        {basis.warnings.map((warning, index) => (
                          <li key={index}>{warning}</li>
                        ))}
                      </ul>
                    )}
                    <ul className="cost-contributions">
                      {projection.contributions
                        .filter((item) => item.basisId === basis.id)
                        .map((item) => (
                          <li key={item.id}>
                            <span>{targetName(item.target, projection)}</span>
                            <strong>{yen.format(item.amountJpy)}</strong>
                            <p>{item.reason}</p>
                            {item.consumedByBasisId && (
                              <p>別の費用基礎へ組入れ済み。上の対応先合計へ二重加算しません。</p>
                            )}
                          </li>
                        ))}
                    </ul>
                    <details>
                      <summary>計算の参照情報</summary>
                      <p>費用源: {source.id}</p>
                      <p>費用基礎: {basis.id}</p>
                      <p>
                        方法: {basis.method.id} / {basis.method.version}
                      </p>
                      <p>証拠: {source.evidenceIds.join('、') || '未登録'}</p>
                    </details>
                  </div>
                ))}
            </article>
          ))}
          {projection.bases
            .filter((basis) => basis.parentContributionIds.length > 0)
            .map((basis) => (
              <article className="panel cost-source" key={basis.id}>
                <h3>寄与から組み入れた費用基礎</h3>
                <p>
                  {basis.period.startedOn} ～ {basis.period.endedOn}
                </p>
                <p>{basis.method.explanation}</p>
                <p>
                  {basis.amount.status === 'known' ? yen.format(basis.amount.amountJpy) : '未算定'}
                </p>
                <ul>
                  {projection.contributions
                    .filter((item) => item.basisId === basis.id)
                    .map((item) => (
                      <li key={item.id}>
                        {targetName(item.target, projection)} {yen.format(item.amountJpy)} / 出典{' '}
                        {item.sourceIds.join('、')}
                      </li>
                    ))}
                </ul>
                <details>
                  <summary>組入れ元</summary>
                  <p>{basis.parentContributionIds.join('、')}</p>
                </details>
              </article>
            ))}
        </>
      )}
    </section>
  )
}
