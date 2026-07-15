import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const betaForm = readFileSync(join(process.cwd(), "src/app/beta/BetaForm.tsx"), "utf8");
const betaPage = readFileSync(join(process.cwd(), "src/app/beta/page.tsx"), "utf8");
const aboutPage = readFileSync(join(process.cwd(), "src/app/about/page.tsx"), "utf8");
const aboutResearchCta = readFileSync(
  join(process.cwd(), "src/components/landing/ForBetaCouples.tsx"),
  "utf8"
);
const preregisterRoute = readFileSync(
  join(process.cwd(), "src/app/api/preregister/route.ts"),
  "utf8"
);
const betaCount = readFileSync(
  join(process.cwd(), "src/lib/beta-count.ts"),
  "utf8"
);
const receiptEmail = readFileSync(join(process.cwd(), "src/lib/resend.ts"), "utf8");
const adminRegistrations = readFileSync(
  join(process.cwd(), "src/app/api/admin/registrations/route.ts"),
  "utf8"
);
const retentionMigration = readFileSync(
  join(process.cwd(), "../../supabase/migrations/20260711135000_preregistration_consent_retention.sql"),
  "utf8"
);
const deterministicRetentionMigration = readFileSync(
  join(process.cwd(), "../../supabase/migrations/20260711141000_deterministic_application_survey_retention.sql"),
  "utf8"
);
const cohortIdentityMigration = readFileSync(
  join(process.cwd(), "../../supabase/migrations/20260712100000_research_cohort_application_identity.sql"),
  "utf8"
);
const cohortConsentVersionMigration = readFileSync(
  join(process.cwd(), "../../supabase/migrations/20260713120000_research_cohort_consent_version.sql"),
  "utf8"
);

