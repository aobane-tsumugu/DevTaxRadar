import type { ConsultationNavigation } from '../consultationNavigation'
import './ConsultationContextPanel.css'
import type { TaxUnitRecord } from '../../planning/types'

export default function ConsultationContextPanel({
  context,
  units,
  onNavigate,
  onReturn,
}: {
  context: ConsultationNavigation
  units: TaxUnitRecord[]
  onNavigate: (kind: 'fact' | 'method') => void
  onReturn: () => void
}) {
  const unit = units.find((item) => item.id === context.taxUnitId)
  return (
    <section className="panel consultation-context" aria-label="見直し元の相談回答">
      <h3>
        {unit?.name ?? '現在の一覧にない制作物'} / {context.answer.taxYear}年の回答を確認
      </h3>
      <p>
        制作物ID：{context.taxUnitId || '未選択'} / 確認事項ID：{context.pendingId}
      </p>
      <p style={{ whiteSpace: 'pre-wrap' }}>元の問い：{context.question}</p>
      <p>
        {context.answer.kind === 'fact' ? '事実の回答' : '方法の回答'} / 受領日：
        {context.answer.receivedOn || '未入力'}
      </p>
      <p style={{ whiteSpace: 'pre-wrap' }}>{context.answer.answer || '回答未入力'}</p>
      <p>確認先・根拠：{context.answer.source || '未入力'}</p>
      <p>
        残高画面の作業入力から開いた回答です。制作物の実態と判断内容を見直し、変更を保存してから戻って解消を確認してください。回答や残高の未保存入力は元の画面に保持します。
      </p>
      {!unit && <p role="status">対象の制作物を確認してください。他の制作物を自動選択しません。</p>}
      <button type="button" disabled={!unit} onClick={() => onNavigate('fact')}>
        対象の制作物・利用状況へ移動
      </button>
      <button type="button" disabled={!unit} onClick={() => onNavigate('method')}>
        対象年の判断記録へ移動
      </button>
      <button type="button" onClick={onReturn}>
        回答と解消の入力へ戻る
      </button>
    </section>
  )
}
