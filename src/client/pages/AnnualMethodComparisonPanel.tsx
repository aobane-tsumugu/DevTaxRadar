import type { AnnualMethodComparison } from '../../core/annualMethodComparison'
import { yen } from './shared'
export const annualMethodLabels = {
  'straight-line': '普通定額法', 'immediate-expense': '10万円未満の必要経費',
  'three-year-pool': '3年一括償却', 'blue-special': '青色申告者の少額資産特例',
}
export default function AnnualMethodComparisonPanel({ reports }: { reports?: AnnualMethodComparison[] }) {
  if (!reports?.length) return null
  return <section className="panel" aria-label="方法別の条件付き年次比較">
    <h3>資産全体の年次比較</h3>
    <p>業務・制作物への配分前の資産全体額です。各方法は代替案であり、合計しません。将来の継続利用等を仮定した比較で、採用版の残高を変更しません。</p>
    {reports.map((report) => <article key={report.ownerFactsId}>
      <h4>処理条件 {report.ownerFactsId} / 全体原価 {report.amountJpy === null ? '未確認' : yen.format(report.amountJpy)}</h4>
      {report.reasons.map((reason, index) => <p key={index}>{reason}</p>)}
      {report.scenarios.map((scenario) => <details key={scenario.method}>
        <summary>{annualMethodLabels[scenario.method]} / {scenario.status === 'conditional' ? '条件付き比較' : scenario.status === 'not-eligible' ? '条件に不適合' : scenario.status === 'unsupported' ? '未対応' : '条件未確認'}</summary>
        {scenario.reasons.map((reason, index) => <p key={index}>{reason}</p>)}
        {scenario.years && <div style={{ overflowX: 'auto' }} tabIndex={0} aria-label="年別比較表">
          <table><thead><tr><th>年</th><th>期首</th><th>取得</th><th>費用候補</th><th>期末</th></tr></thead>
            <tbody>{scenario.years.map((row) => <tr key={row.year}><th>{row.year}（仮定）</th><td>{yen.format(row.openingJpy)}</td><td>{yen.format(row.additionsJpy)}</td><td>{yen.format(row.expenseJpy)}</td><td>{yen.format(row.closingJpy)}</td></tr>)}</tbody>
          </table>
        </div>}
        {!scenario.years && <p>数値は未算定です。0円の比較表で補っていません。</p>}
      </details>)}
      {report.sourceUrls.length > 0 && <p>確認した制度説明：{report.sourceUrls.map((url, index) => <a key={url} href={url} target="_blank" rel="noreferrer"> 国税庁{index + 1}</a>)}</p>}
    </article>)}
  </section>
}
