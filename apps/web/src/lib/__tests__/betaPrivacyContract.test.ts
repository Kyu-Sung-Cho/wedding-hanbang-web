import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const betaForm = readFileSync(join(process.cwd(), "src/app/beta/BetaForm.tsx"), "utf8");
const preregisterRoute = readFileSync(
  join(process.cwd(), "src/app/api/preregister/route.ts"),
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

describe("beta application privacy contract", () => {
  it("requires explicit consent and links the applicable privacy notice", () => {
    expect(betaForm).toContain('type="checkbox"');
    expect(betaForm).toContain("privacyConsent");
    expect(betaForm).toContain('href="/privacy"');
    expect(preregisterRoute).toContain("privacyConsent !== true");
  });

  it("records consent provenance and bounds application retention", () => {
    expect(preregisterRoute).toContain('const PRIVACY_POLICY_VERSION = "2026-07-11"');
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
    expect(preregisterRoute).toContain("expired preregistration purge failed:");
    expect(preregisterRoute).toContain("{ status: 503 }");
  });
});
