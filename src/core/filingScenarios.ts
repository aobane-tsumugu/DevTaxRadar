export type FilingFactTotals = {
  current: number
  future: number
  review: number
}

export type FilingScenarioResult = {
  id: 'miscellaneous' | 'business-white' | 'business-blue'
  title: string
  currentExpenseCandidateJpy: number
  futureCostCandidateJpy: number
  reviewJpy: number
  condition: string
}

/**
 * Compares filing scenarios without changing the underlying facts. The three
 * monetary buckets intentionally remain comparable; scenario-specific rules
 * are expressed as conditions until the user has supplied the facts needed to
 * calculate an actual tax treatment.
 */
export function buildFilingScenarios(totals: FilingFactTotals): FilingScenarioResult[] {
  const common = {
    currentExpenseCandidateJpy: totals.current,
    futureCostCandidateJpy: totals.future,
    reviewJpy: totals.review,
  }
  return [
    {
      id: 'miscellaneous',
      title: '雑所得の場合',
      ...common,
      condition: '収入との対応と私用分を確認。青色申告者向け特例は含めません。',
    },
    {
      id: 'business-white',
      title: '事業所得・白色申告の場合',
      ...common,
      condition: '取得価額、利用開始、保守・機能追加の期間を通常ルールで確認します。',
    },
    {
      id: 'business-blue',
      title: '事業所得・青色申告の場合',
      ...common,
      condition: '白色と同じ事実に、承認状況・帳簿・期限を加えて特例候補を確認します。',
    },
  ]
}
