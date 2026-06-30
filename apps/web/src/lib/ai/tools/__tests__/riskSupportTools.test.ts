import { describe, expect, it } from "vitest";
import {
  executeAnalyzeContractReadiness,
  executeSimulateGuestGuarantee,
} from "../riskSupportTools";

describe("riskSupportTools", () => {
  it("keeps contract readiness tool output shape", () => {
    const result = executeAnalyzeContractReadiness({
      category: "venue",
      vendor_name: "테스트홀",
      contract_amount: 3000,
      has_written_contract: true,
      included_items: ["대관료", "식대"],
      evidence_types: ["quote", "message_capture", "unknown"],
    });

    expect(result.toolName).toBe("analyze_contract_readiness");
    expect(result.toolInput).toMatchObject({ category: "venue" });
    expect(result.success).toBe(true);
    expect(result.displayMessage).toBeTruthy();
    expect(result.toolOutput).toMatchObject({
      category: "venue",
    });
  });

  it("keeps guest guarantee simulator output shape", () => {
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
      estimatedGuests: 180,
      guaranteedGuests: 200,
    });
  });
});
