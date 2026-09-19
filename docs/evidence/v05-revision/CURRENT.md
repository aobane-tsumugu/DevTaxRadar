# DevTax v0.5 現在地と検証の入口

更新日: 2026-09-19（日本時間）。PR #18 / `work/w07-w08-acceptance-20260918`。
main確認値: `271ef56352ab782ff71434769ed1edb78565c513`。
目的監査の実装基点: `e98c8167abb8a06ede1dfb7eca071b64e802fa2d`。

## 監査後の現在地

**残るのはNode24の最終試験だけではない。** 目的・機能監査により、複数年原価からソフトウェア全体の取得価額、適用可能な方法から年度費用化・翌年度への接続、少額設備等の責務引継ぎ、過剰な確認と入力復旧に是正すべき実装残件を確認した。

今回作成したのは[是正実行計画](../../design/purpose-correction-plan.md)とGitHub管理項目であり、是正コードの実装完了ではない。計画は既存W01〜W08の責務と完了条件を達成するための補遺。旧計算や仮表示を復活させず、既存の共通費用計算・原価追跡・保存・採用版・復元を使う。

管理の入口: [親Issue #19](https://github.com/aobane-tsumugu/DevTaxRadar/issues/19)。現時点の子Issueは全件open・未着手。担当は着手時に設定し、期日は未設定。

| 順位 | 作業 | Issue |
| --- | --- | --- |
| P0 / C01 | 複数年度の製作原価をソフト全体の取得価額へ接続 | [#20](https://github.com/aobane-tsumugu/DevTaxRadar/issues/20) |
| P0 / C02 | 適用方法、通常業務の判定、少額設備の費用基礎を是正 | [#21](https://github.com/aobane-tsumugu/DevTaxRadar/issues/21) |
| P0 / C03 | 採用方法から費用化・改良・翌年度・訂正まで接続 | [#22](https://github.com/aobane-tsumugu/DevTaxRadar/issues/22) |
| P1 / C04 | 共通事実の再利用、試算／採用の分離、途中入力の復旧 | [#23](https://github.com/aobane-tsumugu/DevTaxRadar/issues/23) |
| P2 / C05 | 文書検査の適正化と旧責務引継ぎの確認 | [#24](https://github.com/aobane-tsumugu/DevTaxRadar/issues/24) |
| P1 / C06 | 目的ベースの横断受入、展示・配布版の整合確認 | [#25](https://github.com/aobane-tsumugu/DevTaxRadar/issues/25) |

C01とC02を並行着手し、C03へ統合する。C04の復旧とC06の受入設計は先行可能。C05の大規模整理を中核の製品導線より先に置かない。詳細な依存・対象コード・14の受入例は是正計画、具体的な実施状態はIssueで管理する。

中心の完成判定は、2025年60,000円＋2026年60,000円の製作原価を同じソフトの取得価額120,000円へまとめ、供用・適用方法・費用化・年度採用から2027年への繰越し、原本なし読取り、相談後訂正まで同じ根拠で完了すること。部品試験や文書一致だけで親Issueを閉じない。

## 今回の登録と検証範囲

計画書、監査基点の入力・観測結果、CURRENTを作業ブランチへ反映する。監査基点のJSONは[前回監査の記録](2026-09-19-purpose-audit-baseline.json)であり、計画作成中に製品試験を再実行した意味ではない。

今回の是正実装・製品回帰の合格はまだない。実装コード、生成モデル・HTML、8完了条件・21AC行を変更していない。以前の209件等の成功は以下の履歴の対象範囲に限定し、監査で発見した不足の解消には流用しない。

## 保持する既存成果

アプリ接続は `4f14395`・`6f574c4`、W08本体は `f4e92ef`、文書・CI整理は `577022d`〜`f6649d0` に反映済み。以前の「独立部品のみ」「4ファイル未反映」は現在の残件ではない。単なる接続コードの存在と、製品としての目的達成を区別する。

`b1f8635c11c9f87a4b07ff3d1bdc3f46c6152b84` では親原価の証拠欠落、費用読取り中のdataset変更、文書コピーのリンク／秘密設定を修正した。[当時の仕上げ記録](2026-09-19-environment-completion.md)、[実行結果・hash](2026-09-19-environment-result.json)、[再現helper](2026-09-19-environment-check.cjs)を保持する。当時の209件はNode22.16.0／TypeScript5.8.3、Vitest importだけをnode:testへ変えた限定実行。全HTTP/React・Node24の合格ではない。

保存則、原価上限、未知と0の分離、revision・要求ID、原子保存、保存版hash、旧版読取り、backup/restore、秘密境界は維持する。人への重複確認やAPIと無関係な文書hash更新を減らすことと、これらの防御を弱めることは別である。

## 検証と公開の分担

現環境で実行可能な実装・回帰・文書照合を進めてpushする。Node24／実機の最終試験は別環境とし、できない検証だけを対象HEADとともに明示する。未実施を合格にせず、反対に最終環境を待って是正実装を停止もしない。

別環境では、C06の同じ候補HEADでNode24＋lockfile、全体Vitest、型検査を含むbuild、lint、format、privacy、Release工程、HTTP/API・React操作、完全checkoutでの文書検査を実行する。Windows・狭い画面・実共有フォルダ等の結果もC06へ集約する。

```sh
npm run docs:generate
npm run docs:check
```

[設計README](../../design/README.md)、[要件表](../../design/requirements-matrix.md)、[実装計画](../../design/implementation-plan.md)を維持し、監査後の実施順序と未完了部分は是正補遺を併読する。モデル・生成物の更新は対応する是正実装と同時に行い、先に実装済みへ書き換えない。

公開設定、mainマージ、Release公開、デプロイは今回実施しない。展示では公開する版と利用可能な機能・合成デモ・GitHub QRを照合する。未対応の一般法人処理・特殊調整等は明示する一方、複数年ソフト原価の核心を未対応のまま完了扱いしない。

## 履歴

[W08の4ファイル解消](2026-09-19-w08-finalization.md)、[W08本体の同期](2026-09-19-w08-sync.md)、[候補部品の反映](2026-09-19-approved-retry.md)、[原本なし読取り](2026-09-18-offline-review-reader.md)、[backup照合](2026-09-18-backup-doc-verification.md)、[年度参照と証拠比較](2026-09-17-year-reference-evidence.md)を保持する。実データ・原本・採用済み資料・権限・課金設定は変更していない。
