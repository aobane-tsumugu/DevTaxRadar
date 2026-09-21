import type { Diagnosis } from '../planning/types'

export type TaskHubDestination = 'setup' | 'costs' | 'folders' | 'summary' | 'balances' | 'transfer'

export type TaskHubItem = {
  id: string
  priority: 'high' | 'medium' | 'normal'
  title: string
  reason: string
  actionLabel: string
  destination: TaskHubDestination
}

export function buildTaskHubItems(input: {
  restoreRequiresReconnect: boolean
  unknownChargeCount: number
  unassignedFolderCount: number
  unavailableSourceCount: number
  taxUnitCount: number
  diagnosis: Diagnosis
}): TaskHubItem[] {
  const items: TaskHubItem[] = []

  if (input.restoreRequiresReconnect)
    items.push({
      id: 'restore-reconnect',
      priority: 'high',
      title: '復元した履歴の接続先を確認',
      reason: '別PCへ復元した資料は保持されています。履歴の読み取り元を確認するまで走査は停止しています。',
      actionLabel: '接続先を確認',
      destination: 'transfer',
    })

  if (input.unknownChargeCount > 0)
    items.push({
      id: 'unknown-charges',
      priority: 'high',
      title: `請求額が未確認のAI契約を確認（${input.unknownChargeCount}件）`,
      reason: '不明額は0円として計算せず、分かる支払だけを先に計算しています。',
      actionLabel: '支払を確認',
      destination: 'costs',
    })

  if (input.unassignedFolderCount > 0)
    items.push({
      id: 'unassigned-folders',
      priority: 'medium',
      title: `制作物へ未割当の履歴を確認（${input.unassignedFolderCount}フォルダ）`,
      reason: 'どの制作物の作業だったか未確認の履歴があります。既存の配分を勝手に変更しません。',
      actionLabel: '履歴を割り当てる',
      destination: 'folders',
    })

  if (input.unavailableSourceCount > 0)
    items.push({
      id: 'unavailable-sources',
      priority: 'medium',
      title: `読めない履歴のPC・共有元を確認（${input.unavailableSourceCount}件）`,
      reason: '前回の正常な集計は保持しています。共有先PCの停止・未接続・権限不足などを確認できます。',
      actionLabel: 'PCとデータを確認',
      destination: 'transfer',
    })

  if (input.taxUnitCount === 0)
    items.push({
      id: 'no-tax-units',
      priority: 'high',
      title: '作っているものを登録',
      reason: '費用を何のために使ったか対応付けるため、まず制作物を登録します。',
      actionLabel: '作っているものを登録',
      destination: 'setup',
    })

  for (const action of input.diagnosis.immediateActions.slice(0, 3)) {
    const id = `diagnosis-${action.id}`
    if (items.some((item) => item.id === id)) continue
    items.push({
      id,
      priority: action.priority === 'high' ? 'high' : action.priority === 'medium' ? 'medium' : 'normal',
      title: action.title,
      reason: action.reason,
      actionLabel: '月次確認を開く',
      destination: 'setup',
    })
  }

  items.push({
    id: 'annual-review',
    priority: 'normal',
    title: '今年の費用と未確認を確認',
    reason: '計算できた範囲と未確定の範囲を分けて確認します。表示だけで年度資料を採用したことにはなりません。',
    actionLabel: '今年を見る',
    destination: 'summary',
  })
  items.push({
    id: 'balance-review',
    priority: 'normal',
    title: '残高と翌年への繰越しを確認',
    reason: '期首・増減・期末と、年度資料として固定する内容を確認します。',
    actionLabel: '残高を見る',
    destination: 'balances',
  })

  return items
}