describe("beta application privacy contract", () => {
  it("keeps production intake closed until a separate server gate is approved", () => {
    expect(betaPage).toContain("isResearchCohortApplicationsEnabled()");
    expect(betaPage).toContain("applicationsEnabled ? await getBetaCount() : 0");
    expect(betaForm).toContain("if (!applicationsEnabled)");
    expect(betaForm).toContain("준비가 끝나기 전에는 개인정보를 받지 않습니다");
    expect(preregisterRoute).toContain("isResearchCohortApplicationsEnabled()");
    expect(preregisterRoute).toContain('const PRIVACY_POLICY_VERSION = "2026-07-14"');
    expect(aboutPage).toContain("isResearchCohortApplicationsEnabled()");
    expect(aboutPage).toContain("applicationsEnabled ? await getBetaCount() : 0");
    expect(aboutResearchCta).toContain("applicationsEnabled");
    expect(aboutResearchCta).toContain("사용자 연구 신청 접수 준비 중");
  });

  it("keeps the optional counter from blocking the application page", () => {
    expect(betaCount).toContain("BETA_COUNT_TIMEOUT_MS = 2_000");
    expect(betaCount).toContain("AbortSignal.timeout(BETA_COUNT_TIMEOUT_MS)");
    expect(betaCount).toContain("global: { fetch: betaCountFetch }");
    expect(betaCount).toContain("return 0");
  });

  it("requires explicit consent and links the applicable privacy notice", () => {
    expect(betaForm).toContain('type="checkbox"');
    expect(betaForm).toContain("privacyConsent");
    expect(betaForm).toContain('href="/privacy"');
    expect(preregisterRoute).toContain("privacyConsent !== true");
  });

  it("records consent provenance and bounds application retention", () => {
    expect(preregisterRoute).toContain('const PRIVACY_POLICY_VERSION = "2026-07-14"');
    expect(preregisterRoute).toContain("const RETENTION_DAYS = 180");
    expect(retentionMigration).toContain("privacy_consent_at");
    expect(retentionMigration).toContain("expires_at");
    expect(deterministicRetentionMigration).toContain("cron.schedule");
    expect(deterministicRetentionMigration).toContain("q23_contact = NULL");
    expect(deterministicRetentionMigration).toContain(
      "ALTER COLUMN expires_at SET NOT NULL"
    );
    expect(deterministicRetentionMigration).toContain(
      "preregistrations_retention_cap"
    );
    expect(deterministicRetentionMigration).toContain(
      "customer_survey_responses_retention_cap"
    );
    expect(deterministicRetentionMigration).toContain(
      "trg_clamp_preregistration_retention"
    );
  });

  it("does not reveal or overwrite an existing email application before verification", () => {
    expect(preregisterRoute).not.toContain("updated: true");
    expect(preregisterRoute).toContain("이메일 소유 확인 전에는");
    expect(preregisterRoute).toContain('insertError.code === "23505"');
    expect(preregisterRoute).toContain("RESEARCH_COHORT_EXPIRED_PURGE_FAILED");
    expect(preregisterRoute).toContain("{ status: 503 }");
  });

  it("accepts only the disclosed research cohort purpose and awaits its truthful receipt", () => {
    expect(preregisterRoute).toContain("isResearchCohortApplicationsEnabled()");
    expect(preregisterRoute).toContain("isBetaCandidate !== true");
    expect(preregisterRoute).toContain("6주 사용자 연구 코호트 신청만");
    expect(preregisterRoute).toContain('const COHORT_WEDDING_DATE_MIN = "2026-07-01"');
    expect(preregisterRoute).toContain('const COHORT_WEDDING_DATE_MAX = "2026-12-31"');
    expect(preregisterRoute).toContain("await sendResearchCohortReceiptEmail(");
    expect(preregisterRoute).toContain("inserted.id");
    expect(preregisterRoute).toContain("RESEARCH_COHORT_RECEIPT_EMAIL_PENDING");
    expect(preregisterRoute).toContain("receipt_email_status");
    expect(preregisterRoute).toContain("RESEARCH_COHORT_RECEIPT_STATUS_UPDATE_FAILED");
    expect(preregisterRoute).not.toContain("void sendPreregistrationEmail");
    expect(receiptEmail).toContain("이 메일은 선정 또는 정식 베타 초대를 의미하지 않습니다");
    expect(receiptEmail).not.toContain("특별 할인 혜택");
  });

  it("keeps legacy signups separate and counts only active consented applications", () => {
    expect(preregisterRoute).toContain("USER_RESEARCH_COHORT_CODE");
    expect(preregisterRoute).toContain('.from("research_cohort_applications")');
    expect(preregisterRoute).toContain('.eq("cohort_code", USER_RESEARCH_COHORT_CODE)');
    expect(betaCount).toContain('.from("research_cohort_applications")');
    expect(betaCount).toContain('.eq("cohort_code", USER_RESEARCH_COHORT_CODE)');
    expect(betaCount).toContain('.not("privacy_consent_at", "is", null)');
    expect(betaCount).toContain('.not("email_verified_at", "is", null)');
    expect(betaCount).toContain('.gt("expires_at", new Date().toISOString())');
    expect(cohortIdentityMigration).toContain("CREATE TABLE public.research_cohort_applications");
    expect(cohortIdentityMigration).toContain("UNIQUE (cohort_code, email)");
    expect(cohortIdentityMigration).toContain("research-2026-h2");
    expect(cohortIdentityMigration).toContain("email = lower(btrim(email))");
    expect(cohortIdentityMigration).toContain("privacy_consent_at = created_at");
    expect(cohortIdentityMigration).toContain("privacy_policy_version = '2026-07-12'");
    expect(cohortConsentVersionMigration).toContain(
      "privacy_policy_version IN ('2026-07-12', '2026-07-14')"
    );
    expect(cohortConsentVersionMigration).toContain(
      "research_cohort_applications_privacy_policy_check"
    );
    expect(cohortIdentityMigration).toContain("wedding_date date");
    expect(cohortIdentityMigration).toContain(
      "wedding_date BETWEEN DATE '2026-07-01' AND DATE '2026-12-31'"
    );
    expect(cohortIdentityMigration).not.toContain("DROP CONSTRAINT IF EXISTS preregistrations_email_key");
    expect(cohortIdentityMigration).toContain("DELETE FROM public.research_cohort_applications");
    expect(adminRegistrations).toContain('.from("research_cohort_applications")');
    expect(adminRegistrations).toContain('.eq("cohort_code", USER_RESEARCH_COHORT_CODE)');
  });
});
