# 原始請求の共通取り込み v1

この形式は、DevTaxへの費用入力用です。会計ソフト向けの仕訳CSVや、保存済み年度資料のJSONとは別の形式です。領収書本文・PDF・画像の読み取りは行いません。

## 入力から保存まで

「支払と配分」の「元の支払をまとめて入力」から開始します。手入力と所定形式のCSV/JSONは、同じ候補の検証経路を使います。取り込みだけでDBへ書き込まず、候補を確認して編集中の料金・計画へ反映した後、年度への影響を確認して既存のworkspace保存を行います。費用の保存と年度資料への採用は別の操作です。

原始請求の事実と既存のAI請求・設備・自宅費用・直接費を結び付け、計算には既存の費用行を使います。共通事実の原額をもう一度費用へ加算する台帳は作りません。複数の制作物へ配分した場合も、元の支払を複製しません。

「保存前の候補確認」で原額・日付・契約・根拠・配分と重複候補を確認し、「変更の影響を確認」へ進みます。未送信の手入力欄・検証済み候補は、接続先と元の保存版を識別するブラウザの控えから明示的に戻せます。個人用の控えファイルを保存・読み込みする操作もあります。読込元ファイルの原文やパスは控えに含めません。控えを戻すだけでは保存を実行せず、別データや古い版の控えをそのまま最新入力として扱いません。手入力の訂正で保存版が変わった場合は、元の記録・入力・最新記録の3版で分類別の内容を照合し、両側が異なる変更をした箇所は競合として残します。古い版の取込候補に既存費用の訂正が含まれる場合は、最新内容を確認したファイルの再読込が必要です。控えの版番号だけを進めて、古い配分や契約情報を最新情報へ上書きしません。

## ファイル形式と上限

- UTF-8の`.json`または`.csv`。先頭のUTF-8 BOMは読み飛ばします。文字数ではなくUTF-8バイト数で512 KiB（524,288 bytes）までです
- 一度に1〜500候補。保存する共通事実は訂正履歴も含め最大5,000件です。保存要求全体は2 MiB（2,097,152 bytes）までで、既存workspaceの各種件数・参照検証も適用されるため、この件数以内なら必ず保存できるという意味ではありません
- 全候補を検証します。一部の行だけを成功として取り込まず、形式不正・上限超過・参照不整合などがあれば修正して再確認します
- 未知のフィールド・版を黙って削除して受理しません。ID・証拠ID・対象IDは既存の記録に合わせてください
- ファイル名、ローカルパス、原文のCSV/JSON、領収書本文は共通事実へ保存しません。`sourceKey`や自由記述には原本パス、秘密情報、決済情報を入れないでください。許可された自由記述は年度資料にも残る場合があり、自動匿名化はしません

形式確認用の合成例:

- [4分類のJSON](examples/original-charge-v1.json)：年をまたぐ外貨AI請求、設備、自宅費用の不明額、直接費の確認済み0円
- [最小列のCSV](examples/original-charge-v1.csv)：同じJSON内の直接費1件

金額・換算率・割合は形式説明用で、税務処理や実利用を確認した値ではありません。JSONとCSVに含む直接費は同じキー・同じ内容・同じ新規登録操作なので、両方を取り込んでもその1件を再加算しません。実データへ使う前に、例のID・日付・金額・割合・分類を実際の記録へ置き換えてください。

## JSON v1

トップレベルは次のいずれかです。

```json
{"version":1,"candidates":[{"category":"direct","sourceKey":"example:invoice-001","record":{"id":"example-direct","incurredOn":"2026-09-01","costType":"other","amountJpy":1000,"directlyAttributable":false,"treatment":"general","evidenceIds":[]},"original":{"currency":"JPY","amount":"1000","amountJpy":1000},"evidenceIds":[]}]}
```

`candidates`の配列だけをトップレベルに置く形式も受け付けます。オブジェクト形式は`version: 1`と`candidates`の2項目だけです。保存済み年度資料やworkspace全体のJSONをこの入口へ渡すことはできません。

### 候補の共通フィールド

