import { describe, expect, it } from "vitest";

import { guideAssetThresholds } from "../../src/core/index.js";

const basicProfile = {
  placedInService: true,
  filingType: "white" as const,
  incomeCategory: "miscellaneous" as const,
  eligibleSmallBusiness: false,
};

describe("new depreciable asset thresholds", () => {
  it.each([
    [99_999, "under-100k", ["immediate-expense"]],
    [
      100_000,
      "100k-to-under-200k",
      ["ordinary-depreciation", "three-year-pool"],
    ],
    [
      199_999,
      "100k-to-under-200k",
      ["ordinary-depreciation", "three-year-pool"],
    ],
    [200_000, "200k-to-under-400k", ["ordinary-depreciation"]],
    [400_000, "400k-and-over", ["ordinary-depreciation"]],
  ] as const)("handles exact boundary %i", (cost, band, options) => {
    const result = guideAssetThresholds({
      ...basicProfile,
      acquisitionCostJpy: cost,
      acquisitionOrProductionDate: "2026-07-01",
      placedInServiceDate: "2026-07-01",
    });

    expect(result.band).toBe(band);
    expect(result.options).toEqual(options);
    expect(result.specialExpensingAvailable).toBe(false);
  });

  it("does not start depreciation before actual service", () => {
    const result = guideAssetThresholds({
      ...basicProfile,
      acquisitionCostJpy: 80_000,
      placedInService: false,
    });

    expect(result.options).toEqual(["not-yet-depreciable"]);
    expect(result.appliedRuleIds).toContain("ASSET-NOT-PLACED-IN-SERVICE");
  });

  it("shows the 400k blue-return special rule after 2026-04-01", () => {
    const result = guideAssetThresholds({
      acquisitionCostJpy: 399_999,
      placedInService: true,
      acquisitionOrProductionDate: "2026-04-01",
      placedInServiceDate: "2026-04-01",
      filingType: "blue",
      incomeCategory: "business",
      eligibleSmallBusiness: true,
      annualSpecialDeductionUsedJpy: 0,
    });

    expect(result.specialExpensingLimitJpy).toBe(400_000);
    expect(result.specialExpensingAvailable).toBe(true);
    expect(result.options).toContain("blue-return-special-expensing");
  });

  it("uses the pre-change 300k special threshold through 2026-03-31", () => {
    const result = guideAssetThresholds({
      acquisitionCostJpy: 299_999,
      placedInService: true,
      acquisitionOrProductionDate: "2026-03-31",
      placedInServiceDate: "2026-03-31",
      filingType: "blue",
      incomeCategory: "business",
      eligibleSmallBusiness: true,
    });

    expect(result.specialExpensingLimitJpy).toBe(300_000);
    expect(result.specialExpensingAvailable).toBe(true);
  });

  it("treats 400k exactly as outside the under-400k special rule", () => {
    const result = guideAssetThresholds({
      acquisitionCostJpy: 400_000,
      placedInService: true,
      acquisitionOrProductionDate: "2026-04-01",
      placedInServiceDate: "2026-04-01",
      filingType: "blue",
      incomeCategory: "business",
      eligibleSmallBusiness: true,
    });

    expect(result.specialExpensingAvailable).toBe(false);
    expect(result.messages.join(" ")).toContain("ちょうど");
  });

  it("does not apply the blue-return rule to miscellaneous income", () => {
    const result = guideAssetThresholds({
      acquisitionCostJpy: 300_000,
      placedInService: true,
      acquisitionOrProductionDate: "2026-07-01",
      placedInServiceDate: "2026-07-01",
      filingType: "blue",
      incomeCategory: "miscellaneous",
      eligibleSmallBusiness: true,
    });

    expect(result.specialExpensingAvailable).toBe(false);
    expect(result.options).not.toContain("blue-return-special-expensing");
  });

  it("checks the 3m annual special-expensing cap", () => {
    const result = guideAssetThresholds({
      acquisitionCostJpy: 200_000,
      placedInService: true,
      acquisitionOrProductionDate: "2026-07-01",
      placedInServiceDate: "2026-07-01",
      filingType: "blue",
      incomeCategory: "business",
      eligibleSmallBusiness: true,
      annualSpecialDeductionUsedJpy: 2_900_000,
    });

    expect(result.specialExpensingAvailable).toBe(false);
    expect(result.messages.join(" ")).toContain("300万円");
  });

  it("does not extend the registered special rule past 2029-03-31", () => {
    const result = guideAssetThresholds({
      acquisitionCostJpy: 300_000,
      placedInService: true,
      acquisitionOrProductionDate: "2029-04-01",
      placedInServiceDate: "2029-04-01",
      filingType: "blue",
      incomeCategory: "business",
      eligibleSmallBusiness: true,
    });

    expect(result.specialExpensingAvailable).toBe(false);
    expect(result.specialExpensingLimitJpy).toBeUndefined();
    expect(result.appliedRuleIds).toContain("BLUE-SPECIAL-RULE-EXPIRED");
  });

  it("does not add the blue-return special treatment below 100k", () => {
    const result = guideAssetThresholds({
      acquisitionCostJpy: 99_999,
      placedInService: true,
      acquisitionOrProductionDate: "2026-07-01",
      placedInServiceDate: "2026-07-02",
      filingType: "blue",
      incomeCategory: "business",
      eligibleSmallBusiness: true,
    });

    expect(result.options).toEqual(["immediate-expense"]);
    expect(result.specialExpensingAvailable).toBe(false);
  });

  it("uses acquisition date for the 30-to-40 change, not service date", () => {
    const result = guideAssetThresholds({
      acquisitionCostJpy: 350_000,
      placedInService: true,
      acquisitionOrProductionDate: "2026-03-31",
      placedInServiceDate: "2026-04-10",
      filingType: "blue",
      incomeCategory: "business",
      eligibleSmallBusiness: true,
    });

    expect(result.specialExpensingLimitJpy).toBe(300_000);
    expect(result.specialExpensingAvailable).toBe(false);
  });

  it("prorates the 3m cap for a partial business year", () => {
    const result = guideAssetThresholds({
      acquisitionCostJpy: 300_000,
      placedInService: true,
      acquisitionOrProductionDate: "2026-07-01",
      placedInServiceDate: "2026-07-02",
      filingType: "blue",
      incomeCategory: "business",
      eligibleSmallBusiness: true,
      businessActiveMonths: 6,
      annualSpecialDeductionUsedJpy: 1_300_000,
    });

    expect(result.specialAnnualCapJpy).toBe(1_500_000);
    expect(result.specialExpensingAvailable).toBe(false);
  });
});
