# DevTax v0.5 現在地と検証の入口

更新日: 2026-09-20（日本時間）  
候補HEAD: `0814b1410f12e3b87190f4b080eee722c546834c`  
PR #18 / `work/w07-w08-acceptance-20260918`。是正作業ブランチも同じHEADへ同期。mainへは未マージ。

## 目的是正の現在地

[目的是正計画](../../design/purpose-correction-plan.md)のC01〜C05は実装・push済み。複数年製作原価→一つの取得価額→適用可能な方法→選択方法の年額→既存残高/年度採用→固定版出力という中心経路を接続した。少額設備・設備3年一括、通常業務の不要質問、共通事実再利用、未送信入力復旧、文書契約整理も候補HEADに含む。

青色申告の少額資産特例は、既存の `annual-method-comparison/2` の適用判定を再利用し、事業所得・青色申告、事業者要件、他資産の特例使用済額、事業月数、明細準備を資産の方法記録へ固定して年額経路へ接続した。税額・申告内容の自動確定は行わない。

[最終是正記録](2026-09-20-purpose-correction-final.md)と[別環境hand-off](2026-09-20-purpose-correction-external-handoff.md)を現在の入口とする。

## GitHub管理

- #20 C01: 実装完了。複数年取得価額・不明/外部期首/二重使用の境界を実装。
- #21 C02: 実装完了。少額資産・通常業務・設備費用基礎・設備3年一括を実装。
- #22 C03: 実装完了。選択方法から実年額・残高・年度採用・固定出力まで接続。
- #23 C04: 実装完了。共通事実限定再利用、試算/採用分離、未送信入力復旧を接続。
- #24 C05: 実装完了。文書ゲートを契約中心へ整理し、現行モデル/生成物を同期。
- #25 C06: **外部受入待ち**。Node24/full dependencies、実API/React、Windows、公開GitHub/デモ/配布版を同一HEADで確認。
- #19: #25完了までopenを維持。

## 現環境での検証

個々のcommitの成功数はその範囲に限定し、合算しない。C03/C04画面統合60件、C04プリミティブ40件、C05文書検査50件、設備3年一括33件などの対象回帰は各commit証跡に残る。2026-09-20には青色特例を含む方法フォーム12件をNode22.16.0で再実行して成功した。完全依存が必要なReact/Zod/SQLite journey、Node24全体ゲートはC06へ引き継ぐ。

## 現行文書

[現行モデル](../../design/current-design.json)、[要件表](../../design/requirements-matrix.md)、[HTML設計図](../../design/workflow-blueprint.html)は是正候補HEADの接続状態へ更新済み。既存21AC行と8完了条件を弱めていない。

## 未実施を完了扱いにしないもの

Node24＋lockfile、全体Vitest、typecheck/build、lint、format、privacy、Release、実HTTP/API・React、Windows・狭幅、実共有フォルダ、GitHub公開導線、合成デモ版との一致。これらは #25 とhand-offへ集約する。

確認時点でrepositoryはprivate。MIT LICENSEがあっても展示QRを一般向けに使える状態とはしない。公開範囲変更・main merge・Release・Cloudflare deployは行っていない。実データ・原本・採用済み資料も変更していない。