| フィールド | 必須 | 意味 |
| --- | --- | --- |
| `category` | 必須 | `subscription` / `equipment` / `home` / `direct` |
| `record` | 必須 | 次節の分類別入力。訂正でも差分だけではなく、その分類の完全な記録 |
| `original` | 必須 | 原通貨額と採用円額。後述 |
| `evidenceIds` | 必須 | 登録済み根拠IDの配列。根拠なしは`[]`。重複不可、最大100件 |
| `sourceKey` | 取込時必須 | 取込元で安定した請求識別子。最大300文字。別契約は別キーとし、同じキーを別の費用源へ再利用しない |
| `dates` | 任意 | `billedOn`（請求日）・`paidOn`（支払日）・`acquiredOn`（取得日）・`incurredOn`（発生日）の任意項目を持つオブジェクト |
| `servicePeriod` | 任意 | `startedOn`と`endedOn`。両端を含む実在日付、開始≦終了 |
| `contract` | 任意 | 必須の`reference`（最大160文字）と任意の`reason`（最大2,000文字） |
| `correctsId` | 訂正時 | 訂正する同じ費用源の最新の共通事実ID |
| `legacySourceId` | 旧記録の初回訂正時 | 共通事実がまだない既存費用のID。`correctsId`と同時指定不可 |
| `correctionReason` | 訂正時必須 | 訂正元と一組の理由。最大2,000文字 |

日付は`YYYY-MM-DD`の実在日付です。請求日が支払日であるとは推定しません。`record`にも同じ意味の金額・不明理由・証拠・利用期間・請求日・取得日・発生日を指定する場合は、共通フィールドと一致させます。AI請求の`contractConfirmation`があれば契約の呼び名も照合します。共通`contract`の入力だけでは、履歴範囲や契約確認を自動確定しません。

JSONではトップレベル`sourceKey`の代わりに`provenance.sourceKey`を指定できます。両方を指定する場合は同じ値にします。`provenance`で許可する項目は`kind`・`sourceKey`・`contentHash`だけです。入力経路の`kind`は実際のパーサーが`json`または`csv`として付与し、ファイル側の自己申告には依存しません。`contentHash`は省略でき、正規化した内容から自動計算します。指定する場合は計算結果との完全一致が必要です。手入力では取込キーやhashを設定しません。

事実ID、記録日時、費用源ID、旧記録の訂正前コピーは反映側が生成します。候補へ`id`・`recordedAt`・`sourceId`・`legacyPreviousRecord`をトップレベル項目として渡さないでください。分類別の`record.id`とは別です。

### 原通貨額と円額

`original`の構造:

| フィールド | 必須 | 形式 |
| --- | --- | --- |
| `currency` | 必須 | 大文字3文字の通貨コード、または不明の`null` |
| `amount` | 必須 | 非負の十進数文字列、または不明の`null` |
| `unknownAmountReason` | 原額不明時だけ | 1〜2,000文字の理由 |
| `amountJpy` | 必須 | 0以上の安全な整数円、または不明の`null` |
| `unknownJpyReason` | 円額不明時だけ | 1〜2,000文字の理由 |
| `fx` | 既知外貨→既知円額時 | 下記の換算根拠 |
| `conversionEvidenceIds` | 任意 | 換算の証拠ID、最大100件、重複不可 |

十進数文字列は整数部最大15桁、小数部は付けるなら1〜8桁です。符号、桁区切り、指数表記、不要な先頭0は使いません。例:`"20.00"`、`"0"`。円建ての既知原額は小数点なしの文字列とし、`amountJpy`と同じ整数にします。通貨不明なら原通貨額も不明です。不明の理由を既知額へ付けることも、不明額の理由を省略することも拒否します。`record`の円額と不明理由は`original`の採用円額・不明理由に一致させます。

外貨の例:

```json
{"currency":"USD","amount":"20.00","amountJpy":3000,"fx":{"currency":"USD","foreignAmount":"20.00","jpyPerUnit":"150","rounding":"nearest-yen","convertedOn":"2026-07-16","reference":"形式説明用の架空換算例"}}
```

`fx`は上の6項目すべてが必要です。`currency`と`foreignAmount`は原通貨・原額に一致させます。`jpyPerUnit`は1通貨単位あたりの円の十進数文字列で0より大きい値、`convertedOn`は1900年以降の実在日付、`reference`は1〜2,000文字です。丸めは`nearest-yen`（0.5円以上切上げ）、`floor-yen`（切捨て）、`ceiling-yen`（切上げ）のいずれかを明示します。整数による十進計算の結果と採用円額を照合します。円建てへ`fx`は付けません。決済手数料等を計算結果へ黙って足さず、必要なら別の費用として記録します。

### 分類別の`record`

共通して`id`は1〜120文字の安定した費用行IDです。新規なら未使用IDを指定し、訂正なら既存IDを維持します。`evidenceIds`は共通側と同じ集合を指定してください。円額は0以上の安全な整数または`null`で、不明時だけ`unknownAmountReason`を必要とします。任意項目が分からないときは、空文字や仮の日付ではなく項目を省略します。

