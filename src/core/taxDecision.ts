import type {
  Confidence,
  TaxCandidate,
  TaxDecision,
  TaxDecisionInput,
  WorkPurpose,
} from "./types.js";

const ORDINARY_PURPOSES: ReadonlySet<WorkPurpose> = new Set([
  "ordinary-operation",
  "maintenance",
  "bug-fix",
  "restoration",
]);

const CAPITAL_PURPOSES: ReadonlySet<WorkPurpose> = new Set([
  "feature-addition",
  "feature-improvement",
  "value-increase",
  "useful-life-extension",
]);

const PRIVATE_PURPOSES: ReadonlySet<WorkPurpose> = new Set([
  "hobby",
  "general-learning",
  "private-research",
]);

function clampRatio(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError("private use ratio must be between 0 and 1");
  }
  return value;
}

function confidenceFromFacts(
  input: TaxDecisionInput,
  candidate: TaxCandidate,
  missingFacts: string[],
): Confidence {
  if (candidate === "unclassified" || missingFacts.length >= 2) return "low";
  if (
    missingFacts.length === 1 ||
    input.businessUse === "mixed" ||
    input.businessUse === "unknown" ||
    !input.userConfirmed
  ) {
    return "medium";
  }
  return "high";
}

function monetaryEstimates(
  candidate: TaxCandidate,
  businessAmount: number,
): Pick<
  TaxDecision,
  "currentYearExpenseEstimate" | "futureBalanceEstimate" | "estimateStatus"
> {
  if (candidate === "ordinary-expense") {
    return {
      currentYearExpenseEstimate: businessAmount,
      futureBalanceEstimate: 0,
      estimateStatus: "estimated" as const,
    };
  }
  if (candidate === "capital-expenditure") {
    return {
      currentYearExpenseEstimate: null,
      futureBalanceEstimate: null,
      estimateStatus: "not-calculated" as const,
    };
  }
  if (
    candidate === "software-acquisition-cost" ||
    candidate === "production-cost" ||
    candidate === "prepaid-expense"
  ) {
    return {
      currentYearExpenseEstimate: 0,
      futureBalanceEstimate: businessAmount,
      estimateStatus: "estimated" as const,
    };
  }
  if (candidate === "unclassified") {
    return {
      currentYearExpenseEstimate: null,
      futureBalanceEstimate: null,
      estimateStatus: "not-calculated" as const,
    };
  }
  return {
    currentYearExpenseEstimate: 0,
    futureBalanceEstimate: 0,
    estimateStatus: "estimated" as const,
  };
}

/**
 * A deterministic candidate engine. It intentionally returns a candidate and
 * questions, rather than asserting the taxpayer's final treatment.
 */
