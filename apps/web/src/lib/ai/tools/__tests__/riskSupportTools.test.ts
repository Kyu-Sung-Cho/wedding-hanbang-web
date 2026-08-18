import { describe, expect, it } from "vitest";
import { executeSimulateGuestGuarantee } from "../riskSupportTools";

describe("riskSupportTools", () => {
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
