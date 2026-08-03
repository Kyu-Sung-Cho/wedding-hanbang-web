import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createClient: vi.fn(() => ({ pinned: true })) }));

vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));

import { createAdminClient } from "../admin";
import {
  TEST_SUPABASE_PROJECT_REF,
  TEST_SUPABASE_SERVICE_ROLE_KEY,
  TEST_SUPABASE_URL,
} from "@/test/supabaseDestinationEnv";

describe("createAdminClient destination fence", () => {
  beforeEach(() => {
    mocks.createClient.mockClear();
    process.env.NEXT_PUBLIC_SUPABASE_URL = TEST_SUPABASE_URL;
    process.env.SUPABASE_SERVICE_ROLE_KEY = TEST_SUPABASE_SERVICE_ROLE_KEY;
    process.env.SUPABASE_EXPECTED_URL = TEST_SUPABASE_URL;
    process.env.SUPABASE_EXPECTED_PROJECT_REF = TEST_SUPABASE_PROJECT_REF;
    process.env.SUPABASE_PRODUCTION_PROJECT_REF = "slrtobkksjmxgzatjyqb";
    delete process.env.SUPABASE_PRODUCTION_WRITE_CONFIRM;
    delete process.env.VERCEL_ENV;
    delete process.env.NEXT_PUBLIC_PREVIEW_STUB_MODE;
  });

  it("validates before constructing the privileged SDK client", () => {
    expect(createAdminClient()).toEqual({ pinned: true });
    expect(mocks.createClient).toHaveBeenCalledWith(
      TEST_SUPABASE_URL,
      TEST_SUPABASE_SERVICE_ROLE_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
  });

  it("does not construct an SDK client when the URL is contaminated", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://zyxwvutsrqponmlkjihg.supabase.co";
    expect(() => createAdminClient()).toThrowError(
      expect.objectContaining({ code: "URL_MISMATCH" }),
    );
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("does not construct a production client without the exact write opt-in", () => {
    process.env.SUPABASE_PRODUCTION_PROJECT_REF = TEST_SUPABASE_PROJECT_REF;
    expect(() => createAdminClient()).toThrowError(
      expect.objectContaining({ code: "PRODUCTION_WRITE_CONFIRMATION_REQUIRED" }),
    );
    expect(mocks.createClient).not.toHaveBeenCalled();

    process.env.SUPABASE_PRODUCTION_WRITE_CONFIRM = `RUNTIME_WRITE:${TEST_SUPABASE_PROJECT_REF}`;
    expect(createAdminClient()).toEqual({ pinned: true });
    expect(mocks.createClient).toHaveBeenCalledOnce();
  });

  it("rechecks Preview containment before constructing a privileged client", () => {
    process.env.VERCEL_ENV = "preview";
    process.env.NEXT_PUBLIC_PREVIEW_STUB_MODE = "false";

    expect(() => createAdminClient()).toThrow(
      "Non-stub Preview requires a commit-bound, non-production targeted preview configuration",
    );
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("never constructs a privileged client in Preview stub mode", () => {
    process.env.VERCEL_ENV = "preview";
    process.env.NEXT_PUBLIC_PREVIEW_STUB_MODE = "true";

    expect(() => createAdminClient()).toThrow(
      "Supabase clients are disabled in Preview stub mode",
    );
    expect(mocks.createClient).not.toHaveBeenCalled();
  });
});
