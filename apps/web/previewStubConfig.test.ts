import { describe, expect, it } from "vitest";

import { assertPreviewStubDeployment } from "./previewStubConfig";

const STAGING_REF = "abcdefghijklmnopqrst";
const PRODUCTION_REF = "slrtobkksjmxgzatjyqb";
const COMMIT_SHA = "a".repeat(40);
const STAGING_OPENAI_PROJECT = "proj_staging_security_1234";
const PRODUCTION_OPENAI_PROJECT = "proj_production_5678";

function targetedPreview(overrides: Record<string, string | undefined> = {}) {
  return {
    VERCEL_ENV: "preview",
    VERCEL_URL: "wedding-security-preview.vercel.app",
    VERCEL_GIT_COMMIT_REF: "security-review",
    VERCEL_GIT_COMMIT_SHA: COMMIT_SHA,
    NEXT_PUBLIC_PREVIEW_STUB_MODE: "false",
    NEXT_PUBLIC_SUPABASE_URL: `https://${STAGING_REF}.supabase.co`,
    SUPABASE_EXPECTED_URL: `https://${STAGING_REF}.supabase.co`,
    SUPABASE_EXPECTED_PROJECT_REF: STAGING_REF,
    SUPABASE_PRODUCTION_PROJECT_REF: PRODUCTION_REF,
    TARGETED_PREVIEW_BRANCH: "security-review",
    TARGETED_PREVIEW_CONFIRM: `TARGETED_PREVIEW:${STAGING_REF}:${COMMIT_SHA}`,
    ...overrides,
  };
}

describe("assertPreviewStubDeployment", () => {
  it("blocks a production build when preview stub mode is enabled", () => {
    expect(() =>
      assertPreviewStubDeployment({
        VERCEL_ENV: "production",
        NEXT_PUBLIC_PREVIEW_STUB_MODE: "true",
      })
    ).toThrow("NEXT_PUBLIC_PREVIEW_STUB_MODE must never be enabled in Production");
  });

  it("allows the explicit stub in Preview", () => {
    expect(() =>
      assertPreviewStubDeployment({
        VERCEL_ENV: "preview",
        NEXT_PUBLIC_PREVIEW_STUB_MODE: "true",
      })
    ).not.toThrow();
  });

  it.each([undefined, "false", "TRUE"])(
    "blocks an ordinary Preview when stub mode is %s",
    (stubMode) => {
      expect(() => assertPreviewStubDeployment({
        VERCEL_ENV: "preview",
        NEXT_PUBLIC_PREVIEW_STUB_MODE: stubMode,
      })).toThrow("Non-stub Preview requires a commit-bound, non-production targeted preview configuration");
    },
  );

  it("allows only an exact commit-bound targeted non-production Preview", () => {
    expect(() => assertPreviewStubDeployment(targetedPreview())).not.toThrow();
  });

  it("allows OpenAI only with a distinct project and commit-bound non-production attestation", () => {
    expect(() => assertPreviewStubDeployment(targetedPreview({
      OPENAI_API_KEY: "sk-preview-fixture",
      AMORA_OPENAI_ENABLED: "true",
      OPENAI_PROJECT_ID: STAGING_OPENAI_PROJECT,
      OPENAI_EXPECTED_PROJECT_ID: STAGING_OPENAI_PROJECT,
      OPENAI_PRODUCTION_PROJECT_ID: PRODUCTION_OPENAI_PROJECT,
      TARGETED_PREVIEW_OPENAI_CONFIRM:
        `TARGETED_OPENAI_NONPROD:${STAGING_OPENAI_PROJECT}:${COMMIT_SHA}`,
    }))).not.toThrow();
  });

  it.each([
    ["production destination", {
      NEXT_PUBLIC_SUPABASE_URL: `https://${PRODUCTION_REF}.supabase.co`,
      SUPABASE_EXPECTED_URL: `https://${PRODUCTION_REF}.supabase.co`,
      SUPABASE_EXPECTED_PROJECT_REF: PRODUCTION_REF,
      TARGETED_PREVIEW_CONFIRM: `TARGETED_PREVIEW:${PRODUCTION_REF}:${COMMIT_SHA}`,
    }],
    ["unbound commit", { VERCEL_GIT_COMMIT_SHA: "b".repeat(40) }],
    ["unbound branch", { VERCEL_GIT_COMMIT_REF: "another-branch" }],
    ["main branch", {
      VERCEL_GIT_COMMIT_REF: "main",
      TARGETED_PREVIEW_BRANCH: "main",
    }],
    ["non-Vercel host", { VERCEL_URL: "preview.example.com" }],
    ["production write confirmation", {
      SUPABASE_PRODUCTION_WRITE_CONFIRM: `RUNTIME_WRITE:${PRODUCTION_REF}`,
    }],
    ["spoofed production ref", { SUPABASE_PRODUCTION_PROJECT_REF: "zyxwvutsrqponmlkjihg" }],
    ["unattested OpenAI credential", { OPENAI_API_KEY: "sk-production-accidental" }],
    ["production OpenAI project", {
      OPENAI_API_KEY: "sk-production-accidental",
      AMORA_OPENAI_ENABLED: "true",
      OPENAI_PROJECT_ID: PRODUCTION_OPENAI_PROJECT,
      OPENAI_EXPECTED_PROJECT_ID: PRODUCTION_OPENAI_PROJECT,
      OPENAI_PRODUCTION_PROJECT_ID: PRODUCTION_OPENAI_PROJECT,
      TARGETED_PREVIEW_OPENAI_CONFIRM:
        `TARGETED_OPENAI_NONPROD:${PRODUCTION_OPENAI_PROJECT}:${COMMIT_SHA}`,
    }],
    ["production email provider credential", { RESEND_API_KEY: "re_production_accidental" }],
    ["custom OpenAI destination", { OPENAI_BASE_URL: "https://attacker.invalid/v1" }],
    ["custom OpenAI headers", {
      OPENAI_CUSTOM_HEADERS: `OpenAI-Project: ${PRODUCTION_OPENAI_PROJECT}`,
    }],
    ["ambient OpenAI admin key", { OPENAI_ADMIN_KEY: "sk-admin-production-accidental" }],
    ["ambient OpenAI organization", { OPENAI_ORG_ID: "org_production" }],
  ])("blocks targeted Preview with %s", (_label, overrides) => {
    expect(() => assertPreviewStubDeployment(targetedPreview(overrides)))
      .toThrow("Non-stub Preview requires a commit-bound, non-production targeted preview configuration");
  });

  it("allows a normal production build", () => {
    expect(() =>
      assertPreviewStubDeployment({
        VERCEL_ENV: "production",
        NEXT_PUBLIC_PREVIEW_STUB_MODE: "false",
      })
    ).not.toThrow();
  });
});
