# 汎用会計転記 CSV v1

Schema: `devtax-accountant/1`。特定ソフト（freee・弥生等）の仕訳インポートではなく、税理士等が転記元を確認するための説明用資料。税務適用の確定、電子申告、税額計算、原本の法定保存は行わない。

## 取得と確認

「保存済みの年度資料」から一つの保存版を開き、汎用会計CSVを選ぶ。名称・理由・相談内容等を含む全ファイルをプレビューし、確認後にZIPをローカル保存する。読み込み・プレビュー・保存から第三者への送信は発生しない。APIは `GET /api/balances/reviews/:id/export?format=accountant-csv`、`application/zip`・attachment・no-store。

原本ログがなくても `npm run data:read -- export <data-or-backup-directory> <review-id> accountant-csv <new-output.zip>` で出力可能。元DBフォルダ外の新規ファイルだけに排他的に保存。DB移行・復元・再計算はしない。

## 同じ固定版と金額の意味

全CSV先頭3列はschema_version、review_id、review_year。review_idは指定された一つの採用版、review_yearはその年。訂正版は別ID。現在の入力、後の訂正版、元ログから不足を補わない。旧版の欠落はunresolvedに明示し、未知の保存schemaは拒否する。

| ファイル | 行と参照の意味 |
|---|---|
| review | 採用版・入力版・採用日時・計算版・訂正元・前年版・理由 |
| sources | cost_year × source_id の原始請求。原通貨額（十進文字列）、採用した原額円、換算・日付・証拠参照 |
| source_adjustments | source_id × adjustment_idの符号付き返金・訂正、効果、残高増減参照。新しい費用ではない |
| bases | cost_year × basis_id の計算基礎、元sourceまたは親contribution、方法ID/版/説明 |
| allocations | cost_year × contribution_id、basis、source、配分先・制作物。中間組入れと終端を区別 |
| annual_treatments | 保存された年次処理候補。用途・事実ID・状態・規則参照。費用候補/将来候補であり仕訳ではない |
| balances | 採用年のaccount_id別期首・期末・増減、選択方法・証拠参照 |
| balance_movements | 固定snapshotの全期間のmovement_id。movement_yearとin_review_yearで採用年の内外を明示。振替は1行 |
| movement_links | 増減と原価年/contribution、消費元opening/movementの追跡。金額を増減額へ加算しない |
| pending_decisions | 保存された質問・金額状態・金額不明理由・解決参照。active_in_reviewは固定projection上の未解決状態（解決参照の存在だけで解決済みとしない） |
| unresolved | 不明額・未解決処理・旧版の未収録項目の索引。別途費用として加算しない |

cost_yearは保存された費用計算年であり、取得・支払年や採用年と必ずしも同じではない。固定資料が過去年の原価参照を含む場合はその年も一度だけ収録。費用源・基礎・配分・候補・増減を足し合わせない。年度費用を得るために全CSVを単純合算することはできない。勘定科目・相手科目・消費税コードは生成しない。完全な事実・証拠説明・方式比較は同じ版のJSON/Markdownも参照する。

## セルと安全性

- UTF-8 BOM、カンマ区切り、レコード終端CRLF。文字列は二重引用符で囲み、内部の引用符を二重化。セル内部改行は保持
- 保存済みの円額・年・版等は安全な整数を検証し数値セルとして出す。負の訂正額は数値。未知の額は空欄＋unknown＋理由、既知の0は数値0
- 原通貨額・換算率は丸めを起こさない十進文字列。文字列は表計算ソフトの取込み時にも文字列列に指定する。引用符だけではIDの数値変換/日付変換を防げない
- 文字列の先頭（空白・制御/Unicode書式文字後も含む）が `= + - @`、または先頭がタブ/CR/LFならアポストロフィを付ける。保護は表現を変えるため元文字列は固定版JSONを参照。表計算ソフトで開く前に保護を除去しない
- `_json`列は参照/理由のJSON配列。空配列は`[]`。任意参照の空欄は未収録または該当なし。列順は同梱CSVヘッダーが契約。破壊的変更はschema版を変える
- ZIPは固定されたフラットな名前だけ、重複・パストラバーサル拒否、STORE/CRC32/固定日時。展開時に外部パスやリンクを作らない
- 構造上のローカル原本パス・履歴本文・生の領収書本文・観測データは選択しない。自由記述への個人情報入力は自動匿名化されないため全文確認が必要

自動回帰・APIヘッダー・ZIP検証とGUI実機ダウンロード確認は別。実機視覚・Windows固有動作の受入完了をこの仕様から推定しない。
