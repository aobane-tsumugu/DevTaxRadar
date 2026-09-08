/** Display an instant explicitly; never infer an evidence occurrence date from it. */
export function recordedTime(
  value: string,
  timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone,
): string {
  const date = new Date(value)
  if (!value || !Number.isFinite(date.getTime())) return '記録日時が不明です'
  return (
    new Intl.DateTimeFormat('ja-JP', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).format(date) + `（${timeZone}）`
  )
}
