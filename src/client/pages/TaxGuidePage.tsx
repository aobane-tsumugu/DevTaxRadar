const topics = [
  {
    term: '取得価額とは？',
    answer: '資産の購入・製作と、目的どおり使える状態にするための費用を集めた金額です。',
    example: '月額AI料金だけでなく、合理的に対応付けた外注費・設備の費用基礎などを同じ制作物へつなぎます。',
    check: '私用・保守・一般学習を区別し、配分方法を継続して使います。資産全体の範囲を月額の小ささだけで判断しません。',
    href: 'https://www.nta.go.jp/law/tsutatsu/kihon/shotoku/08/06.htm',
    source: '所得税基本通達49-8の2・49-8の3',
  },
  {
    term: '保守と改良をどう分ける？',
    answer: '名前ではなく、現状を維持する作業か、価値・機能・使用期間を増やす作業かを確認します。',
    example: '稼働版の不具合修正と、別の新機能開発が並行しているときは、それぞれの作業と原価を分けて記録します。',
    check: '「機能追加」や「保守」のラベルだけで税務処理を確定しません。仕様や変更の実態、計画のまとまりを残します。',
    href: 'https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1379.htm',
    source: '国税庁No.1379 修繕費とならないものの判定',
  },
  {
    term: '供用開始と費用化の関係は？',
    answer: '開発完了・公開予定だけでなく、本来の目的で実際に使い始めた日を確認します。',
    example: '公開前でも自分の正式な業務工程に採用していれば、テストだけの状態とは異なります。',
    check: '実際の利用日と、その裏付けを保存します。未完成・時点不明の値を既定の開始日へ置き換えません。',
    href: 'https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/2100.htm',
    source: '国税庁No.2100 減価償却のあらまし',
  },
  {
    term: '金額境界だけで処理を選べる？',
    answer: '取得価額の単位、取得日、供用、所得区分、貸付用途、届出・特例の条件を合わせて確認します。',
    example: '10万円未満と、10万円以上20万円未満の一括償却は別の条件です。青色申告者向けの特例も別制度です。',
    check: '2026年4月1日以後の少額特例は40万円未満、それ以前は30万円未満という取得日の境界があります。年間限度や対象者等の要件は別途必要で、青色を選ぶだけでは使えません。',
    href: 'https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/2100.htm',
    source: '国税庁No.2100（2026年4月1日現在法令等の記載を2026年9月10日に確認）',
  },
  {
    term: '旧版と改良版が並行して使われる場合は？',
    answer: '旧版の利用を自動で終了させず、継続利用・移行・中止の事実をそれぞれ残します。',
    example: '大幅な作り直しで旧版を今後使わない条件が成立する場合と、旧版を使いながら別の改良を行う場合を区別します。',
    check: '旧版残価の組入れは条件を確認し、同じ残価を除却と振替の両方へ使用しません。',
    href: 'https://www.nta.go.jp/law/tsutatsu/kihon/shotoku/08/06.htm',
    source: '所得税基本通達49-8の2 注2',
  },
  {
    term: '不明と0円、保存と採用はどう違う？',
    answer: '不明な額は計算済み小計の外に残し、理由を表示します。入力の保存は税務上の採用ではありません。',
    example: '設備を買った事実を保存した後で、その年度の方法・業務割合・前年残高を確認できます。',
    check: '年度資料を採用すると入力と計算結果が固定されます。後の訂正では元の採用版を残します。',
  },
  {
    term: '前払・返金・過年度訂正は？',
    answer: '原支払、受益する期間、返金・訂正の対象と発生日を分けて記録します。',
    example: '支払った年とサービスを受ける年が違う場合や、過去に使い始めた設備への値引きは、単に現在額を引き算するだけでは処理できません。',
    check: '設備の取得後の値引き等には取得価額・未償却残額・収入への別の取扱いがあります。採用年を勝手に移さず、対応する原額と判断を確認します。',
    href: 'https://www.nta.go.jp/law/tsutatsu/kihon/shotoku/08/06.htm',
    source: '所得税基本通達49-12の2',
  },
] as const

export default function TaxGuidePage() {
  return <>
    <section className="guide-intro"><div><span className="guide-intro-label">事実から扱いを確認</span><h2>支払の名目だけで、税務処理を決めない。</h2><p>全費用・作業目的・使い始めた日と、判断の根拠をつなぎます。金額を変えない申告方式カードや、AI費用だけによる資産境界の判定は行いません。</p></div></section>
    <section className="tax-qa-grid" aria-label="税務用語のよくある質問">
      {topics.map((item, index) => <details className="tax-qa-card" key={item.term} open={index < 2}>
        <summary><span>{String(index + 1).padStart(2, '0')}</span><strong>{item.term}</strong></summary>
        <div className="tax-qa-answer"><p className="one-line-answer">{item.answer}</p><dl><div><dt>例</dt><dd>{item.example}</dd></div><div><dt>確認</dt><dd>{item.check}</dd></div></dl>
          {'href' in item && <p><a href={item.href} target="_blank" rel="noreferrer">{item.source}</a></p>}
        </div>
      </details>)}
    </section>
    <footer className="tax-disclaimer">一般的な条件の説明です。DevTaxは税額・所得区分・特例適用を自動確定しません。個別事情と申告時点の一次資料を確認してください。</footer>
  </>
}
