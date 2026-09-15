# 外部資料からの期首根拠の接続

基点: main `056c2450153764d28c2033b6d8f84ac09c275a86`。

W06の初回期首を既存の残高・証拠・判断・確認事項へ接続した。新しい台帳・保存API・DB移行は追加していない。`external-opening:`名前空間の確認事項は一つの残高に対応し、制作中原価・未償却残高・前払残額の意味、出典、本人確認日時、対象年、対象額を保持する。既知額は同じ制作物・年の確認済み判断に結び、不明額は未判断のまま保持する。期首額そのものを変更・再加算しない。既存の採用版由来の期首をこの操作で上書きしない。

`checkBalanceReferences`から外部期首の対応を照合し、金額・不明理由・年・種類・制作物・証拠の変更後に古い確認を採用へ通さない。既存の保存・再送・復旧・年度採用の境界を利用する。元の未判断入力は内容を変えず`PendingBalanceFields.tsx`へ移し、同じ親draftを編集する外部期首欄を追加した。

検証: Node.js 22.16.0、インストール済みTypeScriptで実装の型構文を除去。`tests/core/externalOpening.test.ts`のdescribe/itのimportだけをNode標準のtestへ変更し、assertは元のまま実行した。31件成功、失敗0、skip 0。実際の既存decisionConfirmation・consultationResolution・balanceReferencesを使用。UIのTSX構文変換も診断0件。

未実施: Node 24の全Vitest、プロジェクト全体の型検査・build、ブラウザ、実API保存・採用・別PC復元、Windows実機。外部資料の原本内容や税務適用を自動検証したものではない。既存の手入力期首の出典を推測・生成していない。この記録だけでW06〜W08の全受入完了とはしない。
