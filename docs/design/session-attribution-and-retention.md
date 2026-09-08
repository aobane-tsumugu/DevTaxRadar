## 9. エラー処理

- スキャン中に読めないファイルがあっても中断せず、`diagnostics` に計上して続行する（既存方針を維持）
- `session_references` の元ファイルが消えている場合、集計は影響を受けない。UIは「削除済み」と表示する
- `settings.json` の書き換えは、パース失敗・書き込み権限なし・バックアップ失敗のいずれでも中止し、理由を返す
- ルール解決で複数ルールが該当した場合は例外にせず、5章のタイブレークで決定的に1つ選ぶ
- 割当画面で制作物を削除したとき、それを参照するルールは未割当へ戻す（外部キー制約に任せず明示的に処理する）
## 13. 公開前の作業（本設計の外）

A/B実験関連ファイルを別リポジトリへ分離する。`.gitignore` の否定パターンを削除し、`docs/README_AB_EXPERIMENT.md`、`artifacts/readme-ab-experiment*`、`artifacts/readme-ab-summary.csv`、`scripts/run-readme-ab-experiment.mjs` を公開対象から外す。
