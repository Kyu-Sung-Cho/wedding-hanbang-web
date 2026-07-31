// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import { DELETE } from "./route";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClientFromRequest: vi.fn() }));
vi.mock("@/lib/demoSession", () => ({
  hasSignedDemoSessionFromCookieHeader: vi.fn(() => false),
}));
vi.mock("@/utils/rateLimit", () => ({
  checkRateLimit: vi.fn(() => null),
  rateLimitKey: vi.fn(() => "private-delete-test"),
}));

const USER_ID = "00000000-0000-4000-8000-000000000001";
const COUPLE_ID = "10000000-0000-4000-8000-000000000001";
const CLEARED_AT = "2026-07-31T01:02:03.000Z";
const routeSource = readFileSync(
  resolve(process.cwd(), "src/app/api/chat/messages/route.ts"),
  "utf8",
);

function request(
  body: unknown = { coupleId: COUPLE_ID, mode: "delete_private" },
  trusted = true,
) {
  return new Request("http://localhost/api/chat/messages", {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
      ...(trusted ? { Origin: "http://localhost" } : { Origin: "https://attacker.invalid" }),
    },
    body: JSON.stringify(body),
  });
}

function mockAuthenticatedRpc(result: { data: unknown; error: unknown }) {
  const rpc = vi.fn().mockResolvedValue(result);
  vi.mocked(createClientFromRequest).mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: USER_ID } },
      }),
    },
    rpc,
  } as never);
  return rpc;
}

describe("/api/chat/messages private hard delete", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses the one authenticated atomic RPC and never creates a service client", async () => {
    const rpc = mockAuthenticatedRpc({
      data: {
        success: true,
        visibility: "bride_private",
        cleared_at: CLEARED_AT,
        deleted_messages: 4,
      },
      error: null,
    });

    const response = await DELETE(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      mode: "delete_private",
      deleted: 4,
      clearedAt: CLEARED_AT,
    });
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith(
      "hard_delete_current_user_private_chat",
      { p_couple_id: COUPLE_ID },
    );
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("rejects cross-site cookie mutations before the RPC", async () => {
    const rpc = mockAuthenticatedRpc({
      data: null,
      error: null,
    });

    const response = await DELETE(request(undefined, false));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: "UNTRUSTED_MUTATION_REQUEST",
    });
    expect(rpc).not.toHaveBeenCalled();
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("maps the database current-membership fence to a bounded 403", async () => {
    const rpc = mockAuthenticatedRpc({
      data: null,
      error: {
        code: "42501",
        message: "PRIVATE_CHAT_HARD_DELETE_SCOPE_DENIED",
      },
    });

    const response = await DELETE(request());

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: "PRIVATE_CHAT_DELETE_SCOPE_DENIED",
    });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("fails closed when the atomic RPC result is incomplete", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const rpc = mockAuthenticatedRpc({
      data: { success: true, deleted_messages: 1 },
      error: null,
    });

    const response = await DELETE(request());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: "PRIVATE_CHAT_DELETE_INVALID_RESULT",
    });
    expect(rpc).toHaveBeenCalledTimes(1);
    consoleError.mockRestore();
  });

  it("contains no split raw-delete implementation for delete_private", () => {
    expect(routeSource).toContain("hard_delete_current_user_private_chat");
    expect(routeSource).not.toMatch(
      /case\s+"delete_private"[\s\S]*?from\("chat_messages"\)[\s\S]*?\.delete/,
    );
    expect(routeSource).not.toContain("const myVisibility = role ===");
  });
});
