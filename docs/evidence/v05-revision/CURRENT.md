# DevTax v0.5 現在地と検証の入口

更新日: 2026-09-21（日本時間）  
main: `450f154268f06d23f357d012715ce5e6c8b62fc6`（PR #18で目的是正C01〜C05を統合済み）  
改善ブランチ: `work/ux-task-hub-multi-pc-20260921` / draft PR #29 / Issue #28

## 目的に対する現在地

DevTaxの中心経路である、支払・利用実態 → 制作物への配分 → 複数年度の製作原価 → 一つの取得価額 → 適用可能な方法 → 選択方法の年度額 → 既存残高 → 年度資料 → 翌年度・訂正・相談、はmainへ統合済み。

対応済み範囲では、不明額を0円へ変換せず、元費用・原価・取得価額・年度費用を二重計上せず、試算と採用版を分離する。ソフトウェアの年額費用化は、保存済み方法・取得価額・根拠・供用・対象年の継続確認から構造化DecisionRecordを作り、内部候補名を別画面で入力せず既存残高へ接続する。

税額算定、電子申告、所得区分の自動確定、未対応の特殊償却等を完成済みとはしない。

## GitHub管理

- #19: 目的是正の親Issue。#25完了までopen。
- #20〜#24: C01〜C05実装済み。#23 C04も再監査残件を是正してclosed。
- #25: main `450f154268f06d23f357d012715ce5e6c8b62fc6` のNode24・実API/React・Windows・backup/offline-reader等の最終受入。open。
- PR #18: mainへmerge済み。
- #28 / PR #29: 目的達成後のUX・複数PC改善。#25の固定main受入とは分離して扱う。

## #28 UX・複数PC改善

draft PR #29では以下を実装中。

- 初期画面を「今回確認すること」へ変更。
- 復元再接続、請求額不明、未割当履歴、利用不能source、診断上の即時確認を優先して既存作業へ案内。
- 優先事項が0でも「税務確認完了」と表示せず、「今年どうなる？」と「残高と繰越し」を別作業として残す。
- 「PCとデータ」で「複数PCのClaude/Codex履歴を1台へ集約」と「DevTaxの保存DBを別PCへ引っ越す」を分離。
- `createDataBundle / verifyDataBundle / restoreDataBundle` を再利用し、ローカル画面から検証付きbackup作成、bundle検証、新規データフォルダへのrestoreを実行するAPIを追加。
- restoreは現在DBを上書き・切替えせず、新規保存先だけ作成。復元先で起動した後は既存のsource再接続保留へ戻す。
- ブラウザlocalStorageの未送信控え、元ログ、証拠原本、外部アプリ設定はPC移行bundleへ含めない。
- クラウド同期・複数PC同時編集は導入しない。

## 今回の静的確認

PR #29候補について以下をGitHub上の現行ソースで確認。

- PRODUCT_SPEC要件: 31 / current-design要件: 31。
- 受入シナリオ: 21。既存契約を変更していない。
- 実登録API: 39 / current-design API: 39 / 不足・過剰: 0。
- 新API: `POST /api/data-transfer/backup`, `/verify`, `/restore`。
- `requirements-matrix.md` は更新後current-designとacceptanceからの再生成内容と完全一致。
- 解消済みC04を「未接続」とするcurrent-designの古い境界記述を削除。
- task homeの純粋関数回帰 `tests/client/taskHub.test.ts` を追加。

## 未実施を合格扱いにしない

このセッションの実行環境ではNode >=24.14.0のcheckout/lockfile依存を使ったnpmゲートを実行していない。PR #29作成後にGitHub ActionsのPR runを確認したが、現時点でrun/statusは0件。したがって次は以下をこの改善PR自身に対して実行する必要がある。

```sh
npm ci
npm run docs:check
npm run typecheck
npm test
npm run lint
npm run format:check
npm run build
npm run privacy:check
npm run release:pack
```

さらにReact実操作、Windows・狭幅、実際のbackup→別PC/別保存先restore→source再接続を確認する。これらが終わるまでPR #29はdraftのままにする。

## 複数PCの対応境界

履歴の複数PC利用は、DevTaxを動かす1台から各PCのClaude Code/Codex履歴フォルダをOS共有経由でsourceとして読み取る方式。共有元が読めない場合はそのsourceだけ更新せず前回の正常値を保持する。

DevTax本体は1台のローカルSQLiteを正とする。別PCへ移す場合は保存済みDBと識別子をbackup/restoreして引き継ぐ。リアルタイム同期や複数PC同時編集は提供しない。

## 現行文書

- [現行モデル](../../design/current-design.json)
- [要件表](../../design/requirements-matrix.md)
- [HTML設計図](../../design/workflow-blueprint.html)
- [目的是正最終記録](2026-09-20-purpose-correction-final.md)
- [main C06 hand-off](2026-09-20-purpose-correction-external-handoff.md)

repositoryはprivateのまま。Release公開、Cloudflare deploy、repository visibility変更、実データ・原本・採用済み資料の変更は行っていない。
