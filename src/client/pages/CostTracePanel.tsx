import { useId, useMemo, useState } from 'react'
import type { AnnualCostProjection, CostTarget } from '../../accounting/costs'
import { traceCost } from '../../core/costTrace'
import { yen } from './shared'
import './CostTracePanel.css'
import EvidenceReferences, { type EvidenceExplanation } from './EvidenceReferences'

function targetName(target: CostTarget, projection: AnnualCostProjection) {
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
export default function CostTracePanel({
  projection,
  evidence,
  initialContributionId,
}: {
  projection: AnnualCostProjection
  initialContributionId?: string
  evidence?: readonly EvidenceExplanation[]
}) {
  const traceId = useId()
  const options = useMemo(
    () => [
      ...projection.contributions
        .filter((item) => !item.consumedByBasisId)
        .map((item, index) => ({
          kind: 'contribution' as const,
          id: item.id,
          key: `contribution:${item.id}`,
          label: `${index + 1}. ${targetName(item.target, projection)} / ${yen.format(item.amountJpy)} / ${item.sourceIds.map((id) => projection.sources.find((source) => source.id === id)?.label ?? '参照先不明').join('、')} / ${projection.bases.find((basis) => basis.id === item.basisId)?.period.startedOn ?? '期間不明'}`,
        })),
      ...projection.bases
        .filter((basis) => basis.amount.status === 'unknown')
        .map((basis) => ({
          kind: 'basis' as const,
          id: basis.id,
          key: `basis:${basis.id}`,
          label: `未算定 / ${projection.sources.find((source) => source.id === basis.sourceId)?.label ?? '組入れた費用'} / ${basis.period.startedOn}～${basis.period.endedOn}`,
        })),
    ],
    [projection],
  )
  const [selected, setSelected] = useState(
    initialContributionId ? `contribution:${initialContributionId}` : '',
  )
  const choice = options.find((option) => option.key === selected)
  const trace = choice ? traceCost(projection, choice) : null
  return (
    <section className="panel cost-trace" aria-label="金額の由来をたどる">
      <h2>この金額はどこから来たか</h2>
      <p>
        確認したい対応額または未算定の基礎を選ぶと、この表示資料の参照関係を元の支払から順に示します。各段階の金額を足し合わせると重複するため、合計しません。
      </p>
      <label>
        確認する金額・未算定項目
        <select value={choice?.key ?? ''} onChange={(event) => setSelected(event.target.value)}>
          <option value="">選択してください</option>
          {options.map((option) => (
            <option key={option.key} value={option.key}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      {choice && <p className="cost-trace-selection">選択中：{choice.label}</p>}
      {!options.length && <p>たどれる対応額・未算定の基礎は登録されていません。</p>}
      {trace && (
        <>
          {trace.issues.length > 0 && (
            <div role="alert">
              {trace.issues.map((issue) => (
                <p key={issue}>{issue}</p>
              ))}
            </div>
          )}
          <ol aria-label="支払から対応額までの参照経路">
            {trace.nodes.map((node, index) => (
              <li key={node.key} id={`${traceId}-${index}`}>
                {node.kind === 'source' ? (
                  <>
                    <h3>元の支払・購入：{node.record.label}</h3>
                    <p>
                      原額{' '}
                      {node.record.originalAmountJpy === null
                        ? '不明'
                        : yen.format(node.record.originalAmountJpy)}
                    </p>
                    {node.record.unknownOriginalAmountReasons?.map((reason) => (
                      <p key={reason}>{reason}</p>
                    ))}
                    {node.record.servicePeriod && (
                      <p>
                        利用期間 {node.record.servicePeriod.startedOn} ～{' '}
                        {node.record.servicePeriod.endedOn}
                      </p>
                    )}
                    {node.record.billedOn && <p>請求日 {node.record.billedOn}</p>}
                    {node.record.paidOn && <p>支払日 {node.record.paidOn}</p>}
                    {node.record.acquiredOn && <p>取得日 {node.record.acquiredOn}</p>}
                    <EvidenceReferences ids={node.record.evidenceIds} records={evidence} />
                  </>
                ) : node.kind === 'basis' ? (
                  <>
                    <h3>期間別の費用基礎</h3>
                    <p>
                      {node.record.period.startedOn} ～ {node.record.period.endedOn}
                    </p>
                    <p>
                      {node.record.amount.status === 'known'
                        ? yen.format(node.record.amount.amountJpy)
                        : '未算定'}
                    </p>
                    {node.record.amount.status === 'unknown' &&
                      node.record.amount.reasons.map((reason) => <p key={reason}>{reason}</p>)}
                    <p>計算方法：{node.record.method.explanation}</p>
                    <p>
                      方法の識別：{node.record.method.id} / {node.record.method.version}
                    </p>
                    {node.record.warnings.map((warning, index) => (
                      <p key={index}>{warning}</p>
                    ))}
                  </>
                ) : (
                  <>
                    <h3>
                      {node.record.consumedByBasisId
                        ? '次の費用基礎へ組み入れる配分'
                        : '最終の対応額'}
                      ：{targetName(node.record.target, projection)}
                    </h3>
                    <p>{yen.format(node.record.amountJpy)}</p>
                    <p>対応の理由：{node.record.reason}</p>
                    <EvidenceReferences ids={node.record.evidenceIds} records={evidence} />
                    {node.record.consumedByBasisId && (
                      <p>
                        組入れ先：{node.record.consumedByBasisId}
                        。最終の対応額へ重ねて加算しません。
                      </p>
                    )}
                  </>
                )}
                <p>参照ID：{node.key}</p>
                {node.inputs.length > 0 && (
                  <p>
                    この段階の元：
                    {node.inputs.map((input, inputIndex) => {
                      const position = trace.nodes.findIndex((candidate) => candidate.key === input)
                      return (
                        <span key={input}>
                          {inputIndex > 0 ? '、' : ''}
                          {position < 0 ? (
                            input
                          ) : (
                            <a href={`#${traceId}-${position}`}>第{position + 1}段階</a>
                          )}
                        </span>
                      )
                    })}
                  </p>
                )}
              </li>
            ))}
          </ol>
          <p>
            証拠IDの表示は、原本の内容や税務上の適用条件を確認済みとするものではありません。保存資料にない情報を最新データで補いません。
          </p>
        </>
      )}
    </section>
  )
}
