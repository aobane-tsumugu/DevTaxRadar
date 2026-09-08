# DevTax v0.5 現在地と検証の入口

更新日: 2026-09-09（日本時間）  
今回の実装親: `7cba5797dc5cf983bd43c6a97c4c716040fcd0f9`

## 今回の変更

[実装・簡素化の作業計画](../../design/implementation-plan.md)のW01に着手した。workspaceのpreview・saveのHTTP受信上限を共通の2MiBにし、容量超過の説明と実API回帰試験を追加した。受入完了ではなく、作業ブランチ上の部分実装である。

HTML生成元のR6進捗を更新した。更新済みHTMLは作業環境で生成したが、GitHub上の生成済みHTMLの置換は未完了。[適用用差分](2026-09-09-workspace-capacity-html.patch)を残し、生成物まで更新済みとは扱わない。

## 実施と未実施

詳細は[HTTP容量の部分実装・検証記録](2026-09-09-workspace-capacity.md)。TypeScriptの構文確認、reply stubを使ったエラー処理確認、HTMLの章・図・アンカー確認を実施した。実API回帰試験・プロジェクト型検査・build・lint・ブラウザ試験・全体HTML再生成は未実施。

旧書込APIの移行、復旧用控えの容量整合、古いタブ・途中失敗・大容量時の入力保持の受入が残る。W01完了・AC-SAVE合格とはしない。W02〜W08の製品修正は未着手。実データ、原本、Actions設定、Releaseタグ、公開デプロイは変更していない。

## 次に進める作業

W01を継続する。特に`workspaceAttempt.ts`の2,000,000 UTF-16コード単位の控え上限とブラウザ容量を、HTTPのUTF-8バイト上限と混同しない。旧書込APIの利用箇所と既存試験を移行し、実API・入力復旧・HTML生成物を検証してからmainへ統合する。

要件の状態は[要件対応表](../../design/requirements-matrix.md)を参照。初回計画の記録は[2026-09-09の文書更新](2026-09-09-work-plan.md)、それ以前のCURRENT全文は[7c201f0までの履歴](history-through-7c201f0.md)に保持している。
