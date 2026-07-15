import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { isResearchCohortApplicationsEnabled } from "@/lib/researchCohortAvailability";

describe("research cohort application availability", () => {
  it("always fails closed in production even when an environment flag is enabled", () => {
    expect(isResearchCohortApplicationsEnabled({ NODE_ENV: "production" })).toBe(false);
    expect(isResearchCohortApplicationsEnabled({
      NODE_ENV: "production",
      RESEARCH_COHORT_APPLICATIONS_ENABLED: "TRUE",
    })).toBe(false);
    expect(isResearchCohortApplicationsEnabled({
      NODE_ENV: "production",
      RESEARCH_COHORT_APPLICATIONS_ENABLED: "true",
    })).toBe(false);
  });

  it("keeps local development available unless explicitly disabled", () => {
    expect(isResearchCohortApplicationsEnabled({ NODE_ENV: "development" })).toBe(true);
    expect(isResearchCohortApplicationsEnabled({
      NODE_ENV: "test",
      RESEARCH_COHORT_APPLICATIONS_ENABLED: "false",
    })).toBe(false);
  });

  it("does not describe the closed production intake as a current collection purpose", () => {
    const privacy = readFileSync(
      resolve(process.cwd(), "src/app/privacy/page.tsx"),
      "utf8",
    );

    expect(privacy).toContain("실제 이용자의 이메일·역할·이름·예식일·메시지·동의 기록·유입 정보를 새로 수집하지 않습니다");
    expect(privacy).not.toContain("사용자 연구 신청 시: 이메일");
    expect(privacy).not.toContain("사용자 연구 신청 접수, 참여 검토와 결과 안내");
  });
});
