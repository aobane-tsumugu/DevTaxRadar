const fieldLabels: Record<string, string> = {
  targets: '制作物別の配分',
  shareBps: '業務分に対する割合',
  id: '記録ID',
  name: '名称',
  provider: 'AIサービス',
  planName: 'プラン名',
  month: '対象月',
  amountJpy: '金額',
  unknownAmountReason: '金額が不明な理由',
  charges: '既定月額',
  serviceStartedOn: '利用開始日',
  serviceEndedOn: '利用終了日',
  billedOn: '請求日',
  startedOn: '開始日',
  endedOn: '終了日',
  taxYear: '対象年',
  journeyMode: '準備の段階',
  incomeCategory: '所得区分',
  filingType: '申告方法',
  activityStartedOn: '活動開始日',
  monetizationStatus: '収益化',
  hasBookkeeping: '帳簿あり',
  notes: 'メモ',
  note: 'メモ',
  unitType: '制作物の種類',
  usageMode: '用途',
  revenueModel: '収益の形',
  lifecycleStatus: '現在の状態',
  completionCriteria: '完成条件',
  predecessorId: '旧版の記録ID',
  sameAsExternalVersion: '自己利用版と公開版が同じ',
  projectKey: '履歴の識別子',
  effectiveFrom: '適用開始日',
  effectiveTo: '適用終了日',
  taxUnitId: '対応する制作物ID',
  classification: '作業分類',
  reason: '理由',
  eventType: '出来事',
  occurredOn: '発生日',
  recordedAt: '記録日時',
  evidenceIds: '証拠の記録ID',
  equipmentType: '設備の種類',
  acquisitionCostJpy: '取得額',
  orderedOn: '注文日',
  deliveredOn: '受取日',
  acquiredOn: '取得日',
  businessUseStartedOn: '業務利用開始日',
  convertedFromPrivate: '私用から転用',
  openingUnamortizedBalanceJpy: '期首未償却残高',
  businessUseRatio: '業務割合',
  allocation: '年度別配分条件',
  priorReviewId: '取り込んだ前年資料ID',
  usefulLifeYears: '耐用年数',
  role: '用途の説明',
  projectAllocationRatio: '制作物への割合',
  category: '費目',
  method: '按分方法',
  basis: '計算根拠',
  rationale: '方法を選んだ理由',
  treatment: '対応方法',
  incurredOn: '発生日',
  costType: '費目',
  directlyAttributable: '制作物へ直接対応',
  evidenceType: '証拠の種類',
  strength: '証拠の出所',
  localReference: 'このPCの参照先',
  engineVersion: '計算方法の版',
  candidate: '処理候補',
  status: '確認状態',
  selectedCandidate: '選んだ候補',
  createdAt: '作成日時',
  confirmedAt: '確認日時',
  unobservedRatio: '捕捉外の利用割合',
  equipmentId: '設備ID',
  taxpayer: '納税者区分',
  assetKind: '資産区分',
  methodReason: '方法の根拠・確認先',
  useThroughYearEnd: '年末までの利用',
  ordinaryTreatment: '特別調整の有無',
  priorClosing: '前年末の設備全体残高',
  reference: '残高参照先',
}
const enumFields = new Set([
  'provider',
  'taxpayer',
  'assetKind',
  'useThroughYearEnd',
  'ordinaryTreatment',
  'journeyMode',
  'incomeCategory',
  'filingType',
  'monetizationStatus',
  'unitType',
  'usageMode',
  'revenueModel',
  'lifecycleStatus',
  'sameAsExternalVersion',
  'classification',
  'eventType',
  'equipmentType',
  'category',
  'method',
  'treatment',
  'costType',
  'evidenceType',
  'strength',
  'status',
])
const enumLabels: Record<string, string> = {
  individual: '個人',
  corporation: '法人',
  'tangible-equipment': '有形設備',
  intangible: '無形資産',
  'straight-line': '普通定額法',
  'ended-or-interrupted': '途中終了・中断',
  'special-or-adjusted': '特別な調整あり',
  unknown: '未確認',
  claude: 'Claude Code',
  codex: 'Codex',
  early: '早期準備',
  retrospective: '過去の整理',
  undecided: '未確定',
  miscellaneous: '雑所得',
  business: '事業所得',
  white: '白色',
  blue: '青色',
  none: 'なし',
  planned: '予定',
  earning: '収益あり',
  'new-software': '新規ソフトウェア',
  'improvement-plan': '改良計画',
  'sales-production': '販売物の制作',
  internal: '自己利用',
  external: '外部提供',
  mixed: '併用',
  sales: '販売',
  subscription: '継続課金',
  advertising: '広告',
  affiliate: '紹介報酬',
  efficiency: '業務効率化',
  oss: 'OSS',
  other: 'その他',
  idea: '構想',
  prototype: '試作',
  developing: '開発中',
  evaluating: '評価中',
  'in-use': '利用中',
  maintaining: '保守中',
  improving: '改良中',
  retired: '利用終了',
  abandoned: '中止',
  yes: 'はい',
  no: 'いいえ',
  'new-development': '新規開発',
  maintenance: '保守',
  'feature-addition': '機能追加',
  'general-learning': '一般学習',
  private: '私用',
  unclassified: '未分類',
  'development-started': '開発開始',
  'evaluation-started': '評価開始',
  'internal-use-started': '自己利用開始',
  'external-released': '外部公開',
  'first-sale': '初売上',
  'improvement-started': '改良開始',
  pc: 'PC',
  gpu: 'GPU',
  dgx: 'DGX',
  server: 'サーバー',
  desk: '机',
  peripheral: '周辺機器',
  rent: '家賃',
  electricity: '電気',
  internet: '通信',
  area: '面積',
  'area-time': '面積と時間',
  meter: '計測',
  'watt-hour': '消費電力',
  'usage-time': '利用時間',
  'fixed-ratio': '割合指定',
  direct: '直接対応',
  shared: '共通費用',
  general: '通常業務',
  outsource: '外注費',
  material: '材料費',
  cloud: 'クラウド利用料',
  domain: 'ドメイン',
  license: 'ライセンス',
  'old-version-balance': '旧版からの残高',
  automatic: '自動記録',
  'self-recorded': '自分で記録',
  deployment: '公開記録',
  'sale-page': '販売ページ',
  'store-release': 'ストア公開',
  'first-use': '初回利用',
  file: 'ファイル',
  screenshot: '画面保存',
  receipt: '領収書',
  'card-statement': 'カード明細',
  memo: 'メモ',
  'ai-session': 'AI履歴',
  pending: '確認待ち',
  confirmed: '確認済み',
  overridden: '判断を変更',
  'not-applicable': '該当なし（本人の記録）',
  deferred: '保留',
  equipment: '設備',
  home: '自宅費用',
}

