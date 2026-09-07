import { describe, expect, it } from "vitest";
import { executeSimulateGuestGuarantee } from "../riskSupportTools";

describe("riskSupportTools", () => {
  it("calculates the supplied headcount and meal price without inventing a minimum or no-show rate", () => {
    const result = executeSimulateGuestGuarantee({ estimated_guests: 150, meal_price: 8 });
    expect(result.toolOutput).toMatchObject({ mode: "input_needed", guaranteedGuests: null, noShowRatePercent: null, expectedMealTotalManwon: null });
    expect(result.displayMessage).toContain("1,200만원");
    expect(result.displayMessage).toContain("최종 정산액");
    expect(result.toolOutput.recommendation).not.toContain("예상 하객 수");
    expect(result.toolOutput.recommendation).not.toContain("한 사람당 식사비");
  });

  it.each([null, "", false])("does not treat an absent or invalid no-show value %s as zero", (rate) => {
    const result = executeSimulateGuestGuarantee({ estimated_guests: 150, guaranteed_guests: 150, meal_price: 8, no_show_rate_percent: rate });
    expect(result.toolOutput).toMatchObject({ mode: "input_needed", noShowRatePercent: null });
  });

  it.each([8.7555, 87555])("keeps the supplied %s meal price precise to one won", (price) => {
    const result = executeSimulateGuestGuarantee({ estimated_guests: 150, guaranteed_guests: 150, meal_price: price, no_show_rate_percent: 0 });
    expect(result.toolOutput).toMatchObject({ mealPriceManwon: 8.7555, expectedMealTotalManwon: 1313.325 });
  });

  it("allows an explicitly supplied 100 percent no-show scenario to contain zero attendees", () => {
    const result = executeSimulateGuestGuarantee({ estimated_guests: 150, guaranteed_guests: 150, meal_price: 8, no_show_rate_percent: 100 });
    expect(result.toolOutput).toMatchObject({ expectedAttendanceGuests: 0, payableGuests: 150, emptySeats: 150, expectedMealTotalManwon: 1200 });
  });

  it("asks for an explicit no-show scenario instead of applying a hidden default", () => {
    const result = executeSimulateGuestGuarantee({
      estimated_guests: 180,
      guaranteed_guests: 200,
      meal_price: 75000,
      confirmed_rsvp_guests: 170,
    });

    expect(result.toolName).toBe("simulate_guest_guarantee");
    expect(result.toolInput).toMatchObject({ estimated_guests: 180 });
    expect(result.success).toBe(true);
    expect(result.displayMessage).toBeTruthy();
    expect(result.toolOutput).toMatchObject({
      mode: "input_needed",
      estimatedGuests: 180,
      guaranteedGuests: 200,
      noShowRatePercent: null,
      missingFields: ["noShowRatePercent"],
    });
  });

  it("calculates only with the user's explicit no-show scenario", () => {
    const result = executeSimulateGuestGuarantee({
      estimated_guests: 180,
      guaranteed_guests: 200,
      meal_price: 75000,
      no_show_rate_percent: 5,
    });

    expect(result.toolOutput).toMatchObject({
      mode: "analysis",
      noShowRatePercent: 5,
      expectedAttendanceGuests: 171,
    });
  });
});
