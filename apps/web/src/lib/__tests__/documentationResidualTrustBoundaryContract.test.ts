import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(process.cwd(), "../..");
const read = (path: string) => readFileSync(resolve(repoRoot, path), "utf8");

const retiredDocuments = [
  "AUDIT_2026-04-28.md",
  "FEATURE_AUDIT.md",
  "FEATURES.md",
  "UPDATE_LOG.md",
  "docs/DEMO_SCRIPT_90s.md",
  "docs/DISTRIBUTION_POSTS_READY_2026-06-12.md",
  "docs/DISTRIBUTION_TEST_KIT_2026-06-12.md",
  "docs/DOC_VS_CODE_AUDIT_2026-07-03.md",
  "docs/EONNI_OS_MASTERPLAN_2026-06-10.md",
  "docs/EVALUATION_FINAL_REPORT_2026-07-04.md",
  "docs/EVALUATION_PLAN_2026-07-03.md",
  "docs/HANBANG_POSITIONING_2026.md",
  "docs/KIN_ANSWER_BANK_2026-06-12.md",
  "docs/KNOWN_ISSUES_2026-06-10.md",
  "docs/MASTER_BLUEPRINT_2026-06-10.md",
  "docs/MOBILE_APP_MASTERPLAN_2026-06-30.md",
  "docs/MOMENT_CATALOG_2026-06-10.md",
  "docs/SECURITY_AUDIT_2.1_ADMIN_AUTH_2026-07-03.md",
  "docs/SECURITY_AUDIT_2.2_MONEY_2026-07-03.md",
  "docs/SECURITY_AUDIT_2.3_AI_2026-07-03.md",
  "docs/SECURITY_AUDIT_2.4_REST_2026-07-03.md",
  "docs/SECURITY_AUDIT_2.5_RLS_2026-07-03.md",
  "docs/TEAM_HANDOFF_2026-06-15_AMORA_BOOKING_SECURITY.md",
  "docs/codex-tasks/DAILY_SUMMARY_2026-07-02.md",
  "docs/codex-tasks/SESSION_HANDOFF_2026-06-30.md",
  "docs/codex-tasks/SESSION_HANDOFF_2026-07-01.md",
  "docs/codex-tasks/SESSION_HANDOFF_2026-07-01_MOBILE_EXPO_QA.md",
  "docs/codex-tasks/SESSION_HANDOFF_2026-07-02.md",
] as const;

describe("residual documentation trust boundary", () => {
  it.each(retiredDocuments)(
    "%s is visibly retired and points to every current source of truth",
    (path) => {
      const document = read(path);

      expect(document).toContain("폐기된 역사 문서");
      expect(document).toContain(
        "현재 구현·로드맵·마케팅·세일즈 근거로 사용 금지",
      );
      expect(document).toContain("WEDDINGHANBANG_SERVICE_DOC.md");
      expect(document).toContain("PROJECT_STATUS.md");
      expect(document).toContain("CONSUMER_NEEDS_PRODUCT_DESIGN_2026.md");
    },
  );

  it("does not describe the disabled vendor catalog as a current organizing surface", () => {
    const serviceDocument = read("WEDDINGHANBANG_SERVICE_DOC.md");

    expect(serviceDocument).toContain(
      "준비 현황, 예산, 일정과 커플 기록을 한곳에서 정리",
    );
    expect(serviceDocument).not.toContain(
      "준비 현황, 예산, 일정, 업체 정보와 커플 기록을 한곳에서 정리",
    );
  });

  it("does not let agent guidance revive the retired mobile masterplan", () => {
    const agentGuidance = read("AGENTS.md");

    expect(agentGuidance).toContain(
      "MOBILE_APP_MASTERPLAN_2026-06-30.md as retired historical context only",
    );
    expect(agentGuidance).toContain("WEDDINGHANBANG_SERVICE_DOC.md");
    expect(agentGuidance).toContain("PROJECT_STATUS.md");
    expect(agentGuidance).toContain("CONSUMER_NEEDS_PRODUCT_DESIGN_2026.md");
  });
});
