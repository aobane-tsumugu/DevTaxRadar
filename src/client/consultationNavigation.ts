import type { ConsultationAnswer } from '../accounting/types'

export type ConsultationNavigation = {
  pendingId: string
  taxUnitId: string
  question: string
  answer: ConsultationAnswer
}
