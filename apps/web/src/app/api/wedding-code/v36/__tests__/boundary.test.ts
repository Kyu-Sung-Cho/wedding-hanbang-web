// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createSubmission } from "@/lib/weddingCode36";
import { POST } from "../response/route";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/utils/rateLimit", () => ({ checkRateLimitPersistent: vi.fn(async () => null), rateLimitKey: vi.fn(() => "wc36-boundary") }));

const url = "https://example.test/api/wedding-code/v36/response";
const body = () => ({ ...createSubmission(3), consent: true, submission_id: "00000000-0000-4000-8000-000000000001", access_token: "00000000-0000-4000-8000-000000000002" });

describe("36문항 서버의 DB 목적지 및 본문 경계", () => {
  beforeEach(() => { vi.mocked(createAdminClient).mockReset(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it("기존 DB 목적지 펜스의 거부를 우회하지 않고 비밀값 없이 실패한다", async () => {
    vi.mocked(createAdminClient).mockImplementation(() => { throw new Error("SUPABASE_SERVICE_ROLE_KEY=never-expose"); });
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await POST(new NextRequest(url, { method: "POST", body: JSON.stringify(body()) }));
    expect(response.status).toBe(503);
    expect(createAdminClient).toHaveBeenCalledExactlyOnceWith();
    expect(JSON.stringify(await response.json())).not.toContain("never-expose");
    expect(JSON.stringify(errors.mock.calls)).not.toContain("never-expose");
  });

  it("길이 헤더 없는 큰 스트림은 제한을 넘긴 즉시 취소하고 DB를 호출하지 않는다", async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) { controller.enqueue(new Uint8Array(20_000).fill(120)); },
      cancel() { cancelled = true; },
    });
    const init: ConstructorParameters<typeof NextRequest>[1] & { duplex: "half" } = { method: "POST", body: stream, duplex: "half" };
    const response = await POST(new NextRequest(url, init));
    expect(response.status).toBe(413);
    expect(cancelled).toBe(true);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("허위로 작은 길이를 적어도 실제 바이트 수로 제한한다", async () => {
    const response = await POST(new NextRequest(url, { method: "POST", headers: { "content-length": "1" }, body: JSON.stringify({ ...body(), junk: "x".repeat(20_000) }) }));
    expect(response.status).toBe(413);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("잘못된 UTF-8은 대신 문자로 바꿔 저장하지 않는다", async () => {
    const bytes = new Uint8Array([0x22, 0xff, 0x22]);
    const response = await POST(new NextRequest(url, { method: "POST", body: bytes }));
    expect(response.status).toBe(400);
    expect(createAdminClient).not.toHaveBeenCalled();
  });
});
