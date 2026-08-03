// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const PROJECT = "proj_security_staging_1234";

describe("OpenAI client destination and project binding", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("AMORA_OPENAI_ENABLED", "true");
    vi.stubEnv("OPENAI_API_KEY", "sk-unit-fixture-not-a-secret-0000000000000000");
    vi.stubEnv("OPENAI_PROJECT_ID", PROJECT);
    vi.stubEnv("OPENAI_EXPECTED_PROJECT_ID", PROJECT);
    vi.stubEnv("VERCEL_ENV", "preview");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("constructs an official, explicitly project-bound, non-logging client", async () => {
    const { getOpenAIClient } = await import("../openai");
    const client = getOpenAIClient();

    expect(client.baseURL).toBe("https://api.openai.com/v1");
    expect(client.project).toBe(PROJECT);
    expect(client.organization).toBeNull();
    expect(client.adminAPIKey).toBeNull();
    expect(client.logLevel).toBe("off");
  });

  it.each([
    ["custom destination", "OPENAI_BASE_URL", "https://attacker.invalid/v1"],
    ["custom headers", "OPENAI_CUSTOM_HEADERS", "Authorization: Bearer stolen"],
    ["admin credential", "OPENAI_ADMIN_KEY", "sk-admin-production"],
    ["organization override", "OPENAI_ORG_ID", "org_production"],
  ])("rejects %s before constructing a client", async (_label, name, value) => {
    vi.stubEnv(name, value);
    const { getOpenAIClient } = await import("../openai");

    expect(() => getOpenAIClient()).toThrow(expect.objectContaining({
      category: "auth_config",
      providerCode: "openai_ambient_override_forbidden",
    }));
  });

  it("rejects a project that is not bound to the expected project", async () => {
    vi.stubEnv("OPENAI_EXPECTED_PROJECT_ID", "proj_different_project_5678");
    const { getOpenAIClient } = await import("../openai");

    expect(() => getOpenAIClient()).toThrow(expect.objectContaining({
      category: "auth_config",
      providerCode: "openai_project_binding_invalid",
    }));
  });

  it("requires production deployments to match the production project pin", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("OPENAI_PRODUCTION_PROJECT_ID", "proj_different_project_5678");
    const { getOpenAIClient } = await import("../openai");

    expect(() => getOpenAIClient()).toThrow(expect.objectContaining({
      category: "auth_config",
      providerCode: "openai_production_project_binding_invalid",
    }));
  });
});
