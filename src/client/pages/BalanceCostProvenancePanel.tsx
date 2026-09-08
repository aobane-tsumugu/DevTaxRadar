import type { BalanceCostProvenance } from '../../core/balanceCostProvenance'
import { yen } from './shared'
export default function BalanceCostProvenancePanel({ check }: { check: BalanceCostProvenance }) {
  return (
    <section aria-label="費用と残高増加の金額照合">
      <h3>費用と残高増加の金額照合</h3>
      <p>
        {check.status === 'invalid'
          ? '金額対応に不整合があります。訂正するまで採用できません。'
          : check.status === 'incomplete'
            ? '費用に対応していない増加額があります。未対応を残した資料として保存されます。'
            : '登録された増加額と費用配分の対応に不整合はありません。'}
      </p>
      <p>
        期首の由来、費用化・減少・振替後の個別原価の追跡、税務上の適用条件はこの照合の対象外です。未使用の配分額を税務上の費用や未計上額とは断定しません。
      </p>
      {check.issues.length > 0 && (
        <ul>
          {check.issues.map((issue, index) => (
            <li key={index}>
              {issue.movementId} / {issue.contributionId}：{issue.message}
            </li>
          ))}
        </ul>
      )}
      <table>
        <thead>
          <tr>
            <th>増加記録</th>
            <th>増加額</th>
            <th>対応額</th>
            <th>未対応額</th>
          </tr>
        </thead>
        <tbody>
          {check.additions.map((row) => (
            <tr key={row.movementId}>
              <td>{row.movementId}</td>
              <td>{yen.format(row.amountJpy)}</td>
              <td>{yen.format(row.linkedJpy)}</td>
              <td>{yen.format(row.unlinkedJpy)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <details>
        <summary>費用配分ごとの対応と残り</summary>
        <table>
          <thead>
            <tr>
              <th>年・配分</th>
              <th>配分額</th>
              <th>指定された対応額</th>
              <th>未使用額</th>
              <th>増加記録</th>
            </tr>
          </thead>
          <tbody>
            {check.contributions.map((row) => (
              <tr key={JSON.stringify([row.costYear, row.contributionId])}>
                <td>
                  {row.costYear} / {row.contributionId}
                </td>
                <td>{yen.format(row.availableJpy)}</td>
                <td>{row.claimedJpy === null ? '整数範囲外' : yen.format(row.claimedJpy)}</td>
                <td>
                  {row.remainingJpy === null ? '上限超過・未算定' : yen.format(row.remainingJpy)}
                </td>
                <td>{row.movementIds.join(' / ') || '対応なし'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
  )
}
