import type { ReviewComparison } from '../../core/reviewComparison'
import type { BalanceAmountImpact } from '../../core/reviewComparison'

function delta(value: BalanceAmountImpact): string {
  return value.deltaJpy === null
    ? '未算定（不明または片方に記録なし）'
    : (value.deltaJpy > 0 ? '+' : '') + value.deltaJpy.toLocaleString('ja-JP') + '円'
}

const labels: Record<string, string> = {
  balanceInputs: '残高の入力',
  balanceResults: '残高の計算結果',
  materials: '費用・判断・観測',
  accounts: '残高',
  movements: '増減',
  pendingDecisions: '未判断',
  answers: '確認事項への回答',
  answer: '回答内容',
  receivedOn: '回答受領日',
  source: '確認先・根拠',
  opening: '期首',
  closing: '期末',
  amountJpy: '金額',
  reasons: '未算定・未判断の理由',
  reason: '理由・根拠',
  name: '名前',
  status: '状態',
  planning: '計画',
  decisions: '判断',
  selectedCandidate: '確認した扱い',
  candidate: '検討した扱い',
  confirmedAt: '確認日時',
  configuration: '料金設定',
  costs: '費用の計算',
  totals: '小計',
  sources: '費用源',
  bases: '費用基礎',
  contributions: '配分',
  observations: '数値利用記録',
  recentScans: '直近の走査記録',
  referenceCheck: '参照確認',
  taxYear: '対象年',
  taxUnitId: '制作物ID',
  directCosts: '直接費',
  equipment: '設備',
  homeCosts: '自宅費用',
  evidence: '証拠',
  knownClosingJpy: '既知の期末小計',
  knownOpeningJpy: '既知の期首小計',
  timeZone: '時間帯',
  balanceAllocations: '使用する残高対応元',
  costAllocations: '費用配分の原価内訳',
  balanceFlowCheck: '残高対応元の照合',
  balanceLotTrace: '元費用の原価追跡',
  openingLotCarry: '前年原価の繰越し',
  costYear: '費用の対象年',
  contributionId: '費用配分ID',
  sourceKind: '対応元の種類',
  sourceId: '対応元ID',
  untracedJpy: '原価未追跡額',
  remainingJpy: '原価残額',
  linkedJpy: '対応済み額',
  unlinkedJpy: '未対応額',
}
const display = (value: unknown) =>
  value === undefined
    ? '記録なし'
    : value === null
      ? '不明・未設定'
      : typeof value === 'string'
        ? value
        : JSON.stringify(value, null, 2)

export default function ReviewComparisonPanel({ value }: { value: ReviewComparison }) {
  return (
    <section className="panel" aria-label="保存版と現在の入力の比較">
      <h3>{value.year}年の資料との差</h3>
      <p>
        比較元：{value.reviewId} / 保存版の残高入力 {value.beforeDraftRevision} → 現在の保存入力{' '}
        {value.currentDraftRevision} / 料金・計画の版 {value.currentWorkspaceRevision ?? '未取得'}
      </p>
      <p>
        比較時点でDBに保存されていた内容です。この画面の未保存入力は含みません。旧版の計算はやり直さず、記録した全期間の入力と対象年の結果を比較します。
      </p>
      {value.materialCoverage !== 'both' && (
        <p role="status">
          両方の費用・判断・観測資料がそろっていないため、この部分は比較できません。記録がないことを新規追加や0円とは扱いません。
        </p>
      )}
      {value.currentReviewId !== value.reviewId && (
        <p>比較元は現在の現行版ではありません。訂正済みの過去版との比較です。</p>
      )}
      {value.previousReviewChanged && (
        <p role="status">
          参照する前年の資料が変わっているか、それ以前の訂正が前年資料に未反映です。年度をさかのぼって引継ぎを確認してください。
        </p>
      )}
      <p>
        {value.changes.length}
        件の変更箇所。入力と計算結果で同じ変更が現れることがあり、件数は取引数ではありません。
      </p>
      {value.changes.length === 0 && (
        <p>比較できた範囲に内容の差はありません。適用条件や金額の正しさの検証ではありません。</p>
      )}
      {value.balanceImpact.length > 0 && (
        <>
          <h4>期首・期末への影響</h4>
          <p>
            現在の記録で再計算した額から保存版の額を引いた差です。両方が既知の場合だけ算定します。特定の訂正だけによる差額や税額ではありません。
          </p>
          <table>
            <thead>
              <tr>
                <th>残高</th>
                <th>期首の差</th>
                <th>期末の差</th>
              </tr>
            </thead>
            <tbody>
              {value.balanceImpact.map((row) => (
                <tr key={row.accountId}>
                  <th>{row.name}</th>
                  <td>{delta(row.opening)}</td>
                  <td>{delta(row.closing)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {value.changes.map((change, index) => (
        <details key={index}>
          <summary>
            {change.path.map((part) => labels[part] ?? part).join(' / ')}：
            {{ added: '追加', removed: '削除', changed: '変更' }[change.operation]}
          </summary>
          <table>
            <thead>
              <tr>
                <th>保存版</th>
                <th>現在の保存入力・結果</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                    {display(change.before)}
                  </pre>
                </td>
                <td>
                  <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                    {display(change.after)}
                  </pre>
                </td>
              </tr>
            </tbody>
          </table>
        </details>
      ))}
    </section>
  )
}
