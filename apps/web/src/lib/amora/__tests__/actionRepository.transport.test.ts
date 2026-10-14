import { describe, expect, it } from "vitest";
import { getManualAmoraActionFailure } from "../actionRepository";

describe("manual action transport failures", () => {
  it("maps the non-retrying PT409 database conflict to the existing safe 409 contract", () => {
    expect(getManualAmoraActionFailure({ code: "PT409", message: "AMORA_ACTION_CONFLICT", details: "private SQL" }))
      .toEqual(getManualAmoraActionFailure({ code: "40001", message: "AMORA_ACTION_CONFLICT" }));
    expect(getManualAmoraActionFailure({ code: "PT409" })).toMatchObject({ status: 409, code: "AMORA_ACTION_CONFLICT" });
  });

  it.each([
    ["42501", 403, "AMORA_ACTION_SCOPE_DENIED"],
    ["22023", 400, "AMORA_ACTION_INVALID_INPUT"],
    ["55000", 503, "AMORA_ACTION_UNAVAILABLE"],
    ["55P03", 503, "AMORA_ACTION_UNAVAILABLE"],
    ["57014", 503, "AMORA_ACTION_UNAVAILABLE"],
    ["PGRST202", 503, "AMORA_ACTION_UNAVAILABLE"],
  ])("preserves %s without leaking database details", (code, status, publicCode) => {
    const response = getManualAmoraActionFailure({ code, message: "private function", details: "private SQL" });
    expect(response).toMatchObject({ status, code: publicCode });
    expect(JSON.stringify(response)).not.toContain("private");
  });

  it.each([null, {}, { code: "PT503" }, { code: "23514" }, { code: ["PT409"] }])("does not invent a conflict from unknown failures", error => {
    expect(getManualAmoraActionFailure(error)).toBeNull();
  });
});
