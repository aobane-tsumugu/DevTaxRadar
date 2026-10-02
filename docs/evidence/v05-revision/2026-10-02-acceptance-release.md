# 2026-10-02 C06 再受入と v0.1.1 候補

## 対象と判定

基点: main `58efe6f618ef87e845ec5a6012961a67b6a777e6`。本記録を含む PR の固定 HEAD が再検証対象であり、最終 SHA と CI 結果は PR / Issue #25 へ記録する。

判定は **実装修正・自動検証済み / 実画面・Windows の正式受入は未完了 / 次版公開は保留**。#19 / #25 を閉じる根拠にはしない。

実在の税務・請求・履歴データは使用しない。既存の未コミット作業を変更せず、独立した checkout、合成 fixture、一時 HOME / データ保存先を使用した。Linux の結果を Windows 実機や共有フォルダの結果として記載しない。

## 発見と修正

1. `SoftwareMethodPanel` の整数解析の正規表現が通常の数字を受理せず、青色少額資産特例の他資産使用額・事業月数が正しくても方法選択へ進めなかった。実際の React パネルで eligible preview から未保存の方法選択までを回帰検証した。HTTP保存や実ブラウザ成功を意味しない。
2. 単独で期間重複のない請求は、契約ごとの履歴範囲・捕捉外割合の編集へ到達できなかった。重複警告と編集入口を分離し、単独請求でも設定できるようにする。
3. README の年額請求・期間按分・原額不明・契約別捕捉外割合の未対応表記と、README / CONTRIBUTING の format ゲート常時失敗表記を現行実装へ合わせる。
4. Release workflow に docs / format ゲートを追加し、PR CI に Linux / Windows の matrix と配布パッケージの lifecycle 検証を追加する。通常 CI と配布直前のゲートが異なる問題を防ぐ。

## 環境・実行

Node v24.19.0 / npm 11.9.0 / Linux。lockfile に対して `npm ci` を実行した。依存更新は `brace-expansion` 5.0.9 → 5.0.12 の同一majorのセキュリティ修正に限定した。

- `npm ci`: 終了 0
- `npm run docs:check`: 終了 0（31 要件 / 21 受入条件 / 8 完了条件 / 39 API）
- `npm run typecheck`: 終了 0
- `npm test`: 終了 0（最終候補の結果は下記）
- `npm run lint`: 終了 0（既存 warning あり）
- `npm run format:check`: 終了 0
- `npm run build`: 終了 0（500 kB 超 bundle の warning あり）
- `npm run privacy:check`: この環境の tsx CLI が Unix IPC 作成時に EPERM となり終了 1。アプリ検査失敗ではない。`node --import tsx scripts/privacy-check.ts` で同じスクリプトを実行し終了 0。
- `npm run release:pack`: 同じ tsx CLI 制約があるため、`node --import tsx scripts/package-release.ts` で実行し終了 0。GitHub CI では標準の npm コマンドを検証する。

最終テスト結果: 179 files、1,686 passed / 1 skipped（合計1,687）。skipはWindowsのパス大小文字検証で、Linuxでは実行しない条件分岐。過去の件数は合算していない。

配布 lifecycle は起動、請求保存・投影、backup 作成・検証、全表 restore、採用資料の単独読取り、再接続、再起動を合成データで検証する。新規保存先のみを使用し、原本接続なしの固定資料も検証する。

## CIで追加検出した事項

初回 `bb1a979` の Windows CI は全ゲートと配布lifecycleに成功。Ubuntuでは既存の過大リクエスト試験がwrite EPIPEで失敗した。Content-Lengthによる早期拒否と2MiB送信の競合を避け、chunkedで制限内の書込み完了後に超過1byteを送る試験へ修正した。完全な413本文・上限値・保存不変の検査は弱めていない。30回の独立したサーバー起動で180試験（過大リクエスト60回）が成功した。最終CIはPRの固定HEADで再実行する。

依存監査では、配布対象の`@fastify/static → glob → minimatch → brace-expansion`に既知のbrace-pattern DoSを確認し、5.0.12へpatch更新した。アプリのwildcard=true設定ではglob列挙の分岐を使わないが、配布依存自体も更新する。`npm audit --omit=dev`は指摘0件。開発専用のVitest/mocker、ViteのPostCSS/nanoid、jsdom等のundici、Wrangler/miniflare/sharpには対応可能な指摘が残る。最小ZIPには開発依存を含めず、全依存の監査完了とはしない。

## 実ブラウザの確認と制限

クラウドの Chrome からローカル Vite `127.0.0.1:5173` を開く操作は `net::ERR_BLOCKED_BY_CLIENT`。原因は断定できず、公開・トンネル・セキュリティ無効化による回避は行わない。このため、今回の候補の入力・保存を伴う実ブラウザ受入と狭幅検査は未実施。React/jsdom は実ブラウザやレイアウトの代替証拠にしない。

