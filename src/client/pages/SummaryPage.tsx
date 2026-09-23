import type { DashboardData, RuntimeData, TaxGroup } from '../types'
import type { Diagnosis, PlanningSnapshot } from '../../planning/types'
import AnnualOverview from './AnnualOverview'
import AnnualReviewSummary from './AnnualReviewSummary'
import RecordStatusPanel from './RecordStatusPanel'
import {
  EmptyState,
  GROUP_CLASS,
  lifecycleLabel,
  PanelHeading,
  usageModeLabel,
  yen,
} from './shared'

export default function SummaryPage({
  data,
  planning,
  diagnosis,
  months,
  undatedMonths,
  totals,
  onOpenCosts,
  onOpenBalances,
  onOpenOnboarding,
  retention,
}: {
  data: DashboardData
  planning: PlanningSnapshot
  diagnosis: Diagnosis
  months: DashboardData['months']
  undatedMonths: number
  totals: Record<TaxGroup, number>
  onOpenCosts: () => void
  onOpenBalances: () => void
  onOpenOnboarding: () => void
  retention: RuntimeData['retention'] | null
}) {
  const annualTotal = totals.current + totals.future + totals.review
  const maxMonth = Math.max(
    ...months.map((month) => month.current + month.future + month.review),
    1,
  )
  return (
    <>
      {retention?.claude.autoDelete.kind === 'configured' &&
        (retention.claude.alreadyLosing ||
          (retention.claude.daysUntilNextLoss ?? Infinity) <= 30) && (
          <div className="retention-banner" role="status">
            <strong>
              {retention.claude.alreadyLosing
                ? 'Claude Codeの古い履歴が、すでに削除されている可能性があります'
                : `Claude Codeの最も古い履歴が、あと${retention.claude.daysUntilNextLoss}日で削除される見込みです`}
            </strong>
            <span>
              数値の記録は保存できますが、失われた原本の会話本文は復元できません。保持日数は履歴の設定で変更できます。
            </span>
            <button className="text-button" onClick={onOpenOnboarding}>
              はじめの準備を開く →
            </button>
          </div>
        )}
      <AnnualOverview
        year={planning.profile.taxYear}
        projection={data.costProjection}
        onOpenCosts={onOpenCosts}
      />
      <AnnualReviewSummary
        year={planning.profile.taxYear}
        local={data.meta.source === 'local'}
        onOpenBalances={onOpenBalances}
      />
      <RecordStatusPanel
        planning={planning}
        sessionCount={data.meta.sessionCount}
        onEdit={onOpenOnboarding}
      />
      <section className="diagnosis-grid" aria-label="現在地診断と次の行動">
        <article className="panel position-panel">
          <PanelHeading
            title="現在地診断"
            subtitle="登録した事実から生成。税務判断を確定するものではありません"
          />
          <ul className="position-list">
            {diagnosis.currentPosition.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <div className="usage-overview">
            {planning.taxUnits.slice(0, 3).map((unit) => (
              <div key={unit.id}>
                <strong>{unit.name}</strong>
                <span>{usageModeLabel(unit.usageMode)}</span>
                <small>{lifecycleLabel(unit.lifecycleStatus)}</small>
              </div>
            ))}
          </div>
        </article>
        <article className="panel action-panel">
          <PanelHeading
            title="次にやること"
            subtitle="関係する事実と未確認事項です。準備スコアによる評価は行いません。"
            trailing={
              <span className="action-count">確認事項 {diagnosis.missingFacts.length}件</span>
            }
          />
          {diagnosis.immediateActions.length ? (
            <ol className="action-list">
              {diagnosis.immediateActions.slice(0, 3).map((action) => (
                <li key={action.id}>
                  <span className={`priority-dot ${action.priority}`} aria-hidden="true" />
                  <div>
                    <strong>{action.title}</strong>
                    <p>{action.reason}</p>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p>現在の入力から追加の確認事項はありません。税務上の確認完了を意味しません。</p>
          )}
          {diagnosis.eventTriggeredActions.length > 0 && (
            <details className="event-action">
              <summary>イベントが起きたら行うこと</summary>
              {diagnosis.eventTriggeredActions.map((action) => (
                <p key={action.id}>
                  <strong>{action.title}</strong>
                  <br />
                  {action.reason}
                </p>
              ))}
            </details>
          )}
        </article>
      </section>
      <h2>{planning.profile.taxYear}年のAI料金の分類内訳</h2>
      <p>
        選択したAIサービス・制作物の料金分類です。全費用の税務処理・資産残高ではありません。残高は「残高と繰越し」の実記録を参照してください。
      </p>
      {undatedMonths > 0 && (
        <p role="status">
          対象年を確認できない月が{undatedMonths}件あるため、この年の集計には含めていません。
        </p>
      )}
      <section className="summary-grid" aria-label="対象年のAI分類内訳">
        {(['current', 'future', 'review'] as const).map((group) => (
          <article className={`metric-card ${GROUP_CLASS[group]}`} key={group}>
            <h2>
              {group === 'current'
                ? '当年処理に分類したAI料金'
                : group === 'future'
                  ? '開発原価等に分類したAI料金'
                  : '私用・未分類・配分未算定等'}
            </h2>
            <strong className="metric-value">{yen.format(totals[group])}</strong>
            <div className="metric-foot">
              <span>{annualTotal ? Math.round((totals[group] / annualTotal) * 100) : 0}%</span>
              <span>入力による分類・未採用</span>
            </div>
          </article>
        ))}
      </section>
      <div className="main-grid">
        <section className="panel chart-panel">
          <PanelHeading
            title="対象年のAI料金の行き先"
            subtitle="AIサービスごとの請求を、契約・月・履歴範囲で配分"
          />
          {months.length === 0 ? (
            <EmptyState message="対象年に対応するAI料金の集計がありません。AI以外の費用は上の全費用資料で確認できます。" />
          ) : (
            <>
              <div className="chart-legend" aria-hidden="true">
                <span>
                  <i className="dot coral" />
                  当年処理への分類
                </span>
                <span>
                  <i className="dot indigo" />
                  開発原価等への分類
                </span>
                <span>
                  <i className="dot amber" />
                  要確認
                </span>
              </div>
              <div
                className="bar-chart"
                role="img"
                aria-label={`${months[0].label}から${months.at(-1)?.label}までの費用配賦積み上げグラフ`}
              >
                <div className="axis-label top">{yen.format(maxMonth)}</div>
                <div className="axis-label middle">{yen.format(Math.round(maxMonth / 2))}</div>
                {months.map((month) => (
                  <div className="bar-column" key={month.label}>
                    <div className="bar-value">
                      {yen.format(month.current + month.future + month.review)}
                    </div>
                    <div className="bar-track">
                      {(['review', 'future', 'current'] as const).map((group) => (
                        <div
                          key={group}
                          className={`bar-part ${GROUP_CLASS[group]}`}
                          style={{ height: `${(month[group] / maxMonth) * 100}%` }}
                          title={`${{ current: '当年処理への分類', future: '開発原価等への分類', review: '私用・未分類等' }[group]} ${yen.format(month[group])}`}
                        />
                      ))}
                    </div>
                    <strong>
                      {month.label}
                      {month.unknownChargeIds?.length ? ' / 請求額未確認あり' : ''}
                    </strong>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>
        <section className="panel guide-panel">
          <PanelHeading
            title="入力・履歴の確認事項"
            subtitle="取得・入力の状態です。確認完了の評価ではありません。"
          />
          <ul className="guide-list">
            {data.guidance.map((item) => (
              <li key={item.title}>
                <span className={`guide-symbol ${item.severity}`} aria-hidden="true">
                  {item.severity === 'warning' ? '!' : '✓'}
                </span>
                <div>
                  <strong>{item.title}</strong>
                  <p>{item.description}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>
      <footer className="tax-disclaimer">
        本画面は事実・計算・確認事項を示します。税務判断を確定するものではありません。
      </footer>
    </>
  )
}
