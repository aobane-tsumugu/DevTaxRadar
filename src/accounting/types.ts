/** Accounting records contain opaque references, never transcript bodies or native paths. */
export type BalanceKind = 'construction' | 'asset' | 'prepaid'

export type AmountState =
  { status: 'known'; amountJpy: number } | { status: 'unknown'; amountJpy: null; reasons: string[] }

export type BalanceAccount = {
  id: string
  taxUnitId: string
  name: string
  kind: BalanceKind
  /** The opening is at the beginning of this calendar year. */
  openingYear: number
  opening: AmountState
  /** The adopted record providing the opening, when carried from another record. */
  openingRevisionId?: string
}

type MovementBase = {
  id: string
  occurredOn: string
  amountJpy: number
  /** Opaque evidence/cost/decision references allowing a user to trace the amount. */
  sourceIds: string[]
  decisionId: string
  reason: string
  /** Explicit sources consumed by expense, reduction, or transfer; never inferred FIFO. */
  balanceAllocations?: BalanceFlowAllocation[]
}

export type BalanceFlowAllocation = {
  sourceKind: 'opening' | 'movement'
  sourceId: string
  amountJpy: number
  /** Explicit composition of this use; omitted keeps uniquely determined tracing, [] leaves it untraced. */
  costAllocations?: BalanceCostAllocation[]
}

/** A transfer is one record, so its two sides cannot be saved independently. */
export type BalanceMovement = MovementBase &
  (
    | { kind: 'addition'; accountId: string; costAllocations?: BalanceCostAllocation[] }
    | { kind: 'expense'; accountId: string }
    | { kind: 'reduction'; accountId: string }
    | { kind: 'transfer'; fromAccountId: string; toAccountId: string }
  )

/** Explicit use of a terminal cost contribution, never a second use of a transferred balance. */
export type BalanceCostAllocation = { costYear: number; contributionId: string; amountJpy: number }

/** Active unresolved treatments remain visible in later years without posting a known balance. */
export type PendingBalanceDecision = {
  id: string
  taxUnitId: string
  taxYear: number
  amount: AmountState
  accountIds: string[]
  reasons: string[]
  sourceIds: string[]
  /** Retain the original question; stop carrying it from this year onward. No automatic posting. */
  resolution?: {
    taxYear: number
    decisionId: string
    reason: string
    answerBasis?: ConsultationAnswer[]
    questionBasis?: PendingQuestionBasis
  }
  answers?: ConsultationAnswer[]
}

export type ConsultationAnswer = {
  id: string
  taxYear: number
  receivedOn: string
  kind: 'fact' | 'method'
  answer: string
  source: string
}

export type PendingQuestionBasis = {
  pendingId: string
  taxUnitId: string
  taxYear: number
  amount: AmountState
  accountIds: string[]
  reasons: string[]
  sourceIds: string[]
  resolutionYear: number
  decisionId: string
  resolutionReason: string
}

export type BalanceSnapshot = {
  version: 1
  accounts: BalanceAccount[]
  movements: BalanceMovement[]
  pendingDecisions: PendingBalanceDecision[]
}

export type AnnualBalanceRow = {
  accountId: string
  taxUnitId: string
  name: string
  kind: BalanceKind
  openingRevisionId?: string
  opening: AmountState
  additionsJpy: number
  transfersInJpy: number
  transfersOutJpy: number
  expensesJpy: number
  reductionsJpy: number
  closing: AmountState
  movementIds: string[]
  pendingDecisionIds: string[]
}

export type AnnualBalanceProjection = {
  version: 1
  year: number
  accounts: AnnualBalanceRow[]
  totals: {
    /** Unknown accounts are excluded from these subtotals and explicitly listed. */
    knownOpeningJpy: number
    knownClosingJpy: number
    additionsJpy: number
    transfersInJpy: number
    transfersOutJpy: number
    expensesJpy: number
    reductionsJpy: number
    unknownAccountIds: string[]
  }
  pendingDecisions: PendingBalanceDecision[]
}