公開合成デモ `https://devtax-radar.pages.dev/` はクラウド Chrome で表示・操作できた。年次サマリー → 支払と配分 → 残高と繰越し → PCとデータを確認。未算定2件は小計に含まれず、残高保存とPCファイル操作はローカル版のみとの境界が表示された。これは既存公開デモの確認であり、新候補の保存受入ではない。

配信 JS は `/assets/index-Bc_vVG3t.js`。基点 checkout の build は `/assets/index-eo_Dw8Fy.js` で一致しない。公開デモに候補のソースSHAを確認できる表示はなく、T14 の版一致は未確認。デモのコンソール取得にはブラウザ拡張由来の metadata エラーがあり、取得した範囲でアプリ由来のエラーはなかった。

## 公開状態

GitHub connector で repository の `visibility=public` を確認。v0.1.0 tag は `9879d8e` にあり、PR #34 を含まない。古い #25 の private / 未配布表記は当時の記録として読み、現在の状態と区別する。

v0.1.1 はこの修正と PR #34 をまとめる patch 候補。タグ作成、Release 公開、本番デモ更新はこの PR の作成・検証だけでは行わない。公開前に固定 SHA、CI、ZIP、デモ対象版を照合する。

## 受入対応表

以下の automated 証拠は実画面受入と別扱い。T01/T02 の旧 Windows 成功は [2026-09-23 の Issue 記録](https://github.com/aobane-tsumugu/DevTaxRadar/issues/25#issuecomment-5784789642) にあり、今回の HEAD の成功へ転用しない。

| 対象 | 今回の automated 証拠（tests配下） | 残る確認 |
| --- | --- | --- |
| T01/T02 | core/softwareAcquisitionBasis、softwareAnnualDecision、softwareMethod、core/correctionPurposeJourney | 同一HEADの実画面で複数年原価→取得価額→年度採用→翌年 |
| T03 | core/annualMethodAlternatives、softwareMethod、client/correctionMethodForm（純粋helper） | 80,000円の実画面操作 |
| T04 | core/annualMethodComparison、assetThresholds、client/softwareMethodPanel（今回追加のReact/jsdom） | 全金額・日付・貸付境界と経理方式に応じた全体額の実画面確認。経理方式は本人の全体額確認であり、自動確定しない |
| T05 | core/annualMethodAlternatives（通常業務は資産供用状態に依存しない）、taxDecisionUncertainty、costTreatments | 実際のCostTreatmentFactsEditorで通常業務先を選ぶ経路 |
| T06 | core/equipmentImmediateIntegration、equipmentPoolIntegration、equipmentMethodProjection、homeTargetProjection、directTargetProjection、balanceCostProvenance、server/planningApi | 全費用種別をつなぐ一つの実画面シナリオ |
| T07 | core/softwareAcquisitionBasis、softwareAcquisitionDraft、client/costsPage（jsdom）、server/planningApi（実HTTP） | 不明原価・外部期首を含む実画面の確認 |
| T08 | core/correctionPurposeJourney のT08、core/balanceUseDraft | 既存T08は取得価額・方法fixtureの後で改良区分へ変更しており、機能追加の分類から改良取得価額までの統合回帰ではない。旧版を自動除却しない境界に加え、実際の改良事実からの経路を検証する |
| T09 | core/treatmentDecisionScenario、softwareMethod、annualMethodComparison、core/correctionScenarioHistory | 実際の試算表示変更から採用版が変わらないこと |
| T10 | core/correctionCommonFacts、treatmentFactsReuse、client/correctionEditorHook・decisionEditorRecovery（React/jsdom）、workspace recovery tests | 実ブラウザで未送信控え・競合・容量・別dataset・中断/復帰。自動再送なし |
| T11 | server/restoredReviewApi（実HTTP/process）、reviewMaterials、reviewArchive、core/correctionSavedMethodOutput、配布lifecycle | 同一HEADの実ブラウザ操作による前年訂正・翌年採用・原本消失後の固定版読取り |
| T12 | server/currentDesignInputs、designDocs、currentDesign | 自動検証で対象を網羅。文書ゲート成功を製品全体の受入成功にしない |
| T13 | core/contractUsage（A8,000/B2,000）、allocation、server/server.integration（実HTTP）、client/duplicateChargesPanel（React/jsdom） | 契約別・provider別・私用・端数を通した実画面での保存と再読込 |
| T14 | GitHub公開/ReleaseのGET確認、公開合成デモ4画面のChrome操作、候補ZIP lifecycle | 最終候補SHA・公開Release・デモ配信の一致。未公開候補を配布済みと案内しない |

チェック済みソースには Playwright / Cypress の実ブラウザ自動受入スイートはない。React/jsdom、純粋helper、core/SQLite、実HTTP、配布プロセス、実ブラウザの証拠を区別して維持する。