| `category` | 必須の`record`項目 | 任意の`record`項目 |
| --- | --- | --- |
| `subscription` | `id`, `provider`, `planName`, `serviceStartedOn`, `serviceEndedOn`, `amountJpy` | `billedOn`, `unknownAmountReason`, `note`, `evidenceIds`, `contractConfirmation` |
| `equipment` | `id`, `name`, `equipmentType`, `acquisitionCostJpy`, `acquiredOn`, `convertedFromPrivate`, `businessUseRatio`, `role`, `projectAllocationRatio`, `evidenceIds` | `unknownAmountReason`, `orderedOn`, `deliveredOn`, `businessUseStartedOn`, `openingUnamortizedBalanceJpy`, `usefulLifeYears`, `taxUnitId` |
| `home` | `id`, `month`, `category`, `amountJpy`, `method`, `businessUseRatio`, `basis`, `rationale`, `projectAllocationRatio`, `treatment`, `evidenceIds` | `unknownAmountReason`, `taxUnitId`, `targets` |
| `direct` | `id`, `incurredOn`, `costType`, `amountJpy`, `directlyAttributable`, `treatment`, `evidenceIds` | `unknownAmountReason`, `taxUnitId`, `targets`, `note` |

列挙値と単位:

- AIの`provider`: `claude` / `codex`。利用期間の開始・終了は必須です。`planName`は最大160文字で空文字も許可します
- 設備の`equipmentType`: `pc` / `gpu` / `dgx` / `server` / `desk` / `peripheral` / `other`。`name`は1〜160文字、`role`は1〜1,000文字。`usefulLifeYears`は1〜100の整数です
- 自宅の`month`: `YYYY-MM`。`category`: `rent` / `electricity` / `internet`。`method`: `area` / `area-time` / `meter` / `watt-hour` / `usage-time` / `fixed-ratio`。`basis`・`rationale`は1〜2,000文字です
- 直接費の`costType`: `outsource` / `material` / `cloud` / `domain` / `license` / `old-version-balance` / `other`
- `treatment`: `direct` / `shared` / `general`。`convertedFromPrivate`・`directlyAttributable`はJSONの真偽値です
- `businessUseRatio`・`projectAllocationRatio`は0〜1で指定します。50%は`0.5`です。`targets`は`{"taxUnitId":"登録済みID","shareBps":5000}`等の配列で、`shareBps`は0〜10000または未確認の`null`、最大100対象・重複不可・合計10000以下です
- `targets`があれば空配列でも既存の単一対応先より優先します。設備の複数配分・年度方式は既存の別記録で扱い、`record`へ独自項目を追加しません
- `note`はAIで最大1,000文字、直接費で最大2,000文字です

`contractConfirmation`は既存のAI契約確認と同じ構造です。`reference`・`reason`・確認時の請求全体を写した`basis`が必要で、`confirmedAt`・`usageScope`は任意です。`basis`は上のAI記録から`contractConfirmation`を除いた構造です。`confirmedAt`を付ける場合は呼び名と理由を空にできません。`usageScope`は`kind`（`all` / `selected`）、`selectors`、`unobservedRatio`（0〜0.95または`null`）、`reason`が必須で、`independentSourceIds`は任意です。selectorは必須の`sourceId`と任意の`projectKey`・`sessionKey`・`startedOn`・`endedOn`を持ちます。契約確認や履歴選択が必要な場合は、既存の契約編集画面で実際の記録を確認してください。契約の呼び名を訂正する場合は、古い`record.contractConfirmation`を候補から外し、新しい契約と履歴範囲を別途再確認します。古い確認を新契約へ自動移行しません。

## CSV v1

必須列は`category,record,original,evidenceIds,sourceKey`です。任意列は`dates,servicePeriod,contract,correctsId,legacySourceId,correctionReason`。列順は任意ですが、列名は完全一致で、前後の空白、重複列、未知の列は認めません。`version`列はなく、この列契約がv1です。

`record`・`original`・`dates`・`servicePeriod`・`contract`・`evidenceIds`のセルには、JSONと同じオブジェクトまたは配列をJSON文字列として入れます。文字列値の列はそのままです。任意の空セルは項目省略として扱い、JSONの`null`への置換は行いません。

```csv
category,record,original,evidenceIds,sourceKey
direct,"{""id"":""example-direct"",""incurredOn"":""2026-09-01"",""costType"":""other"",""amountJpy"":1000,""directlyAttributable"":false,""treatment"":""general"",""evidenceIds"":[]}","{""currency"":""JPY"",""amount"":""1000"",""amountJpy"":1000}",[],example:invoice-001
```

