import { describe, expect, it } from "vitest";

import { isResearchCohortApplicationsEnabled } from "@/lib/researchCohortAvailability";

describe("research cohort application availability", () => {
  it("fails closed in production until explicitly enabled", () => {
    expect(isResearchCohortApplicationsEnabled({ NODE_ENV: "production" })).toBe(false);
    expect(isResearchCohortApplicationsEnabled({
      NODE_ENV: "production",
      RESEARCH_COHORT_APPLICATIONS_ENABLED: "TRUE",
    })).toBe(false);
    expect(isResearchCohortApplicationsEnabled({
      NODE_ENV: "production",
      RESEARCH_COHORT_APPLICATIONS_ENABLED: "true",
    })).toBe(true);
  });

  it("keeps local development available unless explicitly disabled", () => {
    expect(isResearchCohortApplicationsEnabled({ NODE_ENV: "development" })).toBe(true);
    expect(isResearchCohortApplicationsEnabled({
      NODE_ENV: "test",
      RESEARCH_COHORT_APPLICATIONS_ENABLED: "false",
    })).toBe(false);
  });
});
