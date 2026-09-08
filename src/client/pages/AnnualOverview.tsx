import type { AnnualCostProjection } from '../../accounting/costs'
import { yen } from './shared'

export default function AnnualOverview({
  year,
  projection,
  onOpenCosts,
  showAiFilterNote = true,
}: {
  year: number
  projection?: AnnualCostProjection
  onOpenCosts: () => void
  showAiFilterNote?: boolean
}) {
  const current = projection?.year === year ? projection : undefined
  return (
    <section className="panel cost-overview" aria-label="対象年の全費用と未確定の処理">
      <h2>{year}年の費用と、これから確認する扱い</h2>
      <p>
        AI料金・設備・自宅費用・直接費の資料です。算定済みの費用基礎は、税務上の当年費用や採用済み残高とは異なります。
        {showAiFilterNote && 'AIサービス・制作物の絞込みは下のAI内訳だけに適用します。'}
      </p>
      {current ? (
        <dl className="cost-totals">
          <div>
            <dt>算定済みの費用基礎</dt>
            <dd>{yen.format(current.totals.knownBasisJpy)}</dd>
          </div>
          <div>
            <dt>制作物に対応する算定済み分</dt>
            <dd>{yen.format(current.totals.taxUnitJpy)}</dd>
          </div>
          <div>
            <dt>通常業務に対応する算定済み分</dt>
            <dd>{yen.format(current.totals.generalJpy)}</dd>
          </div>
          <div>
            <dt>費用基礎が未算定</dt>
            <dd>{current.totals.unknownBasisIds.length}件（小計に含めない）</dd>
          </div>
        </dl>
      ) : (
        <p role="status">
          {year}年の全費用資料が取得できていません。別の年やAI料金だけの金額では補いません。
        </p>
      )}
      <dl className="cost-totals">
        <div>
          <dt>税務上の当年費用</dt>
          <dd>未算定</dd>
        </div>
        <div>
          <dt>全費用の処理から算定する翌期残高</dt>
          <dd>未算定</dd>
        </div>
      </dl>
      <p>
        全費用について処理方法・適用条件・利用開始等の事実を結び、当年費用と翌期残高を自動生成する処理は未完了です。採用済みの残高記録は別の資料として確認します。
      </p>
      <button className="secondary-button" onClick={onOpenCosts}>
        原額・配分・未算定理由を見る
      </button>
    </section>
  )
}
