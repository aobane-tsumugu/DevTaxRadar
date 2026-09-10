import type { AnnualCostProjection } from '../../accounting/costs'
import { yen } from './shared'

export default function AnnualOverview({ year, projection, onOpenCosts, showAiFilterNote = true }: {
  year: number
  projection?: AnnualCostProjection
  onOpenCosts?: () => void
  showAiFilterNote?: boolean
}) {
  const current = projection?.year === year ? projection : undefined
  return <section className="panel cost-overview" aria-label="対象年の全費用と未確定の処理">
    <h2>{year}年の費用と、これから確認する扱い</h2>
    <p>AI料金・設備・自宅費用・直接費を同じ計算から表示します。費用基礎は、採用済みの当年費用・資産残高とは別です。
      {showAiFilterNote && 'AIサービス・制作物の絞込みはAI内訳だけに適用します。'}</p>
    {current ? <dl className="cost-totals">
      <div><dt>算定済みの費用基礎</dt><dd>{yen.format(current.totals.knownBasisJpy)}</dd></div>
      <div><dt>制作物に対応する算定済み分</dt><dd>{yen.format(current.totals.taxUnitJpy)}</dd></div>
      <div><dt>通常業務に対応する算定済み分</dt><dd>{yen.format(current.totals.generalJpy)}</dd></div>
      <div><dt>未配分・捕捉外の算定済み分</dt><dd>{yen.format(current.totals.unallocatedJpy + current.totals.unobservedJpy)}</dd></div>
      <div><dt>費用基礎が未算定</dt><dd>{current.totals.unknownBasisIds.length}件（小計に含めない）</dd></div>
    </dl> : <p role="status">{year}年の全費用資料が取得できていません。別の年やAI料金だけの金額では補いません。</p>}
    <p>処理方法・適用条件と実際の用途を確認し、年度資料へ結びます。原額や費用基礎をそのまま将来残高へ写しません。採用済みの額は「残高と繰越し」の指定版を確認してください。</p>
    {onOpenCosts && <button className="secondary-button" onClick={onOpenCosts}>原額・配分・未算定理由を見る</button>}
  </section>
}
