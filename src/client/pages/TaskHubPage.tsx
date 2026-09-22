import type { Diagnosis } from '../../planning/types'
import type { RuntimeData } from '../types'
import { buildTaskHubItems, type TaskHubDestination } from '../taskHub'

export default function TaskHubPage({
  diagnosis,
  runtime,
  unknownChargeCount,
  unassignedFolderCount,
  unavailableSourceCount,
  taxUnitCount,
  onOpen,
}: {
  diagnosis: Diagnosis
  runtime: RuntimeData | null
  unknownChargeCount: number
  unassignedFolderCount: number
  unavailableSourceCount: number
  taxUnitCount: number
  onOpen: (destination: TaskHubDestination) => void
}) {
  const items = buildTaskHubItems({
    restoreRequiresReconnect: Boolean(runtime?.restoreRequiresReconnect),
    unknownChargeCount,
    unassignedFolderCount,
    unavailableSourceCount,
    taxUnitCount,
    diagnosis,
  })
  const urgent = items.filter((item) => item.priority !== 'normal')
  const next = items.filter((item) => item.priority === 'normal')

  return (
    <>
      <section className="panel" aria-labelledby="task-hub-now">
        <h2 id="task-hub-now">今回確認すること</h2>
        <p>
          変わったこと・未確認のことから先に並べます。件数が0でも税務上の確認完了を意味せず、
          年度資料の採用は「残高と繰越し」で別に行います。
        </p>
        {urgent.length ? (
          <ol className="action-list">
            {urgent.map((item) => (
              <li key={item.id}>
                <span
                  className={`priority-dot ${item.priority === 'high' ? 'high' : 'medium'}`}
                  aria-hidden="true"
                />
                <div>
                  <strong>{item.title}</strong>
                  <p>{item.reason}</p>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => onOpen(item.destination)}
                  >
                    {item.actionLabel} →
                  </button>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p role="status">
            現在の保存内容から、優先して直す未確認事項は見つかりません。続けて今年の結果と残高を確認してください。
          </p>
        )}
      </section>

      <section className="diagnosis-grid" aria-label="今年と翌年へ進む">
        {next.map((item) => (
          <article className="panel" key={item.id}>
            <h2>{item.title}</h2>
            <p>{item.reason}</p>
            <button
              type="button"
              className="primary-button"
              onClick={() => onOpen(item.destination)}
            >
              {item.actionLabel}
            </button>
          </article>
        ))}
      </section>

      <section className="panel" aria-label="複数PCの使い分け">
        <h2>複数PCを使うとき</h2>
        <p>
          Claude Code /
          Codexの履歴を複数PCから集めることと、DevTaxの保存データ自体を別PCへ引っ越すことは別です。
          DevTaxはクラウド同期や同時編集を行いません。
        </p>
        <button type="button" className="text-button" onClick={() => onOpen('transfer')}>
          PCとデータの使い方を確認 →
        </button>
      </section>
    </>
  )
}
