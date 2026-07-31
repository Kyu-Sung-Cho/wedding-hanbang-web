import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import { GET } from "./route";

const routeSource = readFileSync(
  resolve(process.cwd(), "src/app/api/auth/me/route.ts"),
  "utf8",
);

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClientFromRequest: vi.fn() }));
vi.mock("@/lib/demoSession", () => ({
  hasSignedDemoSessionFromCookieHeader: vi.fn(() => false),
}));

describe("/api/auth/me GET guest probe", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createClientFromRequest).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
      },
    } as never);
  });

  it("keeps the normal endpoint authentication-required", async () => {
    const response = await GET(new Request("http://localhost/api/auth/me"));

    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("returns a cache-disabled anonymous result for the exact guest probe", async () => {
    const response = await GET(
      new Request("http://localhost/api/auth/me?guest_probe=1"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(await response.json()).toEqual({ user: null });
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("does not enable the probe for a truthy-looking alternative value", async () => {
    const response = await GET(
      new Request("http://localhost/api/auth/me?guest_probe=true"),
    );

    expect(response.status).toBe(401);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("projects private rows explicitly and keeps invite codes behind their dedicated API", () => {
    expect(routeSource).not.toContain('.select("*")');
    expect(routeSource).not.toMatch(/\.select\(\s*\)/);
    expect(routeSource).not.toMatch(
      /PROFILE_AUTH_COLUMNS[\s\S]*phone|PROFILE_AUTH_COLUMNS[\s\S]*push_token/,
    );
    expect(routeSource).toContain("invite_code: null");
    expect(routeSource).toContain("PRIVATE_NO_STORE_HEADERS");
    expect(routeSource).toMatch(
      /JOURNEY_AUTH_COLUMNS[\s\S]*state_revision/,
    );
    expect(routeSource).toContain("journeyInsertErr?.code === \"23505\"");
  });
});
