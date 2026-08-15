import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  buildMediationFollowUpSafetyMarker,
  readClearMediationFollowUpSafetyMarker,
} from "@/lib/care/mediationFollowUpSafety";

describe("mediation follow-up safety evidence", () => {
  it("creates an explicit bounded clear marker only after a safe structured card exists", () => {
    const marker = buildMediationFollowUpSafetyMarker({
      requestKind: "mediation",
      questionScope: "W1_wedding_adjacent",
      hasScreenedMediationCard: true,
    });
    expect(marker).toEqual({
      version: 1,
      violence: false,
      coercion: false,
      privateSafetyHold: false,
      contextComplete: true,
    });
    expect(readClearMediationFollowUpSafetyMarker(marker)).toEqual(marker);

    for (const unsafe of [
      { ...marker!, violence: true },
      { ...marker!, coercion: true },
      { ...marker!, privateSafetyHold: true },
      { ...marker!, contextComplete: false },
      { ...marker!, rawText: "must not be accepted" },
      null,
    ]) {
      expect(readClearMediationFollowUpSafetyMarker(unsafe)).toBeNull();
    }
  });

  it("persists only the fixed marker beside a successfully screened mediation card", () => {
    const route = readFileSync(
      resolve(process.cwd(), "src/app/api/chat/route.ts"),
      "utf8",
    );
    expect(route).toMatch(/buildMediationFollowUpSafetyMarker\(\{/u);
    expect(route).toMatch(/hasScreenedMediationCard:\s*mediation !== null/u);
    expect(route).toMatch(/mediation_follow_up_safety:\s*mediationFollowUpSafetyMarker/u);
  });
});
