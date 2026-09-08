# DevTaxの仕様と設計資料

製品仕様v0.5と技術設計v0.5は採用した完成形の正本。実装状態は要件対応表と検証証跡で別に管理する。

- [製品仕様](../../PRODUCT_SPEC.md): 目的、対象、全期間の責務と完成条件
- [技術設計](../../TECHNICAL_DESIGN.md): データ、計算、保存、API、復元の契約
- [全体設計図](workflow-blueprint.html): P1〜P6は目的と完成像、R1〜R6は採用設計、01〜19は現行経路
- [実装・簡素化の作業計画](implementation-plan.md): 承認済みレビューの実装順序・依存関係・削除条件。R6の作業計画へ対応
- [設計判断](purpose-led-redesign.md): 完成像と構造を選んだ理由
- [要件対応表](requirements-matrix.md): 要件の接続状態、コード、受入シナリオ
- [v0.5修正の検証証跡](../evidence/v05-revision/CURRENT.md): 実行結果と未完了の責務
- [旧製品仕様](archive/PRODUCT_SPEC.v0.4.md) / [旧技術設計](archive/TECHNICAL_DESIGN.v0.4.md): 旧判断の保存。現在の正本ではない

HTMLは外部ライブラリ不要のUTF-8ファイル。図と表は初期表示に含まれる。リンク先のソースも読む場合はリポジトリ内の配置を保つ。

リポジトリルートで生成・文書検査を行う。

```text
node scripts/design/build-workflow-blueprint.cjs
node scripts/design/verify-docs.cjs
```

生成元はscripts/designのbuild-workflow-blueprint.cjs、purpose-and-redesign.cjs、purpose-process-contract.cjs、end-state.cjs、current-costs.cjs、current-balances.cjs、current-workspace.cjs、current-impact.cjs。HTMLのみを直接編集せず、正本と対応表も合わせて更新する。根拠シンボルが消えれば生成が失敗する。

R2には、完成形の工程ごとに利用者の目的・実行主体・分岐・保存内容・現在の接続範囲を対応付けた表と、修正・再確認・採用・次年度更新への戻り先を示す図がある。現行実装の記述は2026-09-09確認の7c201f0を基準とする。HTML内のd917885＋未コミットの表記は、その内容を含む直前の生成時点の記録。今回追加した計画の承認を製品実装済みと読み替えない。

P2には、6つの利用者の問いから、横断経路・確認操作・未達の具体例・受入IDを対応付けた完成条件を掲載する。生成元はscripts/design/outcome-contract.cjs。R2の工程表と合わせ、処理単体の成功と製品目的の達成を区別して読む。

文書検査は要件・受入ID・ファイル参照・HTMLアンカー・掲載API・文字コード・埋込JavaScriptを確認する。スクリプト内だけの定数算術を製品の計算検証として扱わない。実画面、個人DB、共有到達性、税務適用、製品の受入を検証したとは扱わない。

R2の起動条件マトリックスはscripts/design/trigger-contract.cjsから生成する。出来事ごとの実行主体、自動処理、判断待ち・失敗時の分岐、保存結果を示し、計算・作業保存・年度採用の境界を明確にする。

R6の承認済み作業計画はscripts/design/work-plan.cjsから生成する。詳細と進捗の正本はimplementation-plan.md。変更時は生成元・HTML・該当要件・実施した検証を同じ変更へ含める。過去の証跡は履歴として残し、CURRENTを現在地の入口にする。
