# Multiple filesystem sources: UX

Status: **approved Phase 2 interaction**

## 1. Primary workflow

Source setup lives inside the existing local “設定を確認” flow, before the scan action. It is not a new administration application.

```text
AI利用履歴

Claude Code    読み取り元 2件    検出済み
Codex          読み取り元 2件    検出済み

読み取り元を管理
  このPC · Claude Code     既定
  PC1                       利用可能
  DGX                       前回は利用不能・取り込み分を保持

  [読み取り元を追加]
```

The user configures a provider, safe display name, absolute root, enabled state, and may test visibility before saving. The test reports only availability and JSONL count.

## 2. Automatic behavior

Opening DevTax starts one scan of every enabled source. No separate import/export operation appears. The existing scan button is a retry/refresh action, not the normal transport mechanism.

When a share is offline:

```text
利用できません。共有フォルダの接続・マウント・アクセス権を確認してください。
前回取り込み分は保持されています。
```

The rest of the dashboard remains usable with the last successful data. Stale/offline is provenance, not a reason to zero allocations.

## 3. Source labels

The source alias is user-entered and appears beside folder/session metadata. Suggested examples are `PC1`, `PC2`, `DGX`, or `制作PC`.

DevTax does not derive aliases from hostnames, repository remotes, or full paths. The settings form rejects slashes and control characters. A basename-only project label may appear because it is already part of the mapping workflow.

## 4. Path display

Full roots render only in the source manager and wrap within the modal. They never appear in dashboard cards, folder assignment rows, session lists, allocation rows, planning/export, errors, or status announcements.

Default local roots are visible but non-editable and non-removable. Configured roots can be edited, enabled/disabled, tested, or removed.

## 5. Removal safety

Removal requires a separate confirmation panel:

```text
“DGX”を削除しますか？

この読み取り元の取り込み済み集計も削除されます。
元の履歴ファイルは変更・削除しません。

[キャンセル] [取り込み分を削除する]
```

Changing the root preserves the source identity. Changing the provider is prohibited; the user creates another source instead.

## 6. Assignment provenance

Folder assignment rows show:

- basename/generic project label;
- provider;
- safe source alias or aliases;
- session counts and date range; and
- existing effective-date assignments.

Multiple sources can be assigned to one tax unit without merging their source/session identities. Session detail/resume is available only for built-in local sources. Configured shared sources show aggregate metadata only.

## 7. Accessibility

- All operations use labelled native inputs, selects, checkboxes, and buttons.
- Connectivity and scan results use polite status announcements.
- Validation and removal failures use alerts.
- The removal action is never triggered by selection alone.
- Path text wraps without horizontal-page overflow.
- At narrow widths, source rows and form fields collapse to one column.
- Drag-and-drop remains unnecessary for source setup and is not the only mapping path.

The broader project/tax-unit mapping UX remains the existing list, bulk selection, period rules, and keyboard/click operations. A relationship-map visualization is deferred until real use demonstrates need.
