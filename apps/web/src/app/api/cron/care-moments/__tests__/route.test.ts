import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { GET } from "../route";

vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn() }));

describe("/api/cron/care-moments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("CRON_SECRET", "test-cron-secret");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("does not read user data or send care messages while the outbound kill switch is off", async () => {
    vi.stubEnv("AMORA_CARE_OUTBOUND_ENABLED", "false");
    const request = new NextRequest("http://localhost/api/cron/care-moments", {
      headers: { authorization: "Bearer test-cron-secret" },
    });

    const response = await GET(request);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, enabled: false });
    expect(createClient).not.toHaveBeenCalled();
  });
});
