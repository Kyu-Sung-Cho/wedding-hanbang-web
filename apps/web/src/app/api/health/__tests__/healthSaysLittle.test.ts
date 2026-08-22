// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

/**
 * 상태 확인이 **살아 있는지만** 말하는지 본다.
 *
 * 이 주소는 로그인 없이 열린다. 그래서 편의로 한 줄씩 얹기 쉬운 자리이고, 얹는 순간
 * 그 자체가 정보 노출이 된다. 특히 **남은 하루 한도**는 얼마나 남았는지 알려주면
 * 얼마나 태워야 하는지도 알려주는 셈이다.
 *
 * 반대로 "200 을 돌려준다"만으로는 아무것도 확인하지 않는 것이다 — 앱이 살아 있어도
 * DB 가 끊기면 화면은 전부 빈다. 그래서 DB 에 한 번 닿아 보되, **행을 읽지 않는다.**
 */
describe("공개 상태 확인", () => {
  const source = readFileSync(
    resolve(process.cwd(), "src/app/api/health/route.ts"),
    "utf8",
  );

  it("검사가 실제로 파일을 읽는다", () => {
    // 경로가 틀리면 아래 검사들이 빈 문자열을 보며 늘 통과한다.
    expect(source.length).toBeGreaterThan(500);
    expect(source).toContain("export async function GET");
  });

  it("사적인 것을 말하지 않는다", () => {
    const forbidden = [
      // 남은 한도 — 얼마나 태워야 하는지를 알려주는 셈이다
      "GLOBAL_DAILY", "remaining", "budget", "quota",
      // 사용자·커플 데이터
      "couple", "profile", "user_id", "email",
      // 내부 사정
      "process.env.SUPABASE", "SERVICE_ROLE", "stack", "message:",
    ];
    const leaked = forbidden.filter((word) => source.includes(word));
    expect(
      leaked,
      "상태 확인은 살아 있는지만 말한다 — 여기에 무언가를 얹으려면 왜 공개해도 되는지부터 적어라",
    ).toEqual([]);
  });

  it("행을 읽지 않는다 — 아무나 반복해서 부를 수 있는 자리다", () => {
    // **주석이 아니라 호출을 본다.** 첫 판은 `source.includes("head: true")` 였는데,
    // 이 파일의 설명 주석에도 그 낱말이 있어서 **코드에서 빼도 통과했다**(뮤테이션으로
    // 확인). 같은 함정을 이 저장소가 전에도 겪었다 — 훅 검사가 주석의 "test" 에 속았다.
    expect(source).toContain('.select("*", { count: "exact", head: true })');
    expect(source).toContain(".limit(1)");
  });

  it("응답이 캐시되지 않는다", () => {
    // 캐시되면 죽은 뒤에도 살아 있다고 말한다.
    expect(source).toContain("no-store");
    expect(source).toContain('export const dynamic = "force-dynamic"');
  });

  it("DB 가 끊기면 실패를 실패라고 말한다", () => {
    // 늘 200 을 돌려주는 상태 확인은 감시 서비스에게 아무 말도 안 하는 것과 같다.
    expect(source).toContain("503");
  });

  describe("실제 응답", () => {
    it("DB 에 닿으면 200 과 up 을 돌려준다", async () => {
      vi.resetModules();
      vi.doMock("@/lib/supabase/server", () => ({
        createClient: async () => ({
          from: () => ({
            select: () => ({ limit: async () => ({ error: null }) }),
          }),
        }),
      }));
      const { GET } = await import("@/app/api/health/route");
      const response = await GET();
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.ok).toBe(true);
      expect(body.database).toBe("up");
      // 말하는 것은 넷뿐이다.
      expect(Object.keys(body).sort()).toEqual(["checkedAt", "commit", "database", "ok"]);
    });

    it("DB 가 끊기면 503 을 돌려주고 원인을 밖으로 내지 않는다", async () => {
      vi.resetModules();
      vi.doMock("@/lib/supabase/server", () => ({
        createClient: async () => ({
          from: () => ({
            select: () => ({
              limit: async () => ({ error: { message: "relation does not exist" } }),
            }),
          }),
        }),
      }));
      const { GET } = await import("@/app/api/health/route");
      const response = await GET();
      expect(response.status).toBe(503);
      const body = await response.json();
      expect(body.ok).toBe(false);
      expect(body.database).toBe("down");
      // DB 오류 원문이 밖으로 나가면 안 된다.
      expect(JSON.stringify(body)).not.toContain("relation");
    });

    it("커밋을 모르면 지어내지 않는다", async () => {
      vi.resetModules();
      vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "");
      vi.doMock("@/lib/supabase/server", () => ({
        createClient: async () => ({
          from: () => ({ select: () => ({ limit: async () => ({ error: null }) }) }),
        }),
      }));
      const { GET } = await import("@/app/api/health/route");
      const body = await (await GET()).json();
      expect(body.commit).toBe("unknown");
      vi.unstubAllEnvs();
    });
  });
});
