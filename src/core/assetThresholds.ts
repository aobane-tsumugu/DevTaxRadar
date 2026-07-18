import type {
  AssetThresholdGuidance,
  AssetThresholdInput,
  AssetTreatmentOption,
  AcquisitionCostBand,
} from "./types.js";

const SPECIAL_ANNUAL_CAP_JPY = 3_000_000;
const SPECIAL_CHANGE_DATE = "2026-04-01";
const SPECIAL_END_DATE = "2029-03-31";

function validIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
}

function getBand(cost: number): AcquisitionCostBand {
  if (cost < 100_000) return "under-100k";
  if (cost < 200_000) return "100k-to-under-200k";
  if (cost < 400_000) return "200k-to-under-400k";
  return "400k-and-over";
}

function baseOptions(cost: number): AssetTreatmentOption[] {
  if (cost < 100_000) return ["immediate-expense"];
  if (cost < 200_000) return ["ordinary-depreciation", "three-year-pool"];
  return ["ordinary-depreciation"];
}

export function guideAssetThresholds(
  input: AssetThresholdInput,
): AssetThresholdGuidance {
  const cost = input.acquisitionCostJpy;
  if (!Number.isInteger(cost) || cost < 0) {
    throw new RangeError("acquisition cost must be a non-negative integer yen amount");
  }
  if (
    input.annualSpecialDeductionUsedJpy !== undefined &&
    (!Number.isInteger(input.annualSpecialDeductionUsedJpy) ||
      input.annualSpecialDeductionUsedJpy < 0)
  ) {
    throw new RangeError(
      "annual special deduction used must be a non-negative integer yen amount",
    );
  }

  const band = getBand(cost);
  const options: AssetTreatmentOption[] = input.placedInService
    ? baseOptions(cost)
    : ["not-yet-depreciable"];
  const messages: string[] = [];
  const missingFacts: string[] = [];
  const appliedRuleIds: string[] = [];

  if (!input.placedInService) {
    appliedRuleIds.push("ASSET-NOT-PLACED-IN-SERVICE");
    messages.push("未供用のため、少額資産処理や減価償却の開始前です。");
  } else if (band === "under-100k") {
    appliedRuleIds.push("ASSET-UNDER-100K");
    messages.push("10万円未満は、供用した年の全額必要経費候補です。");
  } else if (band === "100k-to-under-200k") {
    appliedRuleIds.push("ASSET-100K-UNDER-200K");
    messages.push(
      "10万円以上20万円未満は、通常償却または3年間の一括償却候補です。",
    );
  } else {
    appliedRuleIds.push("ASSET-200K-OR-MORE");
    messages.push("20万円以上は、基本線として通常の減価償却候補です。");
  }

  if (cost === 100_000) {
    messages.push("100,000円ちょうどは「10万円未満」ではありません。");
  }
  if (cost === 200_000) {
    messages.push("200,000円ちょうどは「20万円未満」ではありません。");
  }
  messages.push(
    "この20万円境界は新規減価償却資産の基準です。修繕・改良計画の形式基準とは別です。",
  );

  let specialExpensingLimitJpy: number | undefined;
  if (input.acquisitionOrProductionDate !== undefined) {
    if (!validIsoDate(input.acquisitionOrProductionDate)) {
      throw new RangeError("acquisition or production date must be a valid YYYY-MM-DD date");
    }
    if (input.acquisitionOrProductionDate <= SPECIAL_END_DATE) {
      specialExpensingLimitJpy =
        input.acquisitionOrProductionDate >= SPECIAL_CHANGE_DATE ? 400_000 : 300_000;
      appliedRuleIds.push(
        specialExpensingLimitJpy === 400_000
          ? "BLUE-SPECIAL-UNDER-400K-2026-04-01-TO-2029-03-31"
          : "BLUE-SPECIAL-UNDER-300K-THROUGH-2026-03-31",
      );
    } else {
      appliedRuleIds.push("BLUE-SPECIAL-RULE-EXPIRED");
      messages.push(
        "現在登録されている青色申告者向け特例ルールの適用期限後です。最新制度を確認してください。",
      );
    }
  } else if (input.placedInService) {
    missingFacts.push("取得・製作日");
  }

  if (input.placedInService && input.placedInServiceDate === undefined) {
    missingFacts.push("供用開始日");
  } else if (
    input.placedInServiceDate !== undefined &&
    !validIsoDate(input.placedInServiceDate)
  ) {
    throw new RangeError("placed in service date must be a valid YYYY-MM-DD date");
  }

  if (input.filingType === "unknown") missingFacts.push("青色・白色申告の別");
  if (input.incomeCategory === "unknown") missingFacts.push("所得区分");
  if (input.eligibleSmallBusiness === undefined) {
    missingFacts.push("少額減価償却資産特例の事業者要件");
  }

  const allowedIncome =
    input.incomeCategory === "business" ||
    input.incomeCategory === "real-estate" ||
    input.incomeCategory === "forestry";
  const used = input.annualSpecialDeductionUsedJpy ?? 0;
  const businessActiveMonths = input.businessActiveMonths ?? 12;
  if (!Number.isInteger(businessActiveMonths) || businessActiveMonths < 1 || businessActiveMonths > 12) {
    throw new RangeError("business active months must be an integer from 1 to 12");
  }
  const specialAnnualCapJpy = Math.floor(
    SPECIAL_ANNUAL_CAP_JPY * businessActiveMonths / 12,
  );
  const specialAnnualCapLabel = `${specialAnnualCapJpy / 10_000}万円（${specialAnnualCapJpy.toLocaleString("ja-JP")}円）`;
  const annualCapAvailable = used + cost <= specialAnnualCapJpy;
  const rentalEligible =
    input.rentedAsset !== true || input.rentalIsPrimaryBusiness === true;
  const treatmentChoiceAvailable = input.selectedThreeYearPool !== true;
  const specialExpensingAvailable =
    input.placedInService &&
    cost >= 100_000 &&
    input.filingType === "blue" &&
    allowedIncome &&
    input.eligibleSmallBusiness === true &&
    specialExpensingLimitJpy !== undefined &&
    cost < specialExpensingLimitJpy &&
    annualCapAvailable &&
    rentalEligible &&
    treatmentChoiceAvailable;

  if (specialExpensingAvailable) {
    options.push("blue-return-special-expensing");
    messages.push(
      `10万円以上${specialExpensingLimitJpy?.toLocaleString("ja-JP")}円未満の青色申告者向け特例候補です。年の事業月数に応じた合計上限${specialAnnualCapLabel}も確認してください。`,
    );
    if (input.specialStatementReady !== true) {
      missingFacts.push("特例対象額を記載した明細・決算書等");
    }
  } else if (
    input.placedInService &&
    input.filingType === "blue" &&
    specialExpensingLimitJpy !== undefined &&
    cost === specialExpensingLimitJpy
  ) {
    messages.push(
      `${specialExpensingLimitJpy.toLocaleString("ja-JP")}円ちょうどは特例の「未満」に該当しません。`,
    );
  }

  if (!annualCapAvailable) {
    messages.push(
      `特例対象の年間取得価額合計上限${specialAnnualCapLabel}を超えます。`,
    );
  }
  if (!rentalEligible) {
    messages.push("貸付用資産は、主要な事業として行う貸付け等を除き特例対象外です。");
  }
  if (!treatmentChoiceAvailable) {
    messages.push("一括償却資産として選択した資産へ同じ特例を重複適用できません。");
  }
  if (
    input.incomeCategory === "miscellaneous" ||
    input.filingType === "white"
  ) {
    messages.push("雑所得または白色申告へ青色申告者向け特例を自動適用しません。");
  }

  return {
    acquisitionCostJpy: cost,
    band,
    options,
    specialExpensingLimitJpy,
    specialAnnualCapJpy,
    specialExpensingAvailable,
    appliedRuleIds,
    messages,
    missingFacts: [...new Set(missingFacts)],
    userConfirmationRequired:
      missingFacts.length > 0 || specialExpensingAvailable,
  };
}
