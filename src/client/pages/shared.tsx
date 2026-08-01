import type { ReactNode } from 'react'
import type { TaxGroup } from '../types'
import type {
  HomeCostRecord,
  PlanningSnapshot,
  ProjectClassification,
  TaxUnitRecord,
} from '../../planning/types'

export const yen = new Intl.NumberFormat('ja-JP', {
  style: 'currency',
  currency: 'JPY',
  maximumFractionDigits: 0,
})

export const GROUP_LABELS: Record<TaxGroup, string> = {
  current: '今年の必要経費',
  future: '翌年以後へ残る原価',
  review: '対象外・要確認',
}

export const GROUP_CLASS: Record<TaxGroup, string> = {
  current: 'coral',
  future: 'indigo',
  review: 'amber',
}

export const CLASSIFICATION_LABELS: Record<ProjectClassification, string> = {
  'new-development': '新しく作った',
  maintenance: '保守・バグ修正',
  'feature-addition': '機能を大きく追加した',
  'general-learning': '一般的な学習',
  private: '趣味・私用',
  unclassified: 'あとで確認',
}

export const incomeCategoryLabel = (value: PlanningSnapshot['profile']['incomeCategory']) =>
  ({
    undecided: '所得区分・未確定',
    miscellaneous: '雑所得・検討中',
    business: '事業所得・検討中',
  })[value]

export const usageModeLabel = (value: TaxUnitRecord['usageMode']) =>
  ({
    internal: '自分の実作業で使う',
    external: '外部へ公開・提供する',
    mixed: '自分でも使い、外部にも提供する',
    undecided: 'まだ決めていない',
  })[value]

export const lifecycleLabel = (value: TaxUnitRecord['lifecycleStatus']) =>
  ({
    idea: '構想',
    prototype: '試作',
    developing: '開発中',
    evaluating: '評価中',
    'in-use': '正式利用中',
    maintaining: '保守中',
    improving: '改良中',
    retired: '廃止',
    abandoned: '開発中止',
  })[value]

export const categoryLabel = (value: HomeCostRecord['category']) =>
  ({
    rent: '家賃',
    electricity: '電気',
    internet: '通信',
  })[value]

export const monthKeyFromLabel = (label: string, fallbackYear: number) => {
  const japaneseMonth = label.match(/^(?:(\d{4})年)?(\d{1,2})月$/)
  if (japaneseMonth) {
    const year = japaneseMonth[1] ?? String(fallbackYear)
    return `${year}-${japaneseMonth[2].padStart(2, '0')}`
  }
  return `${fallbackYear}-01`
}

export function PanelHeading({
  title,
  subtitle,
  trailing,
}: {
  title: string
  subtitle: string
  trailing?: ReactNode
}) {
  return (
    <div className="panel-heading">
      <div>
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>
      {trailing}
    </div>
  )
}
