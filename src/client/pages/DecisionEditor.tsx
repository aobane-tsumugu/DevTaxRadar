import type { DecisionRecord, TaxUnitRecord } from '../../planning/types'
import type { ConsultationNavigation } from '../consultationNavigation'
import {
  decisionIsConfirmed,
  MANUAL_DECISION_VERSION,
  reviseDecision,
} from '../../core/decisionConfirmation'
export default function DecisionEditor({
  value,
  units,
  year,
  onChange,
  consultation,
}: {
  value: DecisionRecord[]
  units: TaxUnitRecord[]
  year: number
  onChange: (value: DecisionRecord[]) => void
  consultation?: ConsultationNavigation
}) {
  function edit(index: number, patch: Parameters<typeof reviseDecision>[1]) {
    onChange(value.map((row, i) => (i === index ? reviseDecision(row, patch) : row)))
  }
  return (
    <section className="cost-editor" aria-label="処理の判断記録">
      <h4>扱いを判断した記録</h4>
      {consultation && (
        <div>
          <p>
            回答の対象：
            {units.find((unit) => unit.id === consultation.taxUnitId)?.name ?? '制作物未確認'} /{' '}
            {consultation.answer.taxYear}
            年。既存の判断を見直すか、この対象に未確認の判断を追加できます。
          </p>
          <button
            type="button"
            disabled={
              !units.some((unit) => unit.id === consultation.taxUnitId) ||
              !Number.isInteger(consultation.answer.taxYear) ||
              consultation.answer.taxYear < 2000 ||
              consultation.answer.taxYear > 2100
            }
            onClick={() =>
              onChange([
                ...value,
                {
                  id: crypto.randomUUID(),
                  taxUnitId: consultation.taxUnitId,
                  taxYear: consultation.answer.taxYear,
                  engineVersion: MANUAL_DECISION_VERSION,
                  candidate: '',
                  status: 'pending',
                  createdAt: new Date().toISOString(),
                },
              ])
            }
          >
            この回答の対象に判断記録を追加
          </button>
        </div>
      )}
      <p>
        検討した扱い、確認した扱い、根拠・確認先を残します。本人による確認の記録であり、DevTaxが適用条件を自動検証した結果ではありません。内容を変えると未確認へ戻ります。
      </p>
      <button
        type="button"
        className="secondary-button"
        onClick={() =>
          onChange([
            ...value,
            {
              id: crypto.randomUUID(),
              taxUnitId: '',
              taxYear: year,
              engineVersion: MANUAL_DECISION_VERSION,
              candidate: '',
              status: 'pending',
              createdAt: new Date().toISOString(),
            },
          ])
        }
      >
        判断記録を追加
      </button>
      {value.map((row, index) => {
        const ready = Boolean(
          row.taxUnitId &&
          units.some((unit) => unit.id === row.taxUnitId) &&
          row.candidate.trim() &&
          row.selectedCandidate?.trim() &&
          row.reason?.trim() &&
          Number.isInteger(row.taxYear) &&
          row.taxYear >= 2000 &&
          row.taxYear <= 2100,
        )
        return (
          <article
            className="cost-source panel"
            key={row.id}
            data-consultation-decision={row.taxUnitId + ':' + row.taxYear}
          >
            <div className="cost-toolbar">
              <label>
                判断する制作物{' '}
                <select
                  value={row.taxUnitId}
                  onChange={(e) => edit(index, { taxUnitId: e.target.value })}
                >
                  <option value="">選択してください</option>
                  {units.map((unit) => (
                    <option key={unit.id} value={unit.id}>
                      {unit.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                判断の対象年{' '}
                <input
                  type="number"
                  min="2000"
                  max="2100"
                  value={Number.isFinite(row.taxYear) ? row.taxYear : ''}
                  onChange={(e) => edit(index, { taxYear: e.target.valueAsNumber })}
                />
              </label>
              <label>
                検討した扱い{' '}
                <input
                  value={row.candidate}
                  onChange={(e) => edit(index, { candidate: e.target.value })}
                />
              </label>
              <label>
                確認した扱い{' '}
                <input
                  value={row.selectedCandidate ?? ''}
                  onChange={(e) => edit(index, { selectedCandidate: e.target.value || undefined })}
                />
              </label>
              <label>
                判断の根拠・確認先{' '}
                <textarea
                  value={row.reason ?? ''}
                  onChange={(e) => edit(index, { reason: e.target.value || undefined })}
                />
              </label>
            </div>
            <p>
              {decisionIsConfirmed(row)
                ? '本人確認済み'
                : '未確認：必要な項目を記入して確認してください。'}
            </p>
            <button
              type="button"
              className="secondary-button"
              disabled={!ready || decisionIsConfirmed(row)}
              onClick={() =>
                onChange(
                  value.map((item, i) =>
                    i === index
                      ? {
                          ...item,
                          engineVersion: MANUAL_DECISION_VERSION,
                          status:
                            item.candidate === item.selectedCandidate ? 'confirmed' : 'overridden',
                          confirmedAt: new Date().toISOString(),
                        }
                      : item,
                  ),
                )
              }
            >
              この判断内容を確認した
            </button>
            <button
              type="button"
              disabled={!decisionIsConfirmed(row)}
              onClick={() => edit(index, {})}
            >
              判断を未確認に戻す
            </button>
            <p>
              この記録は「ここまで保存」または最終保存で料金・計画と一緒に保存します。残高の採用版とは別の記録です。
            </p>
          </article>
        )
      })}
    </section>
  )
}
