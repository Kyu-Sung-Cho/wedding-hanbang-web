import { describe, expect, it, vi } from "vitest";

const { createClientSpy } = vi.hoisted(() => ({
  createClientSpy: vi.fn(() => {
    throw new Error("중단된 엔드포인트는 데이터베이스 클라이언트를 만들면 안 됩니다.");
  }),
}));

vi.mock("@supabase/supabase-js", () => ({ createClient: createClientSpy }));

import { POST } from "../route";

describe("POST /api/wedding-code/response", () => {
  it("응답 본문을 읽지 않고 수집 중단 상태를 반환한다", async () => {
    const unreadableRequest = new Proxy(
      {},
      {
        get() {
          throw new Error("중단된 엔드포인트는 요청을 읽으면 안 됩니다.");
        },
      }
    );
    const response = await (POST as (request: unknown) => Promise<Response>)(unreadableRequest);

    expect(response.status).toBe(410);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(createClientSpy).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: "웨딩코드 참여는 정식 검증 준비를 위해 중단되었습니다.",
    });
  });
});
