# DevTax 技術設計

Version: 0.5

Date: 2026-09-08

Decision status: 製品仕様v0.5の採用設計。新しいモデル・API・状態遷移は実装目標。

[製品仕様](PRODUCT_SPEC.md)が目的と責務を定め、本書はデータ・計算・保存・API・失敗時の契約を定める。[要件対応表](docs/design/requirements-matrix.md)で接続状態を追跡する。現行コードの説明は[設計図01〜19](docs/design/workflow-blueprint.html#status)へ、旧技術設計は[保存版](docs/design/archive/TECHNICAL_DESIGN.v0.4.md)へ分離する。

## 1. 採用構成

1台のPCでReact、Fastify、Node.js、SQLiteを動かす。履歴を読むAdapter、費用・判断・年次計算の純粋関数、トランザクションを管理するapplication service、永続化repository、表示とexportを分離する。

```text
ブラウザ / React
  今回の確認・制作物・支払と配分・今年と翌年・記録と相談
                 │ loopback API / DTO
                 ▼
Fastify → application service
  読取: 一貫したsnapshot → 共通projection
  更新: validation → expectedRevision → transaction → 新revision
  採用: 入力・観測・方式・結果を固定 → ReviewRevision
                 │
     ┌───────────┴──────────────────┐
     ▼                              ▼
Node filesystem / Adapter          純粋関数
source別走査・取得品質              期間帰属 → 費用基礎 → 配賦
正規化usage・cache                 → 処理候補 → 残高移動 → 年次照合
     │                              │
     └────────── SQLite ────────────┘
       観測cache / 編集draft / 採用版 / 訂正版
       契約・原額・事実・根拠・方法 / 種類別残高
                                  │
                                  ▼
                  同一採用版の画面・Markdown・JSON
```

現行のReact 19、Vite 8、TypeScript 6、Fastify 5、Node.js 24.14以上、node:sqlite、Zod、Vitestを再利用する。特定のフレームワークを入れ替えることを完成条件にしない。SQLへドメイン判断を散在させず、画面側で税務・年度別の別計算をしない。

Cloudflareは合成デモの静的配信であり、製品本体の計算・保存先にしない。外部LLMは根幹の計算経路に置かない。標準導入でDocker、別DB、各PCの常駐クライアントを要求しない。

## 2. 実行とデータ境界

現行の開発コマンドは `npm ci`、`npm run dev`。Viteは127.0.0.1:5173、APIは127.0.0.1:4317。通常は `npm run build` 後の `npm start` で同一APIがdistも配信する。Releaseはbundle済みNode serverを起動し、利用者のnpm installは不要。別ポートを選ぶ場合はAPI、Host検査、proxyを整合させる。

データはOSのユーザーデータ領域へ置く。Windowsは `%LOCALAPPDATA%/DevTaxRadar`。リポジトリ、公開dist、Releaseへ個人DBやsaltを混入させない。

| 境界 | 保存・読取・応答の契約 |
| --- | --- |
| 元JSONL | 明示したroot以下を読取専用。本文・コードを正規化usageへコピーしない |
| source設定 | root絶対パスは専用設定と専用APIだけに保持。通常集計や出力へ伝播させない |
| 既定ローカル参照 | native ID・原本パスは隔離した参照領域。明示操作による短いpreviewと再開情報だけに使う |
| 追加source | 原本本文のpreview/resumeを提供しない。ハッシュ化したキーと来歴を使う |
| 証拠 | 参照と説明、発生日・記録日。数値snapshotを証拠原本保存の代わりとしない |
| 採用版 | 正規化寄与・入力・方法・計算・未解決事項。原本本文や秘密参照は除外 |
| 相談出力 | 原額と根拠説明を含む。秘密参照を構造で除き、自由記述はpreviewで確認可能 |
| 合成デモ | 実データAPIを探索しない明示モード。実API失敗による切替は禁止 |

Hostは起動したloopbackのportまで照合する。更新要求はCSRF tokenとOrigin検査を使う。Origin欠落をCSRF不要としない。入力schemaはstrict、本文サイズは操作に応じて上限を設ける。大きな採用snapshotをブラウザから丸ごと信頼して受けず、サーバーがDBから組み立てる。

## 3. ドメインと識別子

以下はv0.5の論理モデル。型名は設計契約であり、現行の同名型が既に満たすとは限らない。

| 概念 | 主な情報 | 関係・制約 |
| --- | --- | --- |
| Product | 名前、用途、説明、作業状態 | folderとは別ID。複数の単位候補・用途状態を持つ |
| TaxUnitCandidate | Product、独立した効用、改良計画、前身・承継対象 | 版番号・フォルダと一対一に固定しない。循環する承継を拒否 |
| ActivityFact | 対象、用途、活動、発生日/期間、記録日、確認状態、根拠 | observed / estimated / confirmed / unknown / conflicted。訂正元IDを保持 |
| Evidence | 種類、説明、発生日、記録日、対象 | privateなlocalReferenceはDTOで分離 |
| SubscriptionContract | provider、実契約ID、期間、請求との関係 | 同providerで複数契約可。sourceとの対応も有効期間付き |
| ExpenseSource | 原額、通貨・円換算根拠、日付、利用期間、契約、証拠 | 一つの原額から複数寄与。訂正・返金は元IDを参照 |
| CostBasis | source、対象期間、種類、算定額またはnull、理由、方法版 | 支払額と償却等の基礎額を分離。親の寄与を参照して多段階原価を表現 |
| AllocationPolicyRevision | 契約/期間、方式、重み、時間帯、業務率、捕捉外状態、根拠 | 変更は新しい版。数値だけで本人確認済みにしない |
| CostContribution | basis、対応先、活動、期間、整数円、配賦の出典 | basisごとの保存則。二重採用・循環を拒否 |
| DecisionCandidate | 対象、rule/版/適用日、入力事実、状態、理由、額、質問 | 根拠不足の額はnull。既知の小計と未知を別に返す |
| BalanceAccount | 単位、残高種類、通貨、起点 | construction / asset / prepaid等を分ける |
| BalanceMovement | account、対象日、種類、整数円、出典、decision、transfer ID | 振替の両側を同一IDで対応付け、自己参照や片側採用を拒否 |
| MethodScenario | 同じ事実snapshot、方法、条件、年別結果、仮定 | 採用版とは別。仮定が既存事実を書き換えない |
| PeriodProjection | 入力revision、観測revision、対象期間、費用・残高・未判断 | 全画面・出力の共通契約。計算hashとengine版を含む |
| AnnualReview | 年度、採用範囲、前年度版、期首・増減・期末、未判断 | 採用した前期末から接続。重複範囲を重ねて集計しない |
| ReviewRevision | 採用対象、固定した入力/観測/方法/結果、日時 | immutable。private参照や生本文を含めない |
| CorrectionRevision | 元revision、理由、変化した事実/方法/金額、影響年 | 元版を残す。後年度へ差分候補を生成する |

現行の共通ExpenseSourceはoriginalAmountJpyの整数円とnullを区別する。nullの場合はunknownOriginalAmountReasonsに空でない理由を必須とし、既知額には不明理由を付けない。不明原額から数値のroot費用基礎は作れず、未算定基礎として理由と影響先を残す。他の費用の計算は継続する。支払画面と作業中Markdownにも「原額 不明」と理由を表示する。直接費・自宅費用・設備と、利用期間を指定したAI請求の原額は空欄と理由をUI・API・SQLite保存へ接続した。起動時は旧DBの検証済みbackup後にnullable列と理由の整合制約へ原子的に移行し、記録と順序を保持する。AI請求額が不明なら対象の各月・各年に理由付き未算定基礎を残し、数値の配分を生成しない。同期間の既知請求は独立して計算する。AI概要は確認済み分の小計と明示し、不明請求がある間は金額境界表示を保留する。月別上書き料金もamountJpy=nullとunknownAmountReasonをUI・API・DBへ接続。明示した不明月を既定月額で補わず、対象月の費用源と未算定理由を保持する。上書きなしは行なし、確認済み0円は数値0で区別する。月別料金の理由不足・理由長超過・不正金額は、クライアントの共通確認関数で月とサービス名を含む日本語の案内にする。入力欄と途中保存・影響確認・最終保存へ接続し、修正まで入力を保持する。サーバーの厳格な検証も維持する。既定月額もchargesのnullとunknownChargeReasonsで不明を保存する。既知の0円は再表示しても0のまま保持し、空欄は「既定月額が未入力です。」という理由付きnullとして保存する。二度押しによる空欄の0円採用は廃止。新規DBの既定料金は未入力のnullとし、旧DBの既存料金はINSERT OR IGNOREで保持する。明示操作で不明へ変更し理由を入力する。provider_settingsは検証済みbackup後に金額と理由の整合制約へ移行し、既存料金・契約期間・rowidを保持する。月別上書きがあればそちらを使い、なければ既定月額の不明を未算定基礎へ伝える。入力控えは未完成の理由も保持し、競合解決は既定月額と理由を一組で選ぶ。従来の数値だけを想定したDTO利用側はnullに対応する必要がある。期間指定AI請求には登録済み根拠のevidenceIdsを対応付ける。UI・厳格schema・DBのJSON列・費用源・配分明細・年度固定資料・Markdownへ同じ参照を渡す。旧DBには検証済みbackup後に列を追加し、未収録と明示した空配列を区別する。参照先がない場合はIDを捨てず費用基礎の警告と入力欄で示す。証拠の原本パスは従来通り固定資料へ含めない。費用明細と金額追跡にはEvidenceReferencesを配置し、参照先の説明・出所・対象日・記録日時を表示する。記録日時は表示環境のタイムゾーンへ変換してゾーン名を明記し、保存した瞬間は変更しない。対象日未記録を記録日時から補完しない。期間指定AI請求はProvider・利用開始日・利用終了日・既知原額の一致をduplicateChargeGroupsで検出する。null同士を同額とは扱わない。入力行の重複候補を案内し、費用基礎の警告・固定年度資料・Markdownへ同じ注意を残す。候補の金額は自動除外/統合しない。部分期間の重なりも同Providerの実在する利用日付で検出し、金額不明を除外しない。終了日を含む区間の連結した組を表示し、全件の同日重複とは区別する。同額同期間だけの組は重複候補の表示へ集約する。注意は入力画面・費用基礎・固定年度資料・Markdownへ接続。入力画面は全請求を確認するが、年度計算の注意はその年度に利用期間がかかる請求だけで検出する。原期間や原額を切り詰めて同額判定を作らない。将来だけの請求が連結することを理由に過年度の注意や訂正判定を変えない。期間指定請求の優先順位はサービス・対象月ごとに判定する。該当月は月額概算を加算せず、別月は月別上書き、なければ観測月の既定月額へ戻る。明示した契約期間の制限は維持する。月の一部だけを覆う請求では、対象日外の利用へ残りの月額を推定配分しない。将来請求の追加で過年度の既知額・0円・不明額・根拠を落とさない。契約確認は既存のcontractConfirmationで保持する。所定形式の取込元キーと内容照合は後述の原始請求取り込みへ接続し、任意の事業者請求書からの番号抽出・照合は行わない。通常画面は保存済み計画の根拠、採用前はpreview、保存版は同じ固定資料の根拠だけを渡す。説明未収録・参照先欠落・ID重複を区別し、現在値の自動取得で旧版を補完しない。原本パスや任意HTMLは表示・実行しない。

円額は安全な整数で表現し、未算定は0とは異なる型で扱う。割合は有界値と根拠、計算内部は端数規則を固定する。返金の符号を単純な非負入力へ通さず、調整として対象期間と元費用源を検証する。

日付は実在するcalendar dateとして検証する。瞬間はUTC、期間帰属は採用timezoneを持つ。請求日、支払日、利用期間、取得日、供用日、記録日を同一フィールドにしない。後日の復元を当時の記録として扱わない。

日付欄の実装はDateInputに統一し、native input/changeの双方で値を文字列として取り出して編集状態へ渡す。Onboardingの13か所とBalancesPageの1か所が対象。表示だけ更新され保存値が古いままになる経路を回帰テストで検査する。空欄は各項目の既存の未入力契約に従い、月単位の欄は別処理とする。

## 4. 収集・観測品質・契約の対応

既存Adapterとsource単位の走査キューを再利用する。既定ローカルの識別子を維持し、追加sourceにはsource由来saltを使う。source間でキーを分けることと、実利用の複製を見つけることを別責務にする。

| 工程 | 入力 → 出力 | 失敗・不明の契約 |
| --- | --- | --- |
| 到達確認 | source root → 読取可否・一覧取得可否 | 認証と共有接続はOS。probe成功をAdapter互換の証明にしない |
| ファイル一覧 | 明示root → 不透明file keyの集合 | 完全列挙できなければ消失扱いで既存寄与を消さない |
| 増分判定 | size/mtime/adapter/schema → reuseまたはparse | cacheは観測の最適化。採用版の保存機構に兼用しない |
| Adapter | JSONL → 正規化usage・精度・警告 | 不安定/不適合fileは前回有効寄与を保持し、新規不適合は未取得として表示 |
| 集約 | source/契約/期間 → 観測snapshot | source全体I/O失敗は旧snapshotの古さを明示。正常走査で原本が消失しても取込済み数値を保持し、未検証の寄与として来歴へ反映 |
| 重複確認 | 同一契約内の複製候補 → 採用sourceの対応 | 異なる実契約の利用をnative IDだけで除外しない |
| 時間対応 | 観測時刻 → 費用対象期間・活動期間 | 形式が持つ以上の時間精度を生成しない。方式版と制約を保存 |

現行Claudeはmessage usage、Codexはfile内の累積スナップショット差分を使う。この差を保存・表示し、cache/reasoningの包含関係を検証した定義で重み付けする。Codexを正確なturn別配賦として表示しない。Adapter更新で粒度が変わる場合も旧採用版は維持する。

### Codexのアーカイブ移動・原本不在と数値保持

既定のlocal-codexはsessionsと兄弟archived_sessionsを同じsource ID・識別子saltで読み、追加sourceは指定したroot内だけを読む。既定sourceの再接続でもroot名がsessionsの場合だけ兄弟archiveを対象とする。両既定rootがない場合はunavailableで前回snapshotを保持する。一部rootが読めず一覧を確定できない場合も、正常走査による不在とは扱わない。

同じsource/provider/sessionについて採用するファイル寄与は一つ。現在見える候補、通常/configuredルート（sourceRank 0）、既定archive（sourceRank 1）、新しいmtime、同値ならfileKeyの順に決定的に選ぶ。複製を加算せず、現在利用可能な選択コピーでセッション全体を置換する。過去最大値へ固定せず減額訂正も受け入れる。選択順は真の最新版を証明するものではなく、異なるsourceのコピーまで同一視しない。

正常に一覧取得したsourceで、前回取り込んだファイルが見つからない場合、その数値寄与を保持してFileCapture.stateをmissing-retainedとする。古いusage_eventsや再接続後など、使えるファイルcacheとの対応がないセッション集計はunverified-retainedとし、存在しないイベント明細や時刻精度を作らない。再取得できた同じセッションは旧集計を置き換える。unavailable/failedはsource statusとして残し、missing-retainedは最後に正常走査できた時点の不在、unverified-retainedは対応未確認として区別する。削除・移動・未観測の原因は確定しない。

走査API diagnosticsのfilesMissingRetainedは数値寄与を保持した不在ファイル数（採用されなかった複製は除く）、sessionsUnverifiedRetainedは対応未確認セッション数。数値記録一覧は任意フィールドmissingRetained/unverifiedRetainedで同じ単位を返し、古い応答を読むUIは未収録の件数を0とする。completeは走査の完了を指し、保持・保留した寄与の最新性を保証しない。保持状態を数値記録、費用の来歴警告、画面・JSON/Markdownへ渡し、現行データで過去の保存版を補完しない。

保存対象は取り込んだ数値・不透明参照・取得来歴で、会話本文は保存しない。取り込み前に削除された履歴の復元、原本バックアップ、税務上の証明・法定保存の適合は提供しない。検証は合成fixtureと一時ディレクトリで行い、実際のCodex履歴を読まない。

capture statusはobserved、stale、estimated、unknown、conflicted等を契約×期間で持つ。未知割合に既定値を自動採用しない。旧snapshotと捕捉外の留保を二重計上しない。

保持期間の検出と任意変更は独立操作。現行Claude設定は既存JSON検証、非上書きbackup、同directoryのtemp、renameで更新する。設定不正時は上書きせず、元履歴を削除・改変しない。Codexや追加sourceの設定変更を提供済みとしない。

## 5. 共通projectionの計算契約

application serviceは編集revisionと観測revisionを一貫したread snapshotで取り、次を純粋関数へ渡す。保存・再計算・画面・exportはこの契約を共有する。

1. 期間帰属: 契約・利用期間から対象月/年への原額の対応を求める。日割りの包含端点、timezone、端数順序を方法版で固定する。
2. 費用基礎: 原額と対象期間、設備等の条件から基礎を算定。不足はnullと理由。原額の表示は残す。
3. 配賦: 直接対応を適用し、共通費だけを採用した基準で複数対象へ配分。private/general/unallocated/unobservedを分離する。
4. 原価形成: 親basisと子contributionを出典で接続。依存グラフを検査して循環・同一寄与の二重組入れを拒否する。
5. 判断候補: 期間ごとの活動事実・利用状態・単位・適用条件をrulesへ渡す。不足を限定し、既知部分を計算する。
6. 残高: 採用した方式と事実に基づく増加・費用化・振替・終了等を種類別accountへ投影する。
7. 年次照合: 期首と前年度の採用版、増減と期末、未判断範囲を照合する。
8. 結果: 金額、出典、質問、状態、方法版、前期版、計算hashを返す。

```text
basis額 = product + general + private + unallocated + unobserved + rounding
account期末 = 期首 + 増加 + transferIn - transferOut - expense - otherDecrease
transferInとtransferOutは同額・同通貨・同一transfer ID
採用前期末 = そのrevisionを参照する翌期首
```

全体の支払額と当年費用を同額とする不変条件は置かない。設備購入とその償却額と制作物原価への組入れを同時に費用へ加算しない。確定していないbasisがある場合、算定済み部分の保存則と未知の原額を別に報告する。

## 6. ルールと質問の契約

ルールはID、版、対象法域/所得、根拠URL、確認日、適用期間、必要事実、候補・算定関数、例外、検証状態を持つ。法令の施行と資料の公開・確認日を区別する。法人の資料や大綱を個人所得税の確定ルールとして流用しない。

| 判定状態 | 応答 |
| --- | --- |
| calculable | 金額と候補、根拠、採用に必要な確認 |
| conditional | 仮定・必要条件と、その条件での費用・残高。採用済みと混同しない |
| missing-facts | 欠けた事実、理由、対象期間・影響額、回答による違い |
| conflicted | 相反する出典と影響。暗黙優先をしない |
| expert-review | 解釈論点と関連資料、回答を取り込む対象 |
| unsupported | 未対応処理と影響範囲。他の既知部分を止めない |
| excluded | 私用等の理由と対象額。未知とは別 |

新規制作、保守、改良、制作原価、前払、少額等の方法、終了・承継について、対応範囲は条件と計算まで一組で提供する。現行taxDecision/assetThresholdsを無検証で接続せず、入力事実からの対応表と時点別fixtureを用意する。税務テスト成功と根拠確認の状態を別に記録する。

方法比較は同じfacts snapshotを基準とし、各方法の適用条件、拘束・継続性、年度別費用・残高を返す。仮定を変える場合は差分を明示したscenarioへ分離し、draftの事実を変更しない。

## 7. 保存・採用・訂正のトランザクション

全体のイベントソーシングは要求しない。編集テーブルと観測cacheに、固定snapshotと残高移動の出典を追加する。

| 操作 | 検証と原子性 | 失敗時 |
| --- | --- | --- |
| draft保存 | expectedRevision、参照整合、期間・金額を検証。同じ単位の変更は1 transactionで保存してrevision増加 | 競合409は新revisionと差分再取得の手掛かり。部分成功を完了としない |
| projection | 編集と観測のsnapshot IDを固定。結果hashに方式・rule・engine版を含む | 不正・未知の対象を構造化して返す。未知を0へ補正しない |
| 採用 | clientは見たprojectionのtoken/hashとexpectedRevision、対象範囲を送る。serverが同じsnapshotを再確認して入力・結果を固定保存 | 間に変更があれば409。最新結果を無断で採用しない |
| 採用の再送 | idempotency key＋入力hashを記録。同一key同一内容は同一revisionを返す | 同一key異内容は拒否。timeout後の再送で重複採用しない |
| 年度接続 | 参照する前年revisionと対象範囲、既存採用範囲の重複を検査 | 未判断の期末を既知の翌期首へ補完しない |
| 訂正 | 元版＋理由＋新snapshot＋差分を同一transaction。後年度への影響を候補として作る | 元版と既存の後年度採用版は保持 |
| 出力 | revision IDで保存済みprojectionを読む。export schemaをallowlist化 | 未対応schema/formatは明示拒否。現在のdraftを混ぜない |

現行workspaceはapp_settingsの版番号を照合する。旧config/planning/rulesの書込も版を増加し、値が元に戻った変更も検出する。一括保存では料金と計画の版増加が同じcommitで公開される。直前要求ID・内容fingerprint・結果版の1件を保存し、現行版がその結果版のままなら同じ要求を再書込しない。途中に別保存があった再送は409。任意の過去要求の応答や採用版を再生する仕組みではない。競合時はworkspaceMergeで変更前・入力・最新を記録単位に比較する。片側だけの変更はその側を選択し、両側で異なる変更は明示選択する。IDで追加・削除・変更を照合し、金額・割合・期間・理由の項目を勝手に混ぜない。最新読取失敗の再試行、入力を保持して戻る操作、選択後の版再照合と再競合に対応する。選択結果は入力データだけを返し、保存時のschemaが参照関係を再検証する。POST /api/workspace/previewは同じ読取snapshotの利用記録を一度取得し、保存前後の入力を純粋計算へ渡す。登録範囲内の各年の費用基礎・配分・未算定とAI分類候補を比較する。最古年から最新年まで連続200年以内（1900〜9999年）を全件表示し、超過は400で拒否する。入力・観測・計算結果・timezone・engine版を含むhashを、PUTのBEGIN IMMEDIATE内で書込前に再計算して照合する。不一致はpreview_changed 409で再確認、版競合は3版比較・選択後に新しいpreviewへ戻る。最終保存と分類変更はpreviewを経由するが、途中draft保存と旧APIは必須化していない。採用残高と税務判断への影響は未接続。

複数タブ・途中失敗・再送・走査との競合を合成DBで検証する。採用対象期間のoverlapは選択中の有効版で解決し、元版＋訂正版を合算しない。原本参照可否は採用額と独立した最新状態として返す。

## 8. APIの目標契約と現行対応

以下はv0.5の完成形の契約。現行は31ルートで、GET /api/projectionsは費用基礎・寄与・未算定の部分を接続済み。GET/PUT /api/workspaceは旧料金設定と計画の一括読取・保存、expectedRevision、直前要求の再送照合を接続済み。採用snapshot ID・残高・計算hashまで完成したものではない。その他の新規パスは設計予約であり追加済みとはしない。名称を変える場合も責務・原子性を維持し、本表を更新する。

| 責務 | 目標の入口 | 応答・更新契約 | 現行との関係 |
| --- | --- | --- | --- |
| 編集読取・保存 | GET/PUT /api/workspace | scope、expectedRevision、事実・費用・方法のDTO | 現在は旧configuration/planningを共通transactionで保存。競合比較・記録単位の選択保存を接続。費用基礎とAI分類の影響previewを接続。事実・方法の新規編集DTO、税務・採用残高の影響は未接続 |
| 共通計算 | GET /api/projections?year=… | snapshot IDs、費用・残高・状態・出典・hash | 現在は費用源・基礎・寄与・未算定・engineVersionを返す。dashboard.costProjection、ledger、作業中Markdownが使用。残高・採用・hash・diagnosis統合は未完了 |
| 方法比較 | POST /api/scenarios | facts snapshot、方法・仮定、年度別比較 | 同額の申告条件カードから責務を分離 |
| 採用 | POST /api/reviews | projection token、scope、idempotency key → revision ID | planning_decisionsの可変recordだけでは不足 |
| 採用版・年次 | GET /api/reviews、GET /api/reviews/:id | 元版・有効版・前期参照・結果 | 新しい固定snapshotの読取経路 |
| 作業中費用の影響確認 | POST /api/workspace/preview | expectedRevision、configuration、planning → 年別前後projection・分類変更・previewHash | 接続済み。DB仮書込なし。hash付きPUTで再照合。採用版ではない |
| 訂正 | POST /api/reviews/:id/corrections | expectedRevision、理由、変更対象 → 訂正版・影響年 | 全置換から訂正来歴を持つ操作へ |
| 出力 | GET /api/reviews/:id/export?format=… | 同版のMarkdown/JSON、schemaVersion | planningだけのMarkdownを完全な採用資料へ |
| バックアップ/復元 | ローカル専用application service | consistent snapshot、manifest、検証、復旧 | 外部公開APIにしない。操作結果と再接続対象をUIへ返す |
| 履歴/source/retention | 現行APIを継承 | 観測品質と契約対応を追加 | source queue、read-only、原本参照境界を維持 |

既存APIの互換期間でも、同じ処理を二つの異なる計算で返さない。view DTOとして共通projectionから変換し、旧契約で表せない未知状態はunsupported等として扱う。

今回の/api/ledgerはAnnualCostProjectionへ切り替え、旧PlanningLedgerの数値だけのDTOとの互換を維持しない。Appはdashboard.costProjectionを参照する。旧buildPlanningLedgerは履歴コードとして残るが製品API・実データ画面・通常exportからは呼ばない。共通結果の読取はSAVEPOINTで設定・計画・観測を同じDB snapshotに揃える。出力の計画記述も同じ読取境界に含める。

## 9. 画面への接続

編集画面を開くとeditorBaseへ料金・計画・版を固定する。履歴再走査や背景再読込は表示用workspaceを更新するが、編集中の入力と保存元の版を置換しない。追加の履歴月だけ編集側の料金から補う。保存・previewは編集元の版を使い、自分の保存成功時に編集元を更新する。遅れて届く再読込は連番で照合し、新しい読取や保存結果を古い結果へ戻さない。画面閉鎖・ブラウザ再起動後はdatasetId・保存元revision付きの編集控えを明示復旧でき、復旧だけではDB保存・preview・本人確認を行わない。

Reactは現在のscope、draftの保存状態、projection token、採用revisionを持つ。費用・残高・税務候補は再計算せずサーバーの共通結果を表示する。入力の即時previewを行う場合も同じ純粋関数と同じ契約に限定し、採用計算はサーバーを正とする。

候補整理は全候補と番号によるグループ化を継承する。税務分類や供用の本人確認をグループ化時の既定値で作らない。明細からの期間ルール変更は対象セッション・期間・差額をpreviewし、そのtokenを保存時に確認する。

主な導線は、今回確認すること → 制作物/支払/出来事 → 今年と翌年 → 記録と相談。専門用語と原額・ruleへの追跡は詳細へ置く。変更なしの情報は再入力不要。非該当と未判断を区別する。

起動モードはlocalとsynthetic-demoを明示する。local API failureは再試行可能なエラーとして表示し、demoへfallbackしない。公開合成デモは独立したfixtureの共通projectionを使う。

## 10. 移行・バックアップ・利用終了

旧DBを破壊して新方式へ再走査する移行にしない。schema変更前に一貫したbackupを作り、integrity、schema/checksum、必要ファイルを検証する。saltと識別子の対応を保持する。既存の曖昧な入力は出典付きlegacy assumptionとして引き継ぐ。

schema migrationはtransactionとmarker/checksumで管理する。中断・再実行を検証し、失敗時は旧記録を読める。旧方式との差分は対象年・粒度・方法等の理由付きで示し、古い誤りとの一致を合格条件にしない。

backupはWALを考慮したSQLiteのsnapshot方式を使い、稼働DBファイルだけを単純copyしない。別PC復元では旧saltを保持し、source rootを明示的に再接続する。復元先を検証し、既存DBの退避と切替を一貫して行う。部分復元を成功にしない。

JSON exportはschemaVersion、engineVersion、対象範囲、revision、通貨・日付・金額の意味、出典の非秘密IDを持つ。これは私的参照を含む完全DB backupとは別。利用終了後はMarkdownと仕様付きJSONを読め、未対応schemaの読込で項目を黙って捨てない。

## 11. 品質・配布・証拠

計算と保存は合成fixture・一時DBで検証する。採用金額の保持、競合と再送、移行・復元、原本消失、共有切断、月/年境界、返金、複数契約、原価の多段階接続、旧版と改良の併存、年次訂正、方法比較を含める。

| ゲート | 何を証明するか | 限界 |
| --- | --- | --- |
| typecheck / lint / format | 型と静的整合・書式 | 保存や税務の妥当性の証明ではない |
| core/API/repository tests | 保存則、状態分岐、transaction、競合、再送 | 法令根拠の検証は別の状態で管理 |
| Windows実行 | ローカルAPI、UNC入力境界、保存・復元、更新の実行契約 | すべての利用者環境への到達性を保証しない |
| browser受入 | 目的からの導線、未知表示、採用・訂正・出力、16px以上の主作業 | 静的DOM検査と実画面確認を区別して記録 |
| build / privacy | distと配布allowlistへの漏れを検査 | 個人の実ログやDBをCIへ送らない |
| Release実行 | 展開物のNode起動、health、合成入力で主要契約 | node --checkのみを起動smokeと呼ばない |
| 合成デモ | 実データと独立した明示モード、共通計算の例示 | 公開デモ成功をローカル製品の保存検証としない |

現行GitHub CIはPR/mainでtype/test/lint/format/build/privacy、Releaseはv*でtype/test/lint/build/privacy/packと公開を行う。Releaseにformat検査はない。release:packでbundleの実サーバー起動・静的配信・backup/復元・再接続・再起動を隔離領域で検証する。Cloudflare合成デモは手動deployの別経路。

検証結果は実行日、対象HEADと差分、fixture、環境、コマンド、成否、未実施を記録する。現行の過去証跡をv0.5完了証拠として扱わない。

## 12. 正本と更新規則

製品責務はPRODUCT_SPEC、技術契約は本書、要件と実装・受入の対応はrequirements-matrix、図と現行経路はworkflow-blueprintが担う。設計変更は対応する要件ID・契約・図・受入条件を同時に更新する。実装状態はコードと検証証跡を基準に更新し、文書の採用だけで接続済みにしない。

ハッカソン審査用ピッチやMVPの見せ場は旧版の履歴へ保存する。実装順序を完成形の範囲と取り違えない。現在のsourceの詳細は設計図の参照索引から確認できる。

### 現行年次概要の接続

SummaryPageはplanning.profile.taxYearと一致する共通costProjectionをAnnualOverviewへ渡す。別年・欠損なら資料未取得を表示し、0円やAI額を代用しない。費用基礎・制作物・通常業務・未算定件数を表示する。対応済みのソフトウェア・設備方法は選択済み条件から年度額と残高へ接続するが、未対応・不明な処理まで概要で確定額へ昇格させない。概要の同額3申告区分カードは撤去した。

AI dashboard APIは全期間を保持し、月ごとのmonthKeyを付ける。annualAiViewで概要の月とAllocationを対象年へ限定する。旧APIの年付き日本語ラベルは読めるが、年のない短い月名は当年と推定せず除外・件数表示する。合成demoの年はfixtureで明示する。AIサービス・制作物フィルターはAI内訳だけに適用し、全費用概要は不変。全期間のAI参考境界、根拠画面、初期設定結果、採用版を中心とする年次UXへの統一は未完了。
### 残高の製品DB・API接続

起動時にbalance_draft、balance_reviews、balance_review_headsと固定版の更新・削除拒否triggerを初期化する。既存DBに残高表がなければ、事前にVACUUM INTOとintegrity_checkでbackupを確認し、他のschema変更と同じtransaction内で追加する。既存の料金・計画・利用履歴を残高へ自動変換しない。

GET /api/balances/draftとPUT /api/balances/draftは残高専用revisionで作業中のsnapshotを読み書きする。PUTはOrigin・CSRF、2 MiB上限、strict schema、全履歴の日付・残高内参照・整数円・日別非負の検査後、BEGIN IMMEDIATEで版を照合して一括保存する。不正400、競合409。workspace版と独立しており、共通入力との一括保存と再送receiptは未接続。

GET /api/balances/preview?year=YYYYは保存済みdraftの年度計算と当年・前年の採用headを同じ読取snapshotで返す。GET /api/balances/reviewsは一覧と前年訂正の未反映、GET /api/balances/reviews/:idは保存した固定版を内容hash・schema・ID検証後に返す。固定版の結果を最新engineで再計算しない。

これらの応答はscope.kind=recorded-balances、costAndDecisionReferencesVerified=false、adoptionAvailable=true、taxTreatmentVerified=falseを明示する。制作物・費用・判断の外部IDの存在と意味の照合、共通費用からの残高生成、年度資料の採用・訂正はPOSTと確認画面へ接続。現行残高APIで入力された移動を自動的な税務計算の結果とは扱わない。
### 残高の入力・年次表示

BalancesPageは初めて開いたときにGET draftを読み、専用版とsnapshotを保持する。主画面を切り替えてもコンポーネントを維持し、未保存入力を破棄しない。計画や費用が背景更新されても残高draftを自動置換しない。表示年は残高画面で独立して選び、保存済みまたは編集中のsnapshotを共通のbalanceSnapshotSchema・annualBalancesで検証・計算する。計画年を保存変更する操作ではない。

制作中・資産・前払の期首は、制作物・記録開始年・既知の整数円または理由付き未知を入力する。増加・費用化・その他減少・振替は、日付・額・対象・根拠と判断を選んで記録する。振替はfrom/toを持つ単一レコード。参照される残高は削除不可。既存の未判断記録は保持・年次表示し、この画面では新規登録・解消操作をまだ提供しない。

保存はCSRF取得後に専用版とsnapshotをPUTする。入力・保存中の二重編集を防ぎ、成功時は返された版を採用。失敗時は入力を残し、競合409では保存を止める。利用者は明示的に入力を破棄して保存済みを再読込できる。残高は変更前・この画面・最新の3版比較と、datasetId・保存元revision付きの未保存draft復旧を接続済み。復旧・競合選択だけでは書き込まず、年度資料の採用・訂正も確認画面で別操作とする。

判断の選択肢は既存のconfirmed/overridden記録。根拠は登録された費用・証拠の候補から選ぶ。外部参照の整合・適用条件を自動確認したことを意味しない。確認済み判断がない場合は不足を表示し、月次確認の費用画面にある判断記録の登録へ案内する。架空の判断IDを生成して増減保存を通さない。会計上の確定額として概要へ昇格させる経路もまだない。
### 本人による処理判断の記録

DecisionEditorは月次確認の費用画面で、制作物・対象年・検討した扱い・確認した扱い・根拠と確認先を記録する。明示的な本人確認でconfirmed/overriddenとconfirmedAtを設定し、内容変更はmanual-decision/1・pendingへ戻して確認日時を除く。workspace経由で料金・計画と同版保存・競合処理を行う。

新形式manual-decision/1の確認済み保存には、選択した扱い・空でない根拠・作成時以後の確認日時が必要。pendingに確認日時は付けない。旧形式の読取は互換性を保つが、残高画面の選択肢はdecisionIsConfirmedで必要情報がそろうものへ限定する。未確認へ戻った判断を指す既存残高draftの参照は消さず、現在の確認済み一覧にない参照として表示する。参照の再照合・固定版・判断の適用条件検証は別の未完了責務であり、本人確認だけで自動税務判定の結果へ昇格させない。
### 残高と現在の資料の参照確認

checkBalanceReferencesは残高を変更せず、制作物の存在、費用・証拠参照の存在と衝突、判断の確認状態・対象年・制作物、未判断と対応残高の制作物を確認する。振替は移動元と移動先の両方を確認する。表示年にかかわらず保存された記録全体を検査する。

GET draftとGET previewではreadWorkspaceの同じSQLite読取snapshotから残高・計画・料金を読み、referenceCheckに問題のコード・対象記録・参照先・説明とworkspaceRevisionを返す。GETは入力や残高版を変更しない。費用・判断の更新後の再読込で問題が変化する。採用済み固定版は現在の資料で再計算しない。

BalancesPageは読込時の報告と料金・計画の版を表示し、編集中は画面にある資料を使って再計算する。取得できない資料の確認を成功とは表示しない。問題を残した下書き保存は許可する。参照検査は金額の由来、証拠の内容、税務の適用条件、期首の採用版の整合を保証しないため、costAndDecisionReferencesVerifiedはfalseを維持する。adoptionAvailableは年度資料の固定保存操作としてtrueとし、税務検証済みとは扱わない。
### 費用・判断・数値観測を含む残高資料の固定

ReviewMaterials（review-materials/1）は対象年・workspace版・timezone、料金、計画と判断、原本所在を除いた証拠情報、数値利用量、走査timezoneと直近10件の走査結果、年度費用projection、参照確認を保持する。利用量は全取得期間を含め、年跨ぎ契約の計算入力を省略しない。sourceとセッションの識別はSHA-256による参照へ置換し、source名・projectLabel・元のsessionKey・証拠localReferenceは持ち込まない。自由記述に本人が書いた個人情報を自動的に匿名化する保証ではない。

GET balances/previewは同じSQLite読取snapshotから資料一式と残高を組み立て、材料を含むprojectionHashを返す。repositoryの採用は同じreaderをBEGIN IMMEDIATE内で実行し、入力・判断・観測・走査結果の変更をhashで検出する。参照に問題がある資料は採用を拒否する。既存のimmutable payloadにmaterialsを加えるので表の再作成は不要。旧版はmaterialsなしで読めるが、資料付きの現行版または前年版から、残高だけの版へ移行する採用を拒否する。

再送は保存済み要求と照合して元の資料を返し、現在の入力が削除・更新されても再計算しない。hashは資料を含む保存内容全体を検証する。API読取とrepositoryの固定保存を合成DBで接続検証した。製品の採用write API/UIは、資料の再読取・hash照合を必須として接続した。

taxTreatmentVerifiedはfalse。金額の由来と適用条件の検証、過年度の費用・判断の意味の変更と翌年度への影響、全sourceの捕捉状態・adapter版を含む観測契約の完成、同版の完全出力が残る。本機能はこれらを確認済みとするための代替ではない。
### 固定した年度資料の出力

保存版の画面内閲覧: ReviewRecordsPanelで資料IDを選び、GET /api/balances/reviews/:idを明示操作で取得する。返却IDの一致を確認し、StoredReviewPanelが固定した年度残高・費用明細・設備配分根拠・設備計算を表示する。全判断・未解決事項・出典は同じreviewの全説明/全JSONでも参照できる。現在の入力取得や再計算は行わない。別操作・再読込で古い表示を解除し、unmountと世代番号で遅い応答の反映を防ぐ。失敗やID不一致を空資料へ置き換えない。EquipmentAllocationPanelは採用previewにも共用し、対象年以外の配分条件を混ぜない。

CostsPageは操作の可否（readOnly）と資料の状態（recordState: draft/preview/recorded）を分ける。採用前は確認用、保存版は固定された資料と表示し、閲覧専用という理由だけで採用済みと推定しない。設備の制作物割合はnative inputとchangeで更新し、明示的な未確認への復帰操作でnullを保存できる。保存版の割合は変更しない。

複数配分の過年度比較では、targetsがある年度条件から未使用の旧taxUnitId/projectAllocationRatioを比較対象として除く。保存版の原本は変更しない。配分指定の説明もID順にし、入力順だけの変更で過年度訂正を要求しない。業務割合・実際の配分指定・根拠の変更は引き続き比較対象となる。

GET /api/balances/reviews/:id/export はUUIDとformat（markdown/json/accountant-csv、既定markdown）を検証し、getBalanceReviewで保存内容のhashを確認してから出力する。現在の料金・計画・観測を読み直さず、固定した一つの資料だけを対象とする。UTF-8、attachment、Cache-Control: no-store。存在なし404、不正なID・形式・追加queryは400。

reviewExportJsonはexportVersion=1、kind=stored-year-reviewと保存したreview全体を返す。reviewExportMarkdownは資料ID・前年度/訂正元・記録理由、既知/未知の残高、増減・判断・証拠・費用基礎を説明し、同じ全JSONを添付する。JSON内の任意のバッククォート連続より長いコードフェンスを使い、説明の自由記述はMarkdownとしてエスケープする。古い残高のみの資料を最新の費用で補完しない。

BalancesPageの資料一覧は利用者の操作で取得し、読込時の現行版・過去版・前年の変更未反映を表示する。失敗を空一覧として表示せず再読込できる。ダウンロードは資料IDに固定する。この出力はその年度資料を省略しないが、他年度・未保存draft・原本・秘密設定を含む全プロジェクトbackupとは別物。DB全体のbackup/verify/restoreはdataBundleを単一実装とし、CLIに加えてローカルのPC移行画面から同じ処理を呼ぶ。
### 保存版と現在の内容の比較

GET /api/balances/reviews/:id/compare は旧版をhash検証し、同じ読取snapshotで現在の残高・料金・計画・観測と対象年のprojectionを組み立てる。compareReviewは旧版の計算をやり直さず、全期間の固定入力と同じ対象年の結果を比較する。副作用はなく、現在のdraft・保存版を変更しない。

記録配列はid/accountId/observationId/taxUnitIdで対応付ける。IDのない配列は全値を比較し、変更前・変更後を省略せず返す。追加・削除・変更、null、未登録を区別する。番号だけが進んだworkspace/draftは内容変更と混同しない。旧版または現在のmaterialsがない場合はその部分を比較不可とし、差分0や全件新規追加へ変換しない。前年資料の参照変化は別に返す。

ReviewComparisonPanelは比較した資料ID・入力版、旧版の不足、前年参照の変更と各変更の前後を表示する。DB保存済み内容による比較であり、画面の未保存入力は含めない。一覧再読込で古い比較表示を外し、比較失敗は内容差なしと扱わない。訂正の採用操作は接続済み。別年度への金額影響の算定は未接続。
### 年度資料の採用・訂正操作

POST /api/balances/reviews はyear、expectedDraftRevision、projectionHash、UUIDのidempotencyKey、理由（1〜2000文字）だけをstrict検証する。16KiB上限、既存のloopback/Origin/CSRF制約を適用する。ブラウザから資料一式を受け取らず、BEGIN IMMEDIATE内でreadReviewMaterialsを必ず実行する。hash不一致・参照問題・前年不整合は409、不正入力は400。

ReviewAdoptionPanelは残高の保存・競合解消後にpreviewを表示し、費用明細、残高小計、未算定件数、判断、全入力を確認して理由付きで採用する。確認後に入力が変わればサーバーが拒否する。409では確認を破棄して再取得を求め、通信結果不明では同じ要求キーで再送する。成功時には保存版IDとその出力リンクを表示する。同じ年はcorrectsReviewId付きの訂正版となり、旧版を更新・削除しない。

年度資料の採用は利用者が確認した記録の固定であり、税務適用条件・金額の由来の検証完了ではない。不明・未登録をそのまま記録できる。参照の不存在・未確認判断など増減の根拠関係に問題がある場合は拒否する。詳細税務計算、過年度費用の意味から翌年への差額を算定する処理、全体復元は残る。
### 保存済み各年に対する現在入力の影響

GET /api/balances/impact は一貫したreadWorkspace snapshotで料金・計画・残高・数値観測を一度取り、保存済み各年の現行headだけを比較する。訂正前の版を合計へ加えない。現在の入力による各年のprojectionを生成するが、旧版は保存結果を使用する。観測を年ごとに別時点で再取得しない。

ReviewComparison.balanceImpactは各残高の期首・期末のbefore/afterとdeltaJpyを返す。両方が既知のときだけ「現在−保存版」を算定し、不明・片側に記録がない場合はnullとする。金額以外の理由・判断の差は従来の全変更に残す。priorChainChangedは過年度の訂正が参照連鎖へ未反映であることを示す。

資料一覧の「保存済み各年への影響を確認」から年別結果を表示する。採用版を自動更新せず、古い年から確認して訂正版として保存する操作へつなぐ。これは現在の記録一式と保存版の差であり、特定の一変更の因果的な差額、税額、未保存入力、未登録の将来年の予測ではない。税務方式に基づく移動の自動生成は未接続。
### 後年度を採用する前の過年度資料の照合

balanceRepositoryは前年headの参照連鎖を検査した後、接続された過年度のmaterialsを各年の現在の資料と照合する。historicalReviewMaterialsは各年の費用projection、当年直接費・自宅費用・その年の費用源に含む設備、当年判断、費用/移動/未判断から参照される証拠、当年の数値観測、その年までに引き継いだ未判断を取り出す。原本所在は従来通り含めない。

記録IDと文字列の一覧は順序を正規化して比較する。workspaceの版番号、新しい走査日時、その年に影響しない未来の費用・未判断の追加だけで過年度訂正を要求しない。どれかの年で費用・判断・根拠等が変わっていれば、その年を示す409を返す。残高や当年の数字が同額であっても拒否し、過年度の訂正と参照連鎖の更新後に後年度を採用できるようにする。

materialsを持たない旧版は費用の照合対象外で、従来の残高・移動・前年整合の検査を維持する。この検査は保存した根拠の同一性であり、金額の由来の証明や税務適用条件の正しさを保証しない。履歴を持たない可変の全プロフィールを過年度事実として自動推定することもしない。
### 未判断の登録と解消

PendingBalanceEditorは残高draftのpendingDecisionsを編集する。制作物・発生年・既知/未知の額・理由・根拠・関連残高を保存し、resolution（解消年・判断ID・理由）を任意に追加する。元の問いは削除しない。未知を0へ置換しない。

annualBalancesは発生年から解消前年まで未判断を表示する。解消前の年度projectionには将来のresolutionを含めず、元の年度結果を維持する。解消年は発生年以降。解消による金銭移動は生成しない。必要な費用化・振替等は別途、根拠付き増減として記録する。

balanceReferencesは解消の判断が存在し、確認済みで、制作物と解消年が一致することを照合する。下書きには参照問題を保持できるが、年度採用時は拒否する。copySnapshotはresolutionの許可した3項目だけを保存する。過年度根拠の照合では将来の解消を除外し、翌年に問いを解消しただけで前年の訂正を要求しない。解消年以後の保存資料・Markdown・全JSONには元の問いと解消理由を残す。

解消を取り消す操作は作業中入力の変更であり、既存採用版は変更しない。相談回答の自動取得、税務条件の判定、増減との数量的な対応検証は未接続。
### 残高draft保存の要求識別と通信断からの再試行

BalancesPageは保存するsnapshotとexpectedRevisionに要求UUIDを結び付ける。通信エラー後に内容を変更せず保存を再試行した場合は同じIDを送る。入力内容の変更、成功後の別保存、保存済み再読込後は新しい要求になる。

balance_draft_receiptsは要求ID・正規化した入力とexpectedRevisionのhash・保存後revisionを保持する。残高書込とreceipt追加は同じBEGIN IMMEDIATE内で行い、どちらかに失敗すれば両方rollbackする。既存DBでこの表がない場合は、検証済み移行backupを作成してから初期化transactionで追加する。

同じ要求ID・同じhashで、現行revisionが保存後revisionと一致する場合は、現在の保存済みdraftを返して版を増加させない。同じIDで内容変更は400。保存成功後に別の更新があれば409で以前の保存は成功済みと明示し、現行データを戻さない。成功記録は再起動後も残り、過去のID再利用を認識する。入力本体の複製はreceiptへ保存しない。

旧呼出しとの互換のためrequestIdはAPI上任意。IDなしの呼出しは従来の版照合を行い再送認識は提供しない。製品の残高入力画面はIDを送り、送信前控え・ブラウザ再読込後の明示再送・未保存入力復旧・残高の3版比較を接続済み。これらの控えは同じbrowser origin内だけにあり、別PCへの移行資料には含めない。
### 残高競合の比較と入力の統合

BalancesPageは読込・保存成功時のBalanceDraftを編集の基準として保持する。409時も基準とローカル入力を残し、「入力を保持して最新と比較」でGET draftを取得する。読取失敗や比較取消で元入力を破棄しない。

mergeBalanceDraftsはaccounts・movements・pendingDecisionsをIDで対応付ける。片側変更と同一変更は自動で残し、同一記録の異なる変更・削除対更新・同一IDの異なる追加は選択を必須化する。振替両側・金額・理由・根拠・解消情報を記録単位で保持し、別々の変更から一つの記録を合成しない。sourceIds/accountIdsの順序だけは内容変更としない。重複IDは比較を拒否する。

BalanceConflictPanelは変更前・この画面・最新の内容を3列で省略せず表示する。不明と0、記録なしを分離して表示する。全競合の選択後、最新revisionを基準とする未保存入力へ戻す。選択の組合せによる参照切れ・負残高等は検証結果を示し、編集画面で修正してから保存する。選択操作自体では書き込まない。

選択後の保存で再競合した場合、前回取得した最新を新しい基準として再比較する。通常の保存要求IDによる再送識別を維持する。比較中のローカル編集は古い比較を閉じ、再取得・再比較を必要とする。ブラウザ終了後の未保存入力は保存元revisionとdatasetIdを保持して明示復旧し、最新保存内容との差があれば再baseまで上書きしない。
### DB全体と識別子のバックアップ基盤

createDataBundleは読取専用の製品DBからVACUUM INTOでWALを含む一貫したDBを生成し、既存identifier-saltを同梱する。salt欠損は新規生成で補わない。取得前後でsaltが同一であることを確認する。stageでファイルSHA-256・サイズ、PRAGMA integrity_check/foreign_key_check、全ユーザーschemaとuser_version/application_idのhashを検査してから新規フォルダへ公開する。既存保存先は拒否する。

manifestはdevtax-data-bundle/version 1のstrict schema。固定名のDBとsaltだけを機械読取対象とし、未知のmanifest項目・版・同梱ファイルを拒否する。DBには全表・index・triggerが残り、採用資料のimmutable triggerも維持される。verifyDataBundleはファイルhash、識別子形式、DB整合性、schemaの一致を検証する。これらは破損検出であり、署名付きの出所証明ではない。

restoreDataBundleは呼出し側が指定した実行版のschema hashと一致した資料のみ、新規フォルダへコピーする。コピー後に再hash照合し、既存保存先へ上書きしない。復元元manifestをrestored-from.jsonに残す。DBやアプリを起動する処理ではない。未知のDB表を削る復元はしない。

scripts/data-backup.tsはcreate/verify/restoreを公開。restoreは隔離した一時領域で現行製品DBを初期化し、そのschema hashを適合基準にする。source rootの再接続は画面/API/CLIへ接続し、配布物にもCLIを同梱する。バックアップは保存済みDB/識別子を対象とし、元ログ・証拠原本・外部アプリ設定・ブラウザの未保存入力を含まない。source rootや自由記述を含むため相談用の出力とは境界が異なる。
### 復元CLIと走査保留

restore CLIは元のデータディレクトリを起動せず、隔離した一時領域で現行DBのschemaを取得する。復元先は新規フォルダのみ。restoreDataBundleは展開と同時にrestore-reconnect-required.jsonを作り、元bundleの時点とschema hashを保持する。

保留中のgetDatabaseは既定sourceを新PCのホームへ付け替えず、元root・ID・cacheを保持する。automaticSourceScanEnabledはfalse、scanHistorySourcesは待ち行列内でも保留を再確認して拒否する。POST /api/scanは409/restore_requires_reconnectを返す。runtime APIの状態をAppで表示し、保存済み資料の読取は利用できる。

保留解除とsourceの再接続は後述の画面/API/CLIを使う。保護ファイルの手動削除を再接続の代替にしない。CLIは配布版へ同梱する。
### 復元sourceの再接続と保留解除

restoreSourcesのpreviewは復元保留情報・全source設定・識別子設定を確認hashへ結び付け、全sourceのID/root/enabledを編集する計画を返す。CLI previewは新規JSONへ書き出し、applyはstrict schemaで読み込む。全IDを一度ずつ指定し、同じprovider/rootの重複を拒否する。enabledの接続先は読取可能なフォルダを必要とし、disabledなら原本不在を許容する。同一の元履歴であるかの自動証明は行わない。

applyはBEGIN IMMEDIATE内で確認hashを再照合し、元source IDを保ったままroot/enabledを一括更新する。rootの交換を許容するためtransaction内だけの一時root_keyを使う。接続先変更時は該当sourceのfile cacheのみを削除し、usage_events・採用資料を削除しない。再接続receiptを同じtransactionで保存し、commit後に保留ファイルを解除する。解除が失敗した場合は保留を維持し、同じ計画の再実行で終了処理を再試行できる。別の復元の保留を古いreceiptで解除しない。

再接続receiptがあるDBでは、getDatabaseが既定sourceを新ホームへ戻さず、明示したroot/enabledを維持する。apply自体は走査しない。保留解除後は通常の手動走査・起動時走査設定へ戻る。再接続はCLIと画面で操作でき、配布版でも利用できる。
### 復元再接続のAPI・画面接続

GET /api/restore/sourcesは復元保留中の全source ID/root/enabledと確認hashを明示的な再接続画面へ返す。POSTは既存のloopback/Origin/CSRFと2MiB上限を適用し、source操作キュー内でapplyRestoreSourcesを呼ぶ。確認不一致はRestoreSourceConflictとして409、構造不正などは400。成功応答不明の同一計画再送はreceiptで認識する。

RestoreSourcesPanelは復元保留中に表示し、利用者の操作で接続先を取得する。root/enabled編集時は確認チェックを解除。入力全体を確認して保存し、成功後は走査保留の表示状態を更新する。保存だけでは走査しない。通信失敗時は同じ計画を保持し、409は再確認が必要。読取失敗で入力を置換しない。最新を再取得できた場合は元入力を控えに保存して、新しい接続先とhashを表示する。

source rootは再接続の目的で表示し、通常集計や採用snapshotへ追加しない。CLIと画面はいずれも同じ保存・照合処理を使う。配布版はnpm run data:backup / data:reconnectで同じCLIを実行する。
### タスクホームとPC移行画面

Appの初期画面は「今回確認すること」とし、復元再接続、請求額不明、未割当履歴、利用不能source、diagnosisの即時確認を優先度付きで既存作業へ案内する。ここで表示件数が0でも税務上の確認完了・年度採用済みとは扱わず、今年の結果と残高確認は別の作業として常に残す。

「PCとデータ」は、(1) 別PCのClaude Code/Codex履歴を1台のDevTaxへsourceとして集約すること、(2) DevTaxの保存DB自体を別PCへ引っ越すこと、を分離する。クラウド同期・同時編集は導入しない。POST /api/data-transfer/backup, /verify, /restore はloopback/Origin/CSRF保護下で既存のcreateDataBundle / verifyDataBundle / restoreDataBundleを呼び、現在のデータフォルダ内へのbackup、既存データフォルダへのrestore、bundle内へのrestoreを拒否する。restoreは新規フォルダを作るだけで現在プロセスのDBを切り替えず、復元先で起動した後は既存のrestore-reconnect-requiredとRestoreSourcesPanelへ接続する。ブラウザlocalStorageの未送信控え、元ログ、証拠原本、外部アプリ設定はbundleへ含めない。

### 配布物の復元経路と実行検証

package-release.tsはserver/index、tools/data-backup、tools/restore-sourcesを独立したNode ESM bundleにし、tsxやnode_modulesなしで配布する。START-HEREとREADMEにbackup・verify・restore、新保存先の環境変数、再接続画面への手順を記載。Cloudflare専用の_headers/_redirectsはローカル配布から除き、サーバーの既存routing/security headerを使う。

release-smoke.tsは一時HOME・DATA_DIR、空白を含む保存先、自動走査を無効にした条件でbundleを直接起動する。HTML/JS配信・runtime/workspace、CLI作成/検証/復元、全ユーザーテーブルの全行とsaltの一致、復元保留、再接続CLI、再起動後の保留解除を検証し、失敗時には新しいZIPを生成しない。新規DBの未入力料金を確認後、合成の既定月額不明・確認済み0円・期間指定請求の原額不明・根拠対応・部分期間重複・将来請求と別月の既知額/0円/不明額をAPIから保存する。費用projectionと復元後/再起動後の同じ記録・重複注意・別月費用の保持を検査する。子プロセスを終了して専用一時領域を除去する。実ログや税務判断の受入をこの試験だけで完了とはしない。
### 費用配分と残高増加の明示的な金額対応

増加のcostAllocationsはcostYear・contributionId・amountJpyを保持する。同じ増加内の同年/同配分の重複、負額、整数範囲外、合計が増加額を超える入力を拒否。1記録100対応・全体200関連年度まで。期首・費用化・その他減少・振替には新しい費用消費としてこの項目を付けない。既存記録に対応情報を推定して補わない。

balanceCostProvenanceは採用年までの増加を全残高・全対象年で合算する。最終配分の存在、制作物、原額参照、費用年が増加年以前であること、配分額以内の使用を検証。不整合はinvalidとして採用を拒否。未対応増加はincompleteとして明示したまま資料を固定できる。対応済み額と未対応額、各配分への指定額と未使用額を表示し、未使用額を税務費用や未計上と断定しない。整数範囲を超えた集計値や上限超過の残額はnullで状態を明記する。

reviewMaterialsは同じworkspace/observationのsnapshotで現在年と明示された関連年の費用を計算し、costLinksに全関連projectionと照合結果を格納。preview hashと採用transactionの再照合に含める。過年度資料に使った別年度の費用もhistoricalReviewMaterialsの照合対象とする。旧採用版にないcostLinksを現在資料から補完しない。Markdownに金額対応と照合結果を記載し、全JSONも保持する。

BalanceCostLinksEditorは指定年の費用から同じ制作物の最終配分を表示し、対応額を入力する。根拠の原額参照も選択時に追加し、対応を外しても根拠を勝手に削除しない。資料取得失敗で入力を保持。通常の残高保存・再送・3版比較を通り、比較は増加記録と対応額を一体として選択する。年度確認画面ではBalanceCostProvenancePanelが照合結果を表示する。期首の由来、減少や振替後の個別原価、税務方式・適用条件、費用としての二重控除全体の検証は未完了で、taxTreatmentVerifiedはfalseを維持する。
### 残高入力のブラウザ復旧

app_settings.dataset_identityをDB初期化transactionで一度だけ作成し、runtimeと残高draft応答へdatasetIdを返す。バックアップと復元で同じIDを保持し、別DBは別IDにする。不正な既存IDを自動置換しない。識別子はローカルパスを含まない。Appは資料IDで残高画面を切り替え、読取・復旧・保存前に接続中の資料IDを確認する。

balanceRecoveryは保存元のsnapshot/revision、編集中snapshot、表示年、保存要求のfingerprint/UUIDを同じブラウザoriginのlocalStorageへ控える。編集、比較結果の反映、保存要求前に同期的に書く。復旧用schemaは空文字や数値入力のNaNを保持し、既知0とunknown/nullを分ける。構造不正・未対応形式・サイズ上限超過を拒否し、読めない控えを勝手に削除しない。1控えはJSON 2,000,000文字までで、ブラウザの容量上限は別に扱う。DB保存や採用には従来の厳格な検証を使う。

控えのキーは資料ID・編集画面ID・画面内連番・一意の記録IDを含む。新しい入力を別キーへ書いてから同じ画面の古い控えを整理する。旧控えの削除と別画面の新入力が競合しても、新入力のキーを消さない。古い控えの整理に失敗した場合も新しい控えを保持し、状況を通知する。復旧候補は各画面の最新連番を表示。復旧してから破棄する操作では元画面の控えを残し、DB保存成功時は使った控えだけを整理する。

復旧操作は最新draftを読み、資料IDを照合する。復旧入力が現在の保存内容と同じなら再書込しない。保存元と版または内容が違う場合は3版比較へ進み、同じ版番号に別の内容がある場合も比較する。objectのキー順序だけで競合や新しい要求IDが生じないよう、比較・fingerprintを正規化する。入力が未完成でも編集へ戻し、検証が通るまでDB保存は止める。

対象は残高画面の入力と残高保存要求。料金・計画の編集中入力は後述の別形式で復旧する。未確定の比較選択そのものは未接続。年度採用要求の復旧は次項の別形式で接続。控えは同じブラウザ・同じscheme/host/portで利用し、ブラウザのデータ削除、別PC、別originには引き継がれない。DBバックアップの対象外。容量不足やストレージ利用不可のときは画面入力を残して警告し、保存完了と表示しない。
## 年度資料の保存要求のブラウザ復旧

ReviewAdoptionPanelは採用操作時の年・残高版・資料全体のhash・理由・要求UUIDを、datasetIdと作成日時付きでlocalStorageへ送信前に保存する。reviewRecoveryのstrict schemaで読取り、形式不明の控えは削除しない。同一要求IDに別内容を上書きしない。ストレージへの記録失敗は送信を止め、理由と確認画面を保持する。

再読込後は控えの全内容を確認し、同じ保存要求の再試行を明示的に実行する。runtimeとPOSTのexpectedDatasetIdを照合し、違うDBには送信・採用しない。サーバーは同じ要求ID・内容で既に採用済みなら元の資料を返す。未保存なら現在の残高版・全資料hash・参照・履歴整合を再検査し、不一致は409で採用しない。expectedDatasetIdは接続確認用で、既存の採用要求hashへは混入させない。

成功応答後は対象要求の控えを削除する。控え削除失敗は採用成功とは別に通知する。控えの削除は資料の取消ではなく、結果不明の要求は再試行するか保存済み一覧を確認できる。入力途中の理由、preview全体の復旧・バックアップ、異なるPCやoriginへの引継ぎは対象外。同じDBを古いバックアップへ戻した場合、未保存扱いの再試行は現在資料との一致条件で判定される。
## 料金・計画の編集中入力の復旧

Onboardingは料金・契約・請求期間・月額・捕捉外割合・全PlanningSnapshot・候補の対応先・選択provider・手順をWorkspaceEditorInputとして保持する。編集後のeffectで、保存元WorkspaceDraftとdatasetIdを同じlocalStorageの控えに記録する。新UUIDの控えを書いてからその画面の旧控えを削除し、別画面や復旧元の控えを上書きしない。書込み失敗時は入力を保持して通知する。DOMイベント直後からeffect実行前の強制終了まで保証するものではない。

planning/schema.tsにDB処理と独立した保存用schemaを移し、planningRepositoryから従来どおり再exportする。workspaceRecoveryのeditingShapeは文字列のtrim・日付形式・数字範囲・参照整合の制約を編集控えには適用せず、フィールド構造・型・列挙値・上限サイズを検証する。NaNは専用形式で符号化し、不明額nullや確認した0へ変換しない。読み取れない形式は自動削除しない。API保存のschema・参照検査は緩めない。

復旧は既存入力が編集中でないときに全内容を確認して選択する。runtimeのdatasetIdを照合し、元の保存版をAppのeditorBaseとして戻す。復旧後の保存では最新workspaceを再読取り、保存内容が入力と同じなら再書込しない。保存元との内容差は版番号が同じ場合も検知し、既存3版比較に渡す。比較後の保存・影響確認は従来の版/hash照合を使う。成功時は自身と復旧元の控えを整理する。

料金/計画の保存要求UUID自体の再読込後引継ぎはworkspaceAttemptへ接続済み（後述）。編集控えの復旧とは別経路である。保存応答不明後は最新内容との一致判定で再書込を省くが、任意の過去の成功応答の再生ではない。保持設定・履歴接続フォーム・検索語・未確定の比較選択は対象外。控えは同じbrowser origin内だけにあり、別PCへの移行やDBバックアップには含まれない。
## 費用の対応額から原額への参照経路

CostTracePanelは表示中のAnnualCostProjectionから、最終対応額または未算定の費用基礎を選ぶ。costTraceは配分のbasisId、費用基礎のsourceId/parentContributionIdsを逆向きに探索し、元の支払から依存順に一度ずつ並べる。複数費用の組入れはすべての親を追う。各ノードに元の参照を残し、分岐や合流を単なる一本道へ省略しない。

表示は原額・利用/請求/支払/取得日・対象期間・方法と版・配分理由・対応先・証拠IDを記録どおり示す。途中の金額を合算せず、未算定を0にしない。追加のAPIや現在のplanningを読まない。欠落参照・重複ID・循環は不足として通知し、ない資料を補完しない。原本の内容確認、税務適用条件、残高移動までの来歴を証明する機能ではない。

### 自宅費用の計算過程の説明

workspaceCostsは支払額×業務割合を円単位で四捨五入した業務額を先に求め、その業務額×制作物割合を再び円単位で四捨五入して対応額を求める。未配分は業務額から対応額を差し引き、私用は支払額から業務額を差し引く。説明文にも実際の入力割合・中間額・丸め順・差額を含める。割合は0～1の係数で示し、1が100%であることを明記する。

計算式は費用基礎のmethod.explanationと配分のreasonに含まれるため、画面・金額追跡・Markdown・採用資料へ同じ説明が渡る。原額不明や根拠未入力では業務額を仮定せず、制作物の対応先がない場合は制作物割合を適用していないと明示する。一般業務は算定した業務額全体への対応として説明する。数値計算の方法自体は変更しない。

既存の採用版は書き換えない。新しく生成する説明はpreview hashと比較対象へ含まれるため、旧資料との説明差も現行入力との差として表示される。説明更新を、税務上の割合の妥当性を検証した証拠とは扱わない。

## 登録状況と確認完了の分離

RecordStatusPanelは保存したplanningと同じdashboardの履歴件数から、履歴・制作物・設備・自宅費用・直接費・根拠資料参照の登録状況を表示する。取込済み履歴0件や証拠未登録へ完了チェックを付けない。登録有無は内容の検証や税務適用条件の確認とは区別し、未登録を「該当なし」とみなさない。

Appの準備スコア・確認済み数・進捗リングは表示しない。Onboardingの結果でもスコアを廃止し、missingFactsを具体的に表示する。空の場合は現在の検査項目で不足を検出していないことだけを示す。診断APIのreadiness数値は既存の互換用に残すが、製品画面の確認完了率として使わない。「該当なし」「保留」の明示入力は別の未完了責務。

## 入力後の結果と主画面の全費用資料を統一

Onboardingの結果はSummaryPageと同じAnnualOverviewへdata.costProjectionを渡す。対象年が違う資料や取得できていない資料を、AIの分類額で補わない。原額・配分の確認操作で同じprojectionのCostsPageを読取専用表示し、追加のAPIや未保存planningから別の金額を生成しない。結果画面にはAI絞込み操作がないため、AnnualOverviewの絞込み説明は非表示とする。

保存済みの集計と編集中の診断を区別し、合成デモを保存成功と表現しない。buildFilingScenariosによるAI分類額の三つの申告区分への同額表示は製品画面から外す。旧関数は互換・既存テストのため残るが、条件に基づく税務処理候補の実装ではない。MethodScenarioの完成要件は引き続き未完了。

## 費用項目の年度別確認

planning/costPresence.tsは、年度×設備/自宅費用/直接費ごとに、本人の「該当なし」「保留」をreason・recordedAt・id付きで扱う判定層。ID重複、同じ年度/項目の複数確認、空の理由、不正な日時を拒否する。未登録から該当なしを推定せず、前年度の確認を当年度へ持ち越さない。

判定状態はunreviewed、has-records、not-applicable、deferred、conflict。該当なしと費用記録が併存すればconflictにし、費用・不明額・0円を削除しない。保留にも記録IDを残す。自宅費用は対象月、直接費は発生日で年度を選ぶ。設備は当年末までの取得記録を対象とし、過去取得の設備を自動で対象外にしない。利用終了が未モデル化の設備も確認対象に残るため、その年度の利用終了・売却等の事実による解消経路は別途必要。

PlanningSnapshot.costPresenceとしてDB・workspace API・競合比較・入力控え・採用資料へ接続した。SQLiteのplanning_cost_presenceは年度/項目を一意にし、計画のSAVEPOINTとworkspaceのtransactionで他の入力と一緒に保存する。既存DBにテーブルがない場合は初期化前に整合性を検査したVACUUMバックアップを作る。確認がなければ従来の省略形を維持し、自動生成しない。

競合は年度/項目をキーに比較する。同じ項目を別画面で新規登録してIDが違っても、一方を無条件に追加せず、状態・理由・日時・IDを一組で選択する。入力控えの共通schemaも確認記録を保持する。CostPresenceEditorをOnboardingの費用段階に接続し、対象年度の状態・理由を編集する。記録日時は変更時に更新し、確認記録なしへの変更はその年度/項目だけを除く。理由未入力は保存時に拒否する。

採用資料には本人の記録を固定し、JSONとMarkdownへ出力する。過年度比較は対象年度の確認だけを含める。RecordStatusPanelは対象年度の判定と本人の理由・日時を表示する。診断は有効な該当なしの有無確認を止め、保留・不一致を理由付きの確認事項として残す。既存費用の根拠不足は引き続き表示する。ReviewMaterials.costPresenceCheckへ対象年度の判定と方式版を固定する。不一致はpreviewに表示し、採用transaction内の再読取でも拒否する。保留・未確認はその状態を残して資料を固定できる。旧版にない判定は現在の入力で補完しない。完成する接続の契約は次のとおり。

| 接続先 | 必要な契約 |
| --- | --- |
| 保存 | 年度別の確認をPlanningSnapshotと同じ版・transactionで保存し、バックアップ/復元へ含める。既存保存からは確認を自動生成しない |
| 編集 | 項目・年度・状態・理由を明示して登録。未完成の理由もブラウザ入力控えで保持し、保存には理由と日時を要求 |
| 競合 | 同じ年度/項目の状態・理由・日時・IDを一記録として比較し、重複を保存前に解消。選択後のID重複もschemaで拒否 |
| 診断 | 該当なしが有効な年度だけ有無確認の催促を停止。保留は問いと理由を維持。不一致は登録費用とともに表示 |
| 採用 | 本人確認と判定状態を年度資料へ固定し、未登録や税務条件確認済みと混同しない |
| 過年度 | 対象年の確認変更を過年度資料の差分へ含め、未来年度の確認を過去の変更としない |

この確認は項目の有無についての本人記録であり、税務上の必要経費性や利用割合の検証ではない。費用計算・残高計算から記録を除外するスイッチにしない。


## 設備の普通定額法計算層

[equipment-depreciation-rule.md](docs/design/equipment-depreciation-rule.md)に一次資料・適用範囲・入力・分岐・接続契約を記録。個人の有形設備について条件付き普通定額法の純粋計算を実装した。法定率・使用月数・円未満切上げ・残高1円をBigIntで計算する。PlanningSnapshot.equipmentMethodsを年度×設備の条件記録として追加。EquipmentMethodsEditor→workspace原子保存→planning_equipment_methods→workspaceCostsへ接続し、普通償却額を業務/私用/制作物/未配分へ保存則を保って分ける。取得額や欠落事実の代用はしない。設備の旧usefulLifeYearsはこの年度別の年数へ自動転記しない。

設備計算条件は設備外部キーと年度/設備の一意制約を持ち、保存JSONの構造と索引の一致も検査する。再保存は子条件を先に消し、設備を再挿入した後に条件を戻す。同じSAVEPOINTの失敗で全体rollbackする。旧DBのテーブル追加前は検証付きbackup。競合は年度/設備をキーに記録全体を比較し、入力控えでは未完成の年数・残高・参照先を保持。採用資料のplanningと費用基礎に当時の条件・算式が残り、過年度差分は対象年度の条件だけを追加する。

計画日付の保存契約: planningSaveSchemaは活動開始・ルール開始/終了・出来事・設備注文/納品/取得/利用開始・直接費発生・証拠発生の10種類を検証し、旧planning API/workspace APIとrepository保存で使う。ルール専用APIも開始/終了日の実在性を検証する。読取schemaは旧記録を修復できるよう維持する。workspaceCostsは不正日付の設備・直接費を理由付きunknownにし、不正な取得日を共通費用の日付に転記しない。直接費の確認対象年を表示範囲に使う場合は、帰属済みの利用期間ではないと説明する。元入力・原額は保持し、正常な費用の計算を継続する。

設備の年度別配分: equipmentMethods.allocationはbusinessUseRatio/projectAllocationRatio（0〜1またはnull）とreasonを持つ。既存record_jsonで原子的に保存する。年度別条件があれば共通割合を使用せず、欠落している旧記録だけ共通割合使用を明示する。業務割合/根拠未確認なら全額未配分、制作物割合未確認なら業務額を未配分。採用資料に当時の条件を固定し、過年度比較では年度別条件のため未使用になった共通割合を除く。allocation.taxUnitIdで年度別対応先も保持する。nullは未確認・未配分、欠落した旧記録だけ共通対応先を使う。新規はnullで開始し、存在する制作物への参照を保存時に検証する。明示済み年度は未使用共通先の変更を過年度差分にしない。

同年度の複数制作物: allocation.targetsはtaxUnitIdとshareBps（0〜10000の整数、または未確認null）の配列。targetsが存在すれば空配列を含め旧単一対応先と制作物割合を使わない。制作物は最大100件、重複・参照欠落・割合合計100%超過を保存時に拒否する。業務額を100%として0.01%単位で配分し、残りは未配分。nullは0へ確認状態を変換せず未確認のまま保存する。各配分額はBigIntの積で円未満を切り捨て、未配分枠を含め剰余の大きい順に残りの1円を配る。同値は安定したキー（unit:制作物ID / unallocated）の辞書順で決める。私用・全制作物・未配分の整数円合計が年額と一致する。入力UI、workspace/API、固定採用資料、Markdown/JSONへ接続。旧方式からの変更は利用者の明示操作で対応先と制作物割合を解除し、業務割合と根拠を保持する。
設備全体の固定計算: ReviewMaterials.equipmentCalculationsへ年度/設備/条件IDとEquipmentDepreciationResultまたは入力不整合理由を保持する。inspectEquipmentAnnualCalculationを共通費用基礎と資料固定の入口にし、方式版・期首・普通償却・期末を当時結果として保存する。旧資料の欠落を現在の入力で補完しない。採用前画面とMarkdownに設備全体額として表示し、種類別台帳の残高へ自動転記しない。前年採用headの構造化期末計算との数値照合はcheckEquipmentCarryで実施し、確認hashと採用資料へ固定する。不一致は採用不可。前年未登録や旧版未収録は照合不能として保持。自由記述参照先と税務適用の検証は別である。

### 自宅費用の複数制作物配分

HomeCostRecord.targetsを任意項目として保持する。未収録は旧単一対応先・割合を使い、空配列は業務分全額を未配分にする。各要素はtaxUnitIdとshareBps（0〜10000の整数またはnull）。重複・合計超過・参照先なしを拒否し、一般業務扱いと制作物配分の併用も拒否する。業務額は原額と業務割合から求め、共通のallocateBusinessTargetsで制作物と未配分へ最大剰余法で配分する。未確認割合は推定せず、私用額と合計が原額に一致する。原額不明では複数の影響先を残す。

planning_home_costs.targets_jsonは任意のJSON列。旧既知額DBとnullable原額DBの両方から、検証付きbackup後の移行を行う。既存単一入力は自動変換せず、画面で明示した切替のみ旧対応先・割合を解除して未配分から入力する。採用資料は計画のtargetsを保持し、保存版Markdownは当時の制作物名とID・割合・配分根拠を出力する。履歴比較では複数先使用時の旧単一条件を比較対象から外す。

### 料金・計画の送信要求の復旧

workspaceAttemptは編集中入力の控えとは別に、送信直前のWorkspaceSave（requestId・expectedRevision・previewHash・料金・計画）と保存元の全内容を資料IDごとにlocalStorageへ固定する。作成日時以外が同じ要求IDで変われば送信を止め、容量超過・書込失敗も送信前に返す。再読込後のWorkspaceAttemptPanelは保存対象を表示し、明示再送前にruntimeのdatasetIdを再照合する。異なる接続先では送信せず、workspace_conflictは保存元・送信内容・最新の3版比較へ戻す。previewを経た要求はその条件も保持する。成功応答後に同一内容の控えだけを削除し、削除競合・未対応形式は保持する。

サーバーのworkspace_last_saveは直近要求のみを照合する。別更新後の古い要求から過去の内容へ戻さず、競合として扱う。この機構は全要求の成功履歴台帳ではない。控えは同じブラウザの接続先に限られ、別PCへの移行やDBバックアップの代わりにはならない。未確定の比較選択と編集中のpreview操作そのものの復旧は残る。

## 画面ファイルの読込と起動失敗

staticFiles.tsは静的ファイルを要求時に解決し、起動後に追加されたassetも配信する。HTMLはCache-Control:no-store、静的配信はnosniffを付ける。存在しないURLは、GET/HEAD・HTML受入・文書宛て・拡張子なし・API/asset領域外の画面遷移に限りindex.htmlへ戻す。JS/CSS/APIやその他の要求は404を返し、欠けたJSへHTMLを返さない。index.htmlが欠けた場合も404にする。

HTML本体に読込中・再読込・サーバー再起動の日本語案内を置き、JavaScriptが起動しない場合も案内が残る。React起動後は通常画面に置き換わる。これは配布物を実行中に原子的に更新する仕組みではなく、更新時のサーバー再起動は引き続き必要。配布試験はHTMLの案内、no-store、実JSのMIME、欠けたJSの404を検証する。
## 直接費の複数制作物配分

DirectCostRecord.targetsは共通AllocationTarget配列。未収録は旧単一対応を維持し、空配列は全額未配分、null割合は未確認、0は確認済み0%。一般業務とtargetsの併用、存在しない制作物、合計超過・重複・端数の精度超過は保存拒否。UIの明示切替は旧単一対応を解除してsharedへ移し、原額・日付・証拠・メモを保持する。

planning_direct_costsへtargets_jsonを追加。既存backup付き起動経路を使い、既知額の旧表と原額nullableの旧表から記録を保持して移行する。共通projectionは原額を1件に保ち、最大剰余法と対応先ID順で円額を保存する。未確認と残余は未配分、原額/日付不明は全対象へ未算定の影響を残す。旧版残高は新規支払へ加算しない。

年度資料は当時のtargetsと制作物名を固定し、Markdownにも出力する。歴史比較はtargets使用時の旧taxUnitId/directlyAttributableを無効条件として除外し、使用中の割合変更は検知する。未配分を当年費用とする自動判断は行わず、返金・複数期間・費用化の計算は別の未完了要件である。
## 残高移動の対応元を金額付きで照合する基盤

BalanceMovement.balanceAllocationsは費用化・減少・振替に対して、sourceKind（opening/movement）・sourceId・amountJpyを最大100件で記録する。期首は残高ID、movementは増加または振替受入の移動IDを参照する。FIFO等の対応を推測しない。増加には指定できず、同じ対応元の重複・移動額超過・不正整数円を拒否する。保存snapshotのコピー、API schema、ブラウザ編集控えにこの構造を接続した。

checkBalanceFlowLinksは対象年までの履歴で、対応元の存在・受入先と払出元の一致・日付・既知の使用可能額を照合する。各対応元への使用合計をBigIntで算定し、他の残高に余裕があっても特定の対応元の超過をinvalidとする。同日の明示された依存は許容するが循環と循環への依存は拒否する。不明期首への確定額対応は照合不能としてinvalid。指定しなかった分はincompleteのまま保持する。

ReviewMaterials.balanceFlowCheckへ方式版・対応元・使用額・残額・不足・問題を固定し、採用時にinvalidを拒否する。直前の費用から増加への照合と併用し、振替受入の消費を元費用の再消費として扱わない。これは記録した残高段階同士の対応であり、複数原価を含む残高から一部を使うときの原価内訳を推測しない。BalanceFlowEditorの対応元選択/使用額入力とBalanceFlowPanelの採用前/保存版表示は接続済み。期首の原価内訳・税務条件は未接続。単一原価の一部使用と複数原価全額の段階間追跡は次節の計算・参照表示へ接続。旧資料には現在の結果を補完しない。
## 残高段階をまたぐ元費用の追跡

traceBalanceLotsは対象年までの費用配分への対応と残高対応元を検証し、依存順に費用配分ID・費用年・額の内訳を伝播する。検証に不整合があれば追跡結果を生成せず問題を返す。順序は入力配列ではなく明示された依存で決まる。

原価全体が既知の単一費用配分に由来する場合は、一部使用額をその原価に対応させられる。対応元の全額を移す場合は、複数の既知原価と未追跡分をそのまま伝える。複数原価や未追跡分を含む元の一部使用では、FIFO・比例配分・入力順による原価選択を行わず、使用額を原価未追跡、その元の原価別残額をnull/内訳未確定とする。元の残額が0なら各原価の残りは0と確定できるが、消費側の未確定内訳は残る。

ReviewMaterials.balanceLotTraceに方式版・対象年・各移動の内訳と未追跡額・対応元別の残額内訳・問題を固定する。BalanceLotTracePanelを採用前と保存版に接続し、Markdownにも同じ固定結果を出す。旧版に未収録の結果を再計算しない。段階別の金額は同一費用の移動を含むため合算対象にしない。consistentは記録範囲の原価追跡を意味し、税務上の適用確認ではない。

期首原価の由来は引き続き必要。混在原価の一部使用の明示選択は次節で接続。全費用の税務処理生成と全体受入の完了を示す機能ではない。
## 使用原価内訳の明示指定

BalanceFlowAllocation.costAllocationsは、その対応元から使う費用年・配分ID・額を最大100件で保持する。未収録は一意に決まる場合の追跡、空配列は明示指定した内訳なし、合計が使用額未満なら残りは原価未追跡。重複・不正整数円・使用額超過を入力検証で拒否する。API schema、保存snapshot、未完成入力控え、同版の表示と出力に接続。

traceBalanceLotsの方式版2は、上流に確認できる原価だけを明示使用でき、同じ対応元・同じ費用配分の使用合計がその原価額を超えないことを照合する。全体残高に余裕があっても原価別の超過はinvalid。存在しない原価もinvalid。無効な計算結果は表示用の確定内訳を返さず、年度採用は画面とtransaction内で停止する。旧方式版1の固定結果は保持する。

BalanceLotUseEditorは明示された上流の増加から候補を表示する。候補表示は使用可能額の保証ではなく、確定可否は年度previewで照合する。新規選択した額は空欄とし、ユーザーが入力する。候補外の既存指定は保持して修正を可能にする。明示指定解除は専用操作とし、使用額の変更だけで内訳を削除しない。
## 原価参照の費用名・対象期間

costLotLabelは供給された年度費用projectionだけから、原資料名・費用基礎の対象期間・制作物名を結ぶ。費用年と配分IDは常に残し、未収録の名称をIDから推測しない。GET balances/draftは既存の参照照合と同じworkspace読取内でcostDescriptions（workspaceRevision/items）を返す。入力画面は保存後も読込時の名称を保持し、残高の再読込で更新する。採用前・保存版・Markdownは同じmaterialsの費用資料を使い、別年度や現在の名称で補完しない。
## 前年採用期末の原価から当年期首への照合

checkOpeningLotCarryは直前年度の採用資料と当年の種類別残高projectionを受け取る。前年の原価追跡に保存された対応元別残額を残高別に集約し、採用期末と当年期首の一致、制作物・残高種類、原価内訳が残額以内であることを照合。原価額は取得時や受入時の額ではなくremainingJpyを使う。費用名は前年資料から固定する。

前年資料なしはnot-linked、原価追跡未収録・原価未確定・不明期首はincompleteとして区別。前年に存在しない非ゼロ/不明期首も未追跡として表示。期末と期首・対象・種類・追跡残額の不整合はinvalidで採用を停止。新しい支払や増加を作らず、過去の増減を維持した年度台帳の期首説明として接続する。

previewBalanceReviewはopeningLotCarryを資料hashへ含め、採用版に前年資料ID・原価別繰越額・未追跡額・問題を保存する。OpeningLotCarryPanelを採用前と保存版へ接続し、Markdownにも同じ結果を出す。旧版にない結果は現在の資料から補完しない。過年度訂正の未反映・歴史入力の変更・前年期末不一致は既存の採用時検査も継続する。

外部資料だけを根拠とする初回期首の原価登録や、過去の増減履歴を切り離した移行は未対応。税務上の適用条件の確認完了を意味しない。
## 概要画面の採用済み年度記録

AnnualReviewSummaryはローカル接続時に年度資料一覧を読み、指定年のactiveな資料を一つに特定して固定版を読む。資料ID・資料年・projection年を照合し、別年の値で補完しない。記録した費用化額・期末既知額・不明残高・未判断と残高別期末を表示する。作業中の費用基礎、全費用からの処理生成による当年費用/翌期残高とは分離し、一覧読込時の採用版であることを明示する。

未採用・読込中・取得失敗を区別し、0円へ置換しない。前年訂正フラグは反映確認の警告を出す。対象年変更後の古い応答は破棄し、接続先変更はdatasetIdのkeyで再マウントする。公開デモではAPIを呼ばない。手動再読込を提供し、残高・原価・保存版差分へのボタンは既存の残高画面初期化とページ切替を行う。
概要から残高への移動は、概要の対象年・要求番号・datasetIdを渡す。BalancesPageは同じ接続先の新しい要求だけを適用して表示年を切り替える。残高画面の再マウント、入力の再取得、自動保存は行わず未保存の金額・原価内訳を保持する。通常ナビゲーションから残高へ戻る場合は、残高画面で選んだ年を保つ。
概要の採用済み記録にReviewComparisonActionを接続。利用者の操作時だけ既存の比較APIを呼び、資料IDと対象年を検証してReviewComparisonPanelへ渡す。再要求時は前の結果を消し、資料変更・unmountで旧要求を無効化。失敗を差なしとして表示しない。金額以外の理由・原価内訳等も既存比較の対象とし、原価関連の比較パスに日本語ラベルを追加した。
### 年度比較での過年度訂正の検出

BalancePreview.previousReviewChainChangedは、現在参照する前年採用版から過年度の接続をたどり、各年の現行採用版と不一致があるかを表す。preview hashにも含める。比較結果のpreviousReviewChangedは、直前年度の版ID変更、またはこの接続不一致のいずれかでtrueとする。金額差が0円でも訂正未反映の警告を表示する。採用時は既存の過年度接続検査で未反映を拒否する。旧採用版の数値・説明を再計算して書き換えない。

BalancePreview.previousReviewChangesは、前年採用版が保持する過年度接続について、不一致の対象年、参照元の年、参照していた版ID、現在の版IDを列挙する。previousReviewChainChangedはこの配列が空でないことから導く。採用前画面は未反映の対象年と版を示して新規採用を止める。過年度の訂正後はpreviewを再取得し、採用理由を保持して再確認できる。保存結果不明の要求を同一キーで再照会する既存経路は維持する。

### 確認事項に結び付く相談回答

PendingBalanceDecision.answersは任意配列で、回答ID・反映対象年・受領日・事実/方法の別・回答本文・確認先を持つ。制作物と元の問いは親の確認事項から特定する。対象年と受領日は別であり、翌年に得た回答を前年の訂正へ使うことができる。API/残高保存層で構造・日付・必須内容・重複ID・発生年との整合を検証する。未保存の空欄とNaNは既存の入力控えに保持する。

年次の未判断表示と過年度採用の照合では、回答の反映対象年が対象年以前のものだけを使う。将来向け回答の追加だけでは過年度資料との不一致にしない。過年度向け回答の訂正は履歴照合の対象になる。作業入力全体・採用snapshot・JSONは全期間の記録を保持する。

採用前・保存版・Markdownで、元の問い、回答の種類、年、受領日、確認先、解消済みなら判断IDと理由を表示する。回答登録だけでは金額・分類・未判断の解消を変更しない。事実/方法の変更は既存編集画面で行い、確認済み判断を既存resolutionへ結ぶ。回答から修正対象のフィールドへの専用案内、複数判断への個別適用、変更による候補/金額への原因別の影響表示は未接続。

解消の確認はresolution.answerBasisに解消対象年までの回答の内容を固定する。consultationResolutionMatchesは回答ID順・既知フィールド順で比較し、内容・確認先・受領日・種類・対象年・追加・削除の変更を検出する。解消年より後の回答は比較に含めない。回答がない既存記録は従来通り扱い、回答があるのに確認時の回答が未記録なら再確認対象とする。

再確認対象は年次未判断一覧へ残し、balanceReferencesのchanged-answerで採用を停止する。解消の編集画面で確認済み判断と理由を選び「この回答と判断で解消を確認」を実行すると、その時点の回答を固定する。保存・採用は既存の操作を経る。旧採用版は当時の回答と解消を保持する。再確認対象を保存版の解消済み表示・Markdownの解消済み一覧へ混入させない。

### 相談回答からの見直し導線

ConsultationNavigationは元の確認事項ID、制作物ID、問い、回答のコピーを編集画面へ渡す。残高画面の回答ボタンから、事実の回答は制作物ステップ、方法の回答は費用・判断ステップを開く。元の問い・対象年・受領日・確認先を表示し、対象制作物または対象年の判断に明示操作で移動する。対象がないときは他の制作物を代用しない。

必要な判断を新規追加する場合は、回答の制作物と対象年を持つ未確認の記録を追加する。扱い・採用理由・確認日時を回答から自動確定しない。費用・計画の変更は既存workspaceのpreview/保存を使い、閉じた後に元の未判断と解消を確認する。BalancesPageを保持したままモーダルを開くため、回答と残高の未保存入力を保持する。見直しを開くだけでは残高/workspace保存を呼ばない。

この導線は制作物の実態・利用状況と判断記録へ接続する。個々の設備方式・契約等の任意フィールドへの回答の対応付け、回答IDから変更フィールドへの恒久参照、原因別の候補/額/残高への影響は未完了。

相談回答の受領日は共通DateInputを使用する。カレンダー入力でReactのchangeが発火しない場合もnative inputから状態へ反映する。見直し元の回答欄はConsultationContextPanel.cssで背景と文字色を一組で定義し、既存サイドバーの色継承で文字が読めなくならないようにする。

### 解消時の確認対象の固定

resolution.questionBasisは確認事項ID・制作物ID・発生年・金額状態・残高ID・問い・根拠ID・解消年・判断ID・解消理由を保持する。解消確認ボタンはanswerBasisとquestionBasisを同時に作る。consultationResolutionMatchesはID順・フィールド順を揃え、問いや対象額だけが変わった場合も再確認対象とする。参照ID配列の順序だけの変化は差としない。不明額と既知の0円は別の状態として扱う。

現行の作業計算・参照検査・採用前確認は、回答のある解消についてquestionBasisを必要とする。旧採用版の読取り・出力は、questionBasisがない旧形式なら従来の回答照合を維持する。旧版を現在の検査規則で書き換えず、現在入力の採用時に再確認する。回答のない従来の解消記録は互換を維持し、今回の確認を実行したものから対象の固定を追加する。

### 共通活動事実と制作物タイムライン（追加実装）

`PlanningSnapshot.activityLedger` は version 1 の厳格な追加契約。products と既存 taxUnit の unitLinks、facts を `app_settings.planning_activity_ledger_v1` に保存する。物理DB schema の変更や旧記録の書換え・確認済みへの移行は不要。初回保存から既存 workspace SAVEPOINT、期待revision、要求ID、影響hash、3版比較を使い、失敗は全体rollback。保存後のfact/linkは追記訂正だけを認め、対象誤りも元IDを残す。既存ledgerを省略する旧クライアント、未知version/fieldを拒否。バックアップは既存検証付きVACUUM形式を利用し、復元前にもenvelopeを検査する。古い採用資料のoffline readerは現行schema/calculatorを通さない。

活動の時刻は単日・開始終了期間・不明を区別し、stateはobserved/estimated/confirmed/unknown/conflicted。範囲と理由、記録日時、証拠IDを保持する。旧出来事・期間分類・費用条件は確認状態なしの読取りadapterとし、不足日時を作らない。活動日を供用日・所得区分・自動償却へ転用しない。期間/対象に関係する訂正連鎖・証拠を費用の確認元へ追加し、関係ない単位・期間は除外。根拠の変更は同額でも再確認とし、結び直しだけでは用途の矛盾を消さない。用途再利用は同一費用単位の全費用期間をカバーする本人確認済み・矛盾なしの閉じた期間に限定する。用途だけを編集案へ写し、支払・供用・年末債務・方法を推定しない。従来の費用条件再利用も本人確認判断の元資料に一致するものだけを許す。

`GET /api/products/timeline` は同じread snapshotから登録年の連続範囲（200年未満）のcost projection、記録残高、事実・根拠を返す。ローカル原本パスを含めない。新しい独立page/editorを既存入力・影響確認導線へ接続。部分入力はdataset/editor/revision付き控えと個人ファイルで復旧し、自動送信しない。pageのBack/Forwardと訂正元anchorを扱い、費用リンクは年と配分IDを保つ。

採用時はproductTimelineを固定materialへ追加する。全年の事実に対して収録costYearsは当該採用年と参照された過去年だけの場合があるため明示する。保存版UI/Markdown/JSONは固定値だけを利用し、旧資料に後付けしない。historicalReviewMaterialsは関連年の活動/根拠を比較し、N年訂正後のN+1再採用は従来の訂正確認に従う。旧N・N+1のpayload/hash/exportは不変。統一請求取込は次節の追加契約へ分け、領収書抽出、会計CSV、特殊償却はこの段階の完成範囲に含めない。


### 原始請求の共通事実と取り込み（追加実装）

`PlanningSnapshot.originalCharges` は version 1 の追加契約。`app_settings.planning_original_charges_v1` に共通事実を保存し、既存の料金・設備・自宅費用・直接費を運用上の費用入力として維持する。物理DBへの独立した金額台帳を追加せず、同じ原額を二度計算しない。保存済みの事実は変更・削除を拒否し、訂正は元事実と理由を持つ追記として扱う。

手入力・CSV・JSONは共通の候補schemaを通す。取込元・安定キー・内容照合、原通貨額・採用円額・換算根拠、日付の種類・利用期間・契約・証拠を検証する。返金の金額調整と非金銭の事実訂正は別の記録とし、日付・根拠だけを変えるための0円調整は作らない。入力形式の厳密な契約、例、未対応範囲は[原始請求の共通取り込みv1](docs/ORIGINAL-CHARGE-INTAKE.md)を参照する。

候補を編集中workspaceへ反映した後は、既存の影響preview、期待revision、要求ID、3版比較、SAVEPOINTによる一括保存を使う。共通事実と既存の費用行の保存を分割しない。費用源と固定採用資料へ出典を保持し、日付・根拠だけの訂正も履歴比較の対象とする。後の訂正で旧採用版のpayload・hash・exportを更新せず、共通事実がない旧版へ現在値を補完しない。

現行サーバーは、保存済みの共通事実を省略する旧ブラウザの書き込み、未対応version、未知fieldを拒否する。この境界は旧実行バイナリで同じDBを安全に利用できる保証ではない。旧実行版へのダウングレード・新旧実行版の同一DB共有は未対応として区別する。バックアップと復元は既存の全DB snapshot・schema/hash/整合検査に加えて、このversion付き共通事実の検証を行う。


### ローカル領収書候補抽出

[対応範囲と制約](docs/RECEIPT-CANDIDATES.md)を参照。receiptFileReaderは選択Fileのバイトだけを読み、PDF.jsのローカル専用Workerへ渡す。5 MiB・20ページ・15秒・512 KiB・20,000項目で制限し、成功/失敗/abortで破棄する。外部URL/フォント/AI/OCR通信、埋め込みJavaScript実行、サーバーのパス読取りを行わない。画像OCRや暗号化PDFは手入力へ戻す。

receiptExtractionは明示ラベルのテキストと厳格な文書JSONからallowlist項目の複数候補だけを返す。ReceiptCandidateIntakeは未選択状態から本人が選んだ値をOriginalChargeIntakeへ渡す。原文・ファイル名・パスは控え/DTO/固定資料へ保存しない。OriginalChargeCandidate.documentは確認済みissuer/invoiceNumberだけの任意strict objectで、既存候補hashの対象。既存文書に項目がなければhashは変わらない。請求書番号とcontract.referenceを混同しない。

receipt provenanceと抽出テキストdigestの取込キー・安定IDを既存adapterへ渡し、既存の共通検証/訂正/重複確認/原子的workspace保存を使う。選択後は共通入力控え、選択前はファイル再読込が必要。キャンセル・遅延応答・画面/版変更はepoch+AbortControllerで遮断する。発行元/番号の訂正も事実追記で、旧事実を失う旧クライアント書込みは拒否する。採用年度出力は当時固定したdocument項目を表示し、原本へ再アクセスしない。

### 固定採用版の汎用会計CSV

`accountantCsvFiles`は保存済みBalanceReviewの明示したフィールドだけを投影する。APIはstoredReviewのhash検証、CLIはread-only reviewArchive経由。現在の計算器・元ログを呼ばない。UIはStoredReviewPanelから同じreviewのZIPと全文プレビューを一緒に作り、確認後だけダウンロードする。ZIP32 STORE・固定ファイル名・CRC32・定数日時、UTF-8 BOM CSV・CRLF・引用符エスケープ・数式接頭辞ガード。schema/金額意味/旧版欠落は[仕様](docs/ACCOUNTANT-CSV.md)参照。