export function decideTaxCandidate(input: TaxDecisionInput): TaxDecision {
  if (!Number.isFinite(input.amountJpy) || input.amountJpy < 0) {
    throw new RangeError("amount must be a finite non-negative number");
  }

  const missingFacts: string[] = [];
  const reasons: string[] = [];
  const appliedRuleIds: string[] = [];
  let candidate: TaxCandidate = "unclassified";

  const privateRatio =
    input.businessUse === "private"
      ? 1
      : input.businessUse === "business"
        ? 0
        : input.privateUseRatio === undefined
          ? undefined
          : clampRatio(input.privateUseRatio);

  if (
    (input.businessUse === "mixed" || input.businessUse === "unknown") &&
    privateRatio === undefined
  ) {
    missingFacts.push("業務利用と私用の合理的な按分率");
  }

  const businessAmount =
    privateRatio === undefined ? input.amountJpy : input.amountJpy * (1 - privateRatio);

  if (input.businessUse === "private" || PRIVATE_PURPOSES.has(input.workPurpose)) {
    candidate = "private-use";
    appliedRuleIds.push("TAX-PRIVATE-USE");
    reasons.push("趣味・一般学習・私的調査または私用として登録されています。");
  } else if (input.serviceProvidedInCurrentPeriod === false) {
    candidate = "prepaid-expense";
    appliedRuleIds.push("TAX-TIMING-PREPAID");
    reasons.push("当期末時点でサービス提供を受けていない期間に対応します。");
  } else if (input.workPurpose === "sales-production") {
    if (input.workInProgressAtPeriodEnd === true) {
      candidate = "production-cost";
      appliedRuleIds.push("TAX-PRODUCTION-WIP");
      reasons.push("販売目的で、期末時点に制作中のものへ直接対応します。");
    } else {
      candidate = "unclassified";
      appliedRuleIds.push("TAX-PRODUCTION-PERIOD-END-STATUS-REQUIRED");
      reasons.push(
        input.workInProgressAtPeriodEnd === false
          ? "期末仕掛品ではないため、販売済みか完成在庫かの確認が必要です。"
          : "販売目的の制作費は、期末時点の制作・販売状況の確認が必要です。",
      );
      missingFacts.push(
        input.workInProgressAtPeriodEnd === false
          ? "期末時点の販売済み・完成在庫の区分"
          : "期末時点の販売済み・完成在庫・制作中の区分",
      );
    }
  } else if (
    input.workInProgressAtPeriodEnd === true &&
    (input.revenueModel === "software-sale" ||
      input.revenueModel === "contract-development" ||
      input.revenueModel === "digital-content-sale")
  ) {
    candidate = "production-cost";
    appliedRuleIds.push("TAX-PRODUCTION-WIP");
    reasons.push("販売目的で、期末時点に制作中のものへ直接対応します。");
  } else if (input.placedInService === "before") {
    if (input.workPurpose === "new-development") {
      if (input.directlyAttributable === true) {
        candidate = "software-acquisition-cost";
        appliedRuleIds.push("TAX-SOFTWARE-DIRECT-DEVELOPMENT");
        reasons.push("供用前の新規ソフトウェア製作へ直接対応します。");
      } else {
        candidate = "unclassified";
        appliedRuleIds.push("TAX-SOFTWARE-DIRECT-ATTRIBUTION-REQUIRED");
        if (input.directlyAttributable === false) {
          reasons.push("特定ソフトへ直接対応しない費用として登録されています。");
          missingFacts.push("共通費として合理的・継続的に配賦できるか");
        } else {
          reasons.push("供用前の開発でも、特定ソフトへ直接対応する費用かの確認が必要です。");
          missingFacts.push("特定の資産へ直接対応する費用か");
        }
      }
    } else if (ORDINARY_PURPOSES.has(input.workPurpose)) {
      candidate = "unclassified";
      appliedRuleIds.push("TAX-LIFECYCLE-CONFLICT");
      reasons.push("供用前という状態と保守・修繕目的が矛盾しています。");
      missingFacts.push("実際の供用開始状況");
    }
  } else if (input.placedInService === "after") {
    if (ORDINARY_PURPOSES.has(input.workPurpose)) {
      candidate = "ordinary-expense";
      appliedRuleIds.push("TAX-REPAIR-MAINTENANCE");
      reasons.push("供用後の障害除去、原状回復または効用維持に対応します。");
    } else if (CAPITAL_PURPOSES.has(input.workPurpose)) {
      candidate = "capital-expenditure";
      appliedRuleIds.push("TAX-CAPITAL-IMPROVEMENT");
      reasons.push("供用後の新機能、機能向上、価値増加等に対応します。");
      reasons.push(
        "修繕費判定の20万円基準は、新規資産の20万円境界とは別に確認します。",
      );
      missingFacts.push("供用日、耐用年数、償却方法");
    } else if (input.workPurpose === "new-development") {
      candidate = "unclassified";
      appliedRuleIds.push("TAX-ASSET-UNIT-REVIEW");
      reasons.push("供用済み資産とは別の新規資産単位か確認が必要です。");
      missingFacts.push("既存資産と独立した効用を持つ新規資産単位か");
    }
  }

  if (input.placedInService === "unknown" && candidate === "unclassified") {
    missingFacts.push("実際の供用開始状況");
  }
  if (input.workPurpose === "unknown") {
    missingFacts.push("作業目的（保守、新規開発、機能向上等）");
  }
  if (candidate === "unclassified" && missingFacts.length === 0) {
    missingFacts.push("税務候補を決めるための作業実態");
  }

  const confidence = confidenceFromFacts(input, candidate, missingFacts);
  const userConfirmationRequired =
    !input.userConfirmed ||
    confidence !== "high" ||
    candidate === "private-use" ||
    candidate === "unclassified";

  return {
    candidate,
    confidence,
    appliedRuleIds,
    reasons,
    missingFacts: [...new Set(missingFacts)],
    userConfirmationRequired,
    ...monetaryEstimates(candidate, businessAmount),
  };
}