カンマ・引用符・改行を含むセルは二重引用符で囲み、セル内の二重引用符を`""`にします。改行はLF・CRLF・CRを受け付け、引用セル内の改行も扱います。各行の列数はヘッダーと一致させます。末尾の改行1つは許可しますが、空行を追加しないでください。引用符が閉じていない、引用符の直後に区切り以外がある、構造化セルのJSONが不正な場合は全体を拒否します。文字列はデータとして扱い、HTMLや表計算の数式として実行しません。

## 訂正・返金と再取り込み

保存済みの共通事実は変更・削除せず、元の事実と理由を付けた訂正を追加します。金額が変わらない日付・根拠の訂正も、影響確認の対象です。訂正後も既存の費用源IDを維持し、元の費用への返金・調整参照を別の費用へ付け替えません。訂正によって既存の返金・調整が保持する元費用の確認内容と一致しなくなれば、その対応を再確認します。以前の確認内容を自動で新しい原額へ書き換えません。

金額・期間が同じことだけでは重複を確定しません。別契約や改訂請求の可能性を利用者が確認し、候補を自動的に削除・統合しないことが前提です。再取り込みの識別には安定した取込キーと内容の照合を使います。取込キーの変更は同じ請求であることの証明にはなりません。

同じ取込操作の再送はスキップします。同じ操作であるためには、`sourceKey`・内容hash・費用源IDに加え、`correctsId`・`legacySourceId`・`correctionReason`も過去の事実と一致する必要があります。訂正前のファイルをそのまま再取込しても、訂正済みの支払を再加算・巻き戻ししません。

一方、100円→200円→100円と明示的に訂正する場合、最後の100円は現在の200円の事実を`correctsId`として理由を付ければ、新しい訂正事実になります。最初の100円と同じ内容hashであることだけではスキップしません。古い訂正元のまま理由だけを変えた再送は、新しい正当な訂正とは扱わず拒否します。同じキーで内容が変わった場合も、現在の共通事実を指す`correctsId`と`correctionReason`が必要です。

hashは正規化した分類別記録全体・原額・日付・期間・契約・証拠のSHA-256で、訂正元と理由はhashに含めず別に照合します。ファイル原文のhashや原本の真正性の保証ではありません。

共通事実がまだない旧費用を訂正する場合は、既存の`record.id`を維持し、`legacySourceId`に`ai:charge:<id>`、`equipment:<id>`、`home:<id>`、`direct:<id>`の対応する費用IDを指定します。訂正前の旧記録を事実に保持します。新規費用にこの項目を付けたり、現在の訂正元でない事実を指定したりすることはできません。訂正時も`record`は完全な記録なので、既存の配分や契約詳細を落とさないよう、通常は画面で訂正する支払を選んでください。

返金・取消・値引きは、負の購入額や0円の訂正として入力せず、既存の返金・訂正記録の経路を使います。非金銭訂正のためだけに0円の調整記録を作りません。

## 不明額・換算・日付

不明額と確認した0円を分けます。円額が不明なときは理由を残し、月額や0円を自動補完しません。原通貨の額、採用する円額、換算率・換算日・出典・丸めを別に保持します。相場をネットワークから自動取得したり、請求日・支払日・取得日・発生日・利用期間を一つの日付で代用したりしません。

## 保存と互換性の境界

共通事実は既存のworkspace保存と同じ版照合・要求ID・影響hash・transactionの対象です。競合、入力の変更、保存失敗を成功と扱いません。保存済み事実を省略する旧ブラウザから現行サーバーへの書き込みは拒否します。

この保護は、古い実行版のサーバーや配布バイナリを同じDBで動かせるという保証ではありません。追加情報を知らない旧実行版へのダウングレード運用は未対応です。更新前のバックアップを保持し、旧実行版が新しい共通事実を保護すると仮定しないでください。

年度採用資料は、採用時点の入力・費用源・根拠を固定します。後の取込や訂正で、過去の保存資料の内容・hash・出力を更新しません。旧資料に共通事実が未収録の場合、現在の入力から補完しません。

## 対応していないもの

- 任意の事業者CSV、銀行・カード明細をそのまま解釈する汎用アダプター
- 領収書本文、テキストPDF、画像OCRによる候補抽出
- 会計向け転記CSV、特定会計ソフトの仕訳形式との互換性
- 消費税区分、所得区分、供用日、資産単位や処理方法の自動確定
- 外部相場の自動取得、原本の真正性や法定保存の保証
- 旧実行版との同一DB共有、クラウド同期、複数PCでの同時編集

形式・保存の自動試験と、実ブラウザ・狭幅画面・Windows実機での視覚確認は別の検証です。この説明は、実施していない視覚確認や配布・デプロイの完了を示しません。
