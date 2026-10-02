import type { FileCapture, SourceCaptureContext } from '../accounting/observationRecord.js'

/** Count synthetic unverified captures by session, even when they span projects/months. */
export function retainedCaptureCounts(files: readonly FileCapture[]) {
  return {
    missingRetained: files.filter(
      (file) => file.state === 'missing-retained' && file.eventCount > 0,
    ).length,
    unverifiedRetained: new Set(
      files
        .filter((file) => file.state === 'unverified-retained')
        .flatMap((file) =>
          file.observationRefs?.length
            ? file.observationRefs.map((ref) => `session:${ref.sessionKey}`)
            : [`capture:${file.fileKey}`],
        ),
    ).size,
  }
}

/** Stable factual warnings only: scan time changes do not invent changes to cost arithmetic. */
export function captureWarnings(
  sources: readonly SourceCaptureContext[] | undefined,
  provider: 'claude' | 'codex',
  selectedSourceIds?: readonly string[],
): string[] {
  if (!sources)
    return ['この資料には取得元別の来歴がありません。現在の取得状態で過去の根拠を補完しません。']
  const relevant = sources.filter(
    (source) =>
      source.provider === provider &&
      (!selectedSourceIds || selectedSourceIds.includes(source.sourceId)),
  )
  const messages: string[] = []
  for (const id of selectedSourceIds ?? []) {
    if (!relevant.some((source) => source.sourceId === id))
      messages.push(`選択した取得元 ${id} が見つかりません。取得範囲は未確認です。`)
  }
  for (const source of relevant) {
    const label = `取得元 ${source.sourceId}`
    if (!source.enabled)
      messages.push(`${label} は現在停止中です。保存済みの数値は削除していません。`)
    const capture = source.capture
    if (!capture || !capture.matchesCurrentValues) {
      messages.push(
        `${label} の取得来歴を現在の数値に対応付けられません。取得方式・前回値使用の範囲は不明です。`,
      )
      continue
    }
    if (capture.status === 'unavailable')
      messages.push(
        `${label} に接続できず、更新は未完了です。保存済み数値を使っています。原本の現在の有無は未確認です。`,
      )
    if (capture.status === 'failed')
      messages.push(
        `${label} を最後まで安全に読めず、更新は未完了です。保存済み数値を使っています。原本の現在の有無は未確認です。`,
      )
    const retained = retainedCaptureCounts(capture.files)
    if (retained.missingRetained)
      messages.push(
        `${label}：最後まで走査できた時点で見つからなかった原本 ${retained.missingRetained}ファイルの取込済み数値を保持しています。削除・移動等の理由は判定できず、新しく確認した利用量ではありません。`,
      )
    if (retained.unverifiedRetained)
      messages.push(
        `${label}：原本との対応を確認できない ${retained.unverifiedRetained}セッションの取込済み数値を保持しています。削除されたのか、まだ見えていないのかは判定できず、期間別の詳細を再構成していません。`,
      )
    if (retained.missingRetained || retained.unverifiedRetained)
      messages.push(
        `${label}：保持しているのは取込済みの数値です。元の会話本文のバックアップではなく、取り込み前に削除された履歴は復元できません。税務上の証明や法定保存を保証しません。`,
      )
    const previous = capture.files.filter((file) => file.state === 'deferred-previous').length
    const missing = capture.files.filter((file) => file.state === 'deferred-missing').length
    if (previous || missing)
      messages.push(
        `${label}：前回値使用 ${previous}ファイル、初回取得保留 ${missing}ファイル。件数から欠落金額を推定していません。`,
      )
    const methods = [
      ...new Set(capture.files.map((file) => `${file.adapter}/${file.schemaVersion}`)),
    ].sort()
    messages.push(
      `${label}：取得暦 ${capture.timeZone}、方式 ${methods.join('、') || '記録なし'}。走査完了はアカウント全利用の捕捉を保証しません。`,
    )
  }
  return [...new Set(messages)]
}
