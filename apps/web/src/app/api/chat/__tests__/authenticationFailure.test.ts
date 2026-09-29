// @vitest-environment node
import { AuthApiError, AuthSessionMissingError } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClientFromRequest } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { POST as chat } from "../route";
import { POST as ingest, DELETE as clear } from "../messages/route";
import { POST as imageUrls } from "../image-urls/route";
import { GET as memoryGet, PATCH as memoryPatch } from "../../amora/memory/route";

vi.mock("@/lib/supabase/server", () => ({ createClientFromRequest: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/utils/rateLimit", () => ({
  checkRateLimit: vi.fn(() => null), checkRateLimitPersistent: vi.fn(async () => null), rateLimitKey: vi.fn(() => "auth-test"),
}));

const endpoints = [
  { name: "chat", handler: chat, method: "POST" },
  { name: "ingest", handler: ingest, method: "POST" },
  { name: "clear", handler: clear, method: "DELETE" },
  { name: "images", handler: imageUrls, method: "POST" },
  { name: "memory get", handler: memoryGet, method: "GET" },
  { name: "memory patch", handler: memoryPatch, method: "PATCH" },
];

describe.each(endpoints)("$name authentication failures", ({ handler, method }) => {
  beforeEach(() => { vi.clearAllMocks(); });
  it.each([
    { label: "outage", error: new AuthApiError("temporary unavailable", 503, "unexpected_failure"), status: 503 },
    { label: "rate limit", error: new AuthApiError("too many requests", 429, "over_request_rate_limit"), status: 503 },
    { label: "unknown", error: new Error("temporary transport error"), status: 503 },
    { label: "throw", error: new Error("temporary transport throw"), status: 503 },
    { label: "missing session", error: new AuthSessionMissingError(), status: 401 },
    { label: "no session", error: null, status: 401 },
  ])("$label does not start reads, writes, or service work", async ({ label, error, status }) => {
    const from = vi.fn(), rpc = vi.fn();
    vi.mocked(createClientFromRequest).mockResolvedValue({
      auth: { getUser: label === "throw" ? vi.fn().mockRejectedValue(error) : vi.fn().mockResolvedValue({ data: { user: null }, error }) }, from, rpc,
    } as never);
    const request = new Request("http://localhost/api/chat", {
      method, headers: { Origin: "http://localhost", "Content-Type": "application/json" },
      ...(method === "GET" ? {} : { body: JSON.stringify({ messages: [], coupleId: "10000000-0000-4000-8000-000000000001" }) }),
    });
    const response = await handler(request);
    expect(response.status).toBe(status);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(from).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
    expect(createAdminClient).not.toHaveBeenCalled();
  });
});
