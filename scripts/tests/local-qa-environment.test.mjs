import assert from "node:assert/strict";
import test from "node:test";

import { createLocalQaWebBuildEnvironment } from "../lib/local-qa-environment.mjs";

test("local QA web builds replace provider credentials with static placeholders", () => {
  const source = {
    PATH: "C:\\tools",
    CI: "false",
    VERCEL_ENV: "production",
    HANBANG_DEPLOYMENT_ENV: "production",
    PRICE_CATALOG_MIN_PUBLISHED_VENDORS: "25",
    NEXT_PUBLIC_SUPABASE_URL: "https://realprojectref123456.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "real-anon-key",
    SUPABASE_SERVICE_ROLE_KEY: "real-service-role-key",
    SUPABASE_PRODUCTION_PROJECT_REF: "realproductionref12",
    SUPABASE_PRODUCTION_WRITE_CONFIRM: "RUNTIME_WRITE:realproductionref12",
    OPENAI_API_KEY: "real-openai-key",
    ANTHROPIC_API_KEY: "legacy-anthropic-key",
    AMORA_OPENAI_ENABLED: "true",
  };

  const env = createLocalQaWebBuildEnvironment(source);

  assert.equal(env.PATH, source.PATH);
  assert.equal(env.CI, "true");
  assert.equal(
    env.NEXT_PUBLIC_SUPABASE_URL,
    "https://abcdefghijklmnopqrst.supabase.co",
  );
  assert.equal(env.NEXT_PUBLIC_SUPABASE_ANON_KEY, "placeholder_anon_key");
  assert.equal(env.SUPABASE_EXPECTED_PROJECT_REF, "abcdefghijklmnopqrst");
  assert.equal(env.SUPABASE_PRODUCTION_PROJECT_REF, "zyxwvutsrqponmlkjihg");
  assert.equal(env.SUPABASE_PRODUCTION_WRITE_CONFIRM, "");
  assert.equal(env.AMORA_OPENAI_ENABLED, "false");
  assert.equal(env.OPENAI_API_KEY, "");
  assert.equal(env.ANTHROPIC_API_KEY, "");
  assert.equal("VERCEL_ENV" in env, false);
  assert.equal("HANBANG_DEPLOYMENT_ENV" in env, false);
  assert.equal("PRICE_CATALOG_MIN_PUBLISHED_VENDORS" in env, false);

  assert.equal(source.CI, "false");
  assert.equal(source.OPENAI_API_KEY, "real-openai-key");
});
