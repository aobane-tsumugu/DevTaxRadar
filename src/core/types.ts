export const PROVIDERS = ["claude", "codex"] as const;
export type Provider = (typeof PROVIDERS)[number];

export type BillingMonth = `${number}-${number}`;

export type Confidence = "high" | "medium" | "low";

export const TAX_CANDIDATES = [
  "ordinary-expense",
  "software-acquisition-cost",
  "capital-expenditure",
  "production-cost",
  "prepaid-expense",
  "private-use",
  "unclassified",
] as const;

export type TaxCandidate = (typeof TAX_CANDIDATES)[number];

export type AllocationBucket = "product" | "private";

export type UsageBasis = "weighted-tokens" | "active-seconds";

export type TokenBreakdown = {
  inputTokens: number;
  cachedInputTokens?: number;
  cacheCreationTokens?: number;
  outputTokens: number;
  reasoningTokens?: number;
};

export type UsageWeights = {
  input: number;
  cachedInput: number;
  cacheCreation: number;
  output: number;
  reasoning: number;
};

export type AllocationUsageLine = {
  id: string;
  productId?: string;
  taxUnitId?: string;
  workStage?: string;
  bucket: AllocationBucket;
  usageWeight: number;
};

export type UnobservedUsage =
  | { kind: "confirmed-none" }
  | { kind: "estimated"; ratio: number }
  | { kind: "unknown"; reserveRatio?: number };

export type MonthlyAllocationInput = {
  provider: Provider;
  billingMonth: BillingMonth;
  monthlyFeeJpy: number;
  usageLines: AllocationUsageLine[];
  unobservedUsage: UnobservedUsage;
};

export type AllocationLine = {
  kind: AllocationBucket | "unobserved" | "rounding-adjustment";
  sourceId?: string;
  productId?: string;
  taxUnitId?: string;
  workStage?: string;
  usageWeight: number;
  denominatorWeight: number;
  allocationRatio: number;
  allocatedAmountJpy: number;
};

export type MonthlyAllocationResult = {
  provider: Provider;
  billingMonth: BillingMonth;
  monthlyFeeJpy: number;
  capturedUsageWeight: number;
  unobservedUsageRatio: number;
  unobservedUsageEquivalent: number;
  lines: AllocationLine[];
  warnings: string[];
  invariantSatisfied: boolean;
};

export type WorkPurpose =
  | "ordinary-operation"
  | "maintenance"
  | "bug-fix"
  | "restoration"
  | "new-development"
  | "feature-addition"
  | "feature-improvement"
  | "value-increase"
  | "useful-life-extension"
  | "sales-production"
  | "general-learning"
  | "hobby"
  | "private-research"
  | "unknown";

export type BusinessUse = "business" | "private" | "mixed" | "unknown";
export type PlacedInService = "before" | "after" | "unknown";
export type RevenueModel =
  | "saas"
  | "advertising"
  | "affiliate"
  | "software-sale"
  | "contract-development"
  | "digital-content-sale"
  | "other"
  | "unknown";

export type TaxDecisionInput = {
  amountJpy: number;
  businessUse: BusinessUse;
  workPurpose: WorkPurpose;
  placedInService: PlacedInService;
  directlyAttributable?: boolean;
  revenueModel?: RevenueModel;
  privateUseRatio?: number;
  serviceProvidedInCurrentPeriod?: boolean;
  workInProgressAtPeriodEnd?: boolean;
  userConfirmed?: boolean;
};

export type TaxDecision = {
  candidate: TaxCandidate;
  confidence: Confidence;
  appliedRuleIds: string[];
  reasons: string[];
  missingFacts: string[];
  userConfirmationRequired: boolean;
  currentYearExpenseEstimate: number | null;
  futureBalanceEstimate: number | null;
  estimateStatus: "estimated" | "not-calculated";
};

export type FilingType = "blue" | "white" | "unknown";
export type IncomeCategory =
  | "business"
  | "real-estate"
  | "forestry"
  | "miscellaneous"
  | "unknown";

export type AssetThresholdInput = {
  acquisitionCostJpy: number;
  placedInService: boolean;
  acquisitionOrProductionDate?: string;
  placedInServiceDate?: string;
  filingType: FilingType;
  incomeCategory: IncomeCategory;
  eligibleSmallBusiness?: boolean;
  annualSpecialDeductionUsedJpy?: number;
  businessActiveMonths?: number;
  rentedAsset?: boolean;
  rentalIsPrimaryBusiness?: boolean;
  selectedThreeYearPool?: boolean;
  specialStatementReady?: boolean;
};

export type AcquisitionCostBand =
  | "under-100k"
  | "100k-to-under-200k"
  | "200k-to-under-400k"
  | "400k-and-over";

export type AssetTreatmentOption =
  | "not-yet-depreciable"
  | "immediate-expense"
  | "three-year-pool"
  | "ordinary-depreciation"
  | "blue-return-special-expensing";

export type AssetThresholdGuidance = {
  acquisitionCostJpy: number;
  band: AcquisitionCostBand;
  options: AssetTreatmentOption[];
  specialExpensingLimitJpy?: number;
  specialAnnualCapJpy?: number;
  specialExpensingAvailable: boolean;
  appliedRuleIds: string[];
  messages: string[];
  missingFacts: string[];
  userConfirmationRequired: boolean;
};
