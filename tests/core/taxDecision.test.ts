import { describe, expect, it } from "vitest";

import { decideTaxCandidate } from "../../src/core/index.js";

describe("tax candidate decision tree", () => {
  it("classifies directly attributable pre-service development as acquisition cost", () => {
    const result = decideTaxCandidate({
      amountJpy: 30_000,
      businessUse: "business",
      workPurpose: "new-development",
      placedInService: "before",
      directlyAttributable: true,
      userConfirmed: true,
    });

    expect(result).toMatchObject({
      candidate: "software-acquisition-cost",
      confidence: "high",
      currentYearExpenseEstimate: 0,
      futureBalanceEstimate: 30_000,
      userConfirmationRequired: false,
    });
    expect(result.appliedRuleIds).toContain(
      "TAX-SOFTWARE-DIRECT-DEVELOPMENT",
    );
  });

  it("separates post-service bug fixes from improvements", () => {
    const repair = decideTaxCandidate({
      amountJpy: 12_000,
      businessUse: "business",
      workPurpose: "bug-fix",
      placedInService: "after",
      userConfirmed: true,
    });
    const improvement = decideTaxCandidate({
      amountJpy: 12_000,
      businessUse: "business",
      workPurpose: "feature-improvement",
      placedInService: "after",
      userConfirmed: true,
    });

    expect(repair.candidate).toBe("ordinary-expense");
    expect(repair.currentYearExpenseEstimate).toBe(12_000);
    expect(improvement.candidate).toBe("capital-expenditure");
    expect(improvement.futureBalanceEstimate).toBeNull();
    expect(improvement.currentYearExpenseEstimate).toBeNull();
    expect(improvement.estimateStatus).toBe("not-calculated");
    expect(improvement.reasons.join(" ")).toContain("別");
  });

  it("treats prepaid timing as a separate candidate before purpose classification", () => {
    const result = decideTaxCandidate({
      amountJpy: 120_000,
      businessUse: "business",
      workPurpose: "ordinary-operation",
      placedInService: "after",
      serviceProvidedInCurrentPeriod: false,
      userConfirmed: true,
    });

    expect(result.candidate).toBe("prepaid-expense");
    expect(result.appliedRuleIds).toContain("TAX-TIMING-PREPAID");
    expect(result.futureBalanceEstimate).toBe(120_000);
  });

  it("classifies sales work in progress as production cost", () => {
    const result = decideTaxCandidate({
      amountJpy: 50_000,
      businessUse: "business",
      workPurpose: "sales-production",
      placedInService: "before",
      revenueModel: "digital-content-sale",
      workInProgressAtPeriodEnd: true,
      userConfirmed: true,
    });

    expect(result.candidate).toBe("production-cost");
    expect(result.futureBalanceEstimate).toBe(50_000);
  });

  it("does not silently assert that general learning is deductible", () => {
    const result = decideTaxCandidate({
      amountJpy: 8_000,
      businessUse: "unknown",
      workPurpose: "general-learning",
      placedInService: "unknown",
    });

    expect(result.candidate).toBe("private-use");
    expect(result.userConfirmationRequired).toBe(true);
    expect(result.currentYearExpenseEstimate).toBe(0);
  });

  it("reports missing facts and low confidence for an unknown activity", () => {
    const result = decideTaxCandidate({
      amountJpy: 8_000,
      businessUse: "unknown",
      workPurpose: "unknown",
      placedInService: "unknown",
    });

    expect(result.candidate).toBe("unclassified");
    expect(result.confidence).toBe("low");
    expect(result.missingFacts).toEqual(
      expect.arrayContaining([
        "業務利用と私用の合理的な按分率",
        "実際の供用開始状況",
        "作業目的（保守、新規開発、機能向上等）",
      ]),
    );
  });

  it("only estimates the business portion of mixed use", () => {
    const result = decideTaxCandidate({
      amountJpy: 10_000,
      businessUse: "mixed",
      privateUseRatio: 0.2,
      workPurpose: "maintenance",
      placedInService: "after",
      userConfirmed: true,
    });

    expect(result.candidate).toBe("ordinary-expense");
    expect(result.currentYearExpenseEstimate).toBe(8_000);
    expect(result.confidence).toBe("medium");
  });

  it("does not capitalize pre-service work without direct attribution", () => {
    const result = decideTaxCandidate({
      amountJpy: 30_000,
      businessUse: "business",
      workPurpose: "new-development",
      placedInService: "before",
      directlyAttributable: false,
      userConfirmed: true,
    });

    expect(result.candidate).toBe("unclassified");
    expect(result.futureBalanceEstimate).toBe(0);
    expect(result.missingFacts).toContain("共通費として合理的・継続的に配賦できるか");
  });
});
