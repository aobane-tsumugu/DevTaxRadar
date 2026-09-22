import type { HistorySource, HistorySourceTestResult, ProviderKey } from './types'

export type SourceStatusTone = 'ready' | 'warning' | 'muted'

export function providerHasEnabledSource(sources: HistorySource[], provider: ProviderKey): boolean {
  return sources.some((source) => source.provider === provider && source.enabled)
}

/**
 * The completion time of the oldest scan when every enabled source of the chosen providers
 * finished an incremental-eligible scan within `withinMs`; otherwise undefined.
 */
export function recentScanTime(
  sources: HistorySource[],
  providers: ProviderKey[],
  mode: 'incremental' | 'full',
  now = Date.now(),
  withinMs = 10 * 60 * 1000,
): Date | undefined {
  if (mode !== 'incremental') return undefined
  const relevant = sources.filter((source) => source.enabled && providers.includes(source.provider))
  if (!relevant.length) return undefined
  let oldest = Infinity
  for (const source of relevant) {
    const completed = Date.parse(source.lastScan.completedAt ?? '')
    if (source.lastScan.status !== 'complete' || source.availability !== 'available')
      return undefined
    if (!Number.isFinite(completed) || completed > now || now - completed > withinMs)
      return undefined
    oldest = Math.min(oldest, completed)
  }
  return new Date(oldest)
}

export function sourceAvailabilityCopy(
  source: Pick<HistorySource, 'enabled' | 'availability' | 'lastScan'>,
): {
  tone: SourceStatusTone
  text: string
} {
  if (!source.enabled) {
    return { tone: 'muted', text: '走査を停止しています。前回取り込み分は保持されています。' }
  }
  if (source.availability === 'unavailable' || source.lastScan.status === 'unavailable') {
    return {
      tone: 'warning',
      text: '利用できません。共有フォルダの接続・マウント・アクセス権を確認してください。前回取り込み分は保持されています。',
    }
  }
  if (source.lastScan.status === 'failed') {
    return {
      tone: 'warning',
      text: '読み取りに失敗しました。前回取り込み分は保持されています。',
    }
  }
  if (source.lastScan.status === 'never') {
    return { tone: 'muted', text: 'まだ取り込んでいません。' }
  }
  const completedAt = source.lastScan.completedAt
    ? `最終走査 ${new Date(source.lastScan.completedAt).toLocaleString('ja-JP')}`
    : '最終走査済み'
  const eventsWritten = source.lastScan.eventsWritten
  return {
    tone: 'ready',
    text:
      typeof eventsWritten === 'number'
        ? `${completedAt}・${eventsWritten.toLocaleString('ja-JP')}件を取り込みました。`
        : completedAt,
  }
}

export function sourceTestCopy(result: HistorySourceTestResult): {
  tone: SourceStatusTone
  text: string
} {
  if (result.availability === 'available') {
    return {
      tone: 'ready',
      text: `利用できます。履歴ファイルを${result.filesDiscovered.toLocaleString('ja-JP')}件確認しました。`,
    }
  }
  return {
    tone: 'warning',
    text:
      result.reason === 'not_found'
        ? 'フォルダが見つかりません。パスと共有フォルダの接続を確認してください。'
        : '読み取れません。マウント状態とアクセス権を確認してください。',
  }
}