export default function WorkspaceValue({ value, field = '' }: { value: unknown; field?: string }) {
  if (value === undefined) return <p>記録なし・削除</p>
  if (value === null) return <p>不明</p>
  if (Array.isArray(value))
    return value.length ? (
      <ul>
        {value.map((item, index) => (
          <li key={index}>
            <WorkspaceValue value={item} />
          </li>
        ))}
      </ul>
    ) : (
      <p>登録なし</p>
    )
  if (typeof value === 'object') {
    const entries = Object.entries(value).filter(([, item]) => item !== undefined)
    return entries.length ? (
      <dl>
        {entries.map(([key, item]) => (
          <div key={key}>
            <dt>{fieldLabels[key] ?? key}</dt>
            <dd>
              <WorkspaceValue value={item} field={key} />
            </dd>
          </div>
        ))}
      </dl>
    ) : (
      <p>未入力</p>
    )
  }
  if (typeof value === 'boolean') return <p>{value ? 'はい' : 'いいえ'}</p>
  if (field === 'strength' && value === 'external') return <p>外部の記録</p>
  if (typeof value === 'number')
    return (
      <p>
        {field === 'shareBps'
          ? `${value / 100}%`
          : field.endsWith('Jpy')
            ? `${value.toLocaleString('ja-JP')}円`
            : field.endsWith('Ratio')
              ? new Intl.NumberFormat('ja-JP', {
                  style: 'percent',
                  maximumSignificantDigits: 21,
                }).format(value)
              : String(value)}
      </p>
    )
  return (
    <p>
      {value === ''
        ? '空欄'
        : enumFields.has(field)
          ? (enumLabels[String(value)] ?? String(value))
          : String(value)}
    </p>
  )
}
