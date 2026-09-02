import { createServer, type Server } from "node:http";
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { updateSession } from "../middleware";

// 이 파일은 `@supabase/ssr` 를 모킹하지 않는다. 검증하려는 것이 "토큰이 갱신될 때
// 그 쿠키가 응답에 실리는가"이고, 갱신을 일으키는 주체가 그 라이브러리이기 때문이다.
// 그래서 `NEXT_PUBLIC_SUPABASE_URL` 을 로컬 서버로 돌려 **실제 갱신 왕복**을 만든다.
//
// ## 무엇이 잘못돼 있었나
//
// `updateSession` 은 갱신 쿠키를 `setAll` 에서 `finalResponse` 에만 실었다. 그런데
// 관문 셋(미인증 · 동의 · 온보딩)은 `finalResponse` 가 아니라 **새 리다이렉트**를
// 돌려준다. 그 갈래로 나가면 갱신 쿠키가 사라진다.
//
// Supabase 의 refresh token 은 회전한다. 예전 토큰은 갱신되는 순간 소비되므로,
// 새 쿠키를 흘리면 브라우저는 이미 소비된 토큰을 계속 들고 있게 된다. 다음 요청은
// 로그아웃으로 도착하고 클라이언트가 또 갱신한다 — 서버와 클라이언트가 같은 쿠키
// 이름에 서로 다른 세션을 번갈아 쓰는 상태가 되고, 조각이 섞이면 디코딩이 깨진다.
//
// 같은 파일의 `redirectAppDoor` 는 처음부터 이 일을 하고 있었다("여기서 흘리면
// 다음 요청이 다시 로그아웃 상태로 도착한다"). 관문 쪽만 빠져 있었다.

/**
 * 쿠키 이름은 우리가 고르는 것이 아니다. supabase-js 가 URL 에서 만든다:
 * `sb-${new URL(url).hostname.split(".")[0]}-auth-token`.
 * 스텁이 `127.0.0.1` 이므로 여기서는 `sb-127-auth-token` 이 된다 — 이름을
 * 손으로 적으면 세션이 읽히지 않고, 그러면 이 검사는 조용히 아무것도 확인하지
 * 않는다(처음에 실제로 그랬다).
 */
let KEY: string;

const USER = {
  id: "11111111-1111-4111-8111-111111111111",
  aud: "authenticated",
  role: "authenticated",
  email: "refresh@example.test",
  user_metadata: { name: "갱신", terms_agreed: true, privacy_agreed: true },
  app_metadata: { provider: "email", providers: ["email"] },
  created_at: "2026-01-01T00:00:00Z",
};

let server: Server;
const seen: string[] = [];

beforeAll(async () => {
  server = createServer((request, response) => {
    request.resume();
    request.on("end", () => {
      const path = new URL(request.url ?? "/", "http://local").pathname;
      seen.push(path);
      const json = (payload: unknown) => {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify(payload));
      };

      if (path === "/auth/v1/token") {
        // 갱신 응답. 새 access/refresh 토큰을 준다 — 예전 refresh token 은
        // 이 시점에 소비된 것으로 본다(실제 GoTrue 가 회전시킨다).
        return json({
          access_token: "ROTATED-access-token",
          refresh_token: "ROTATED-refresh-token",
          token_type: "bearer",
          expires_in: 3600,
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          user: USER,
        });
      }
      if (path === "/auth/v1/user") return json(USER);
      return json({});
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no addr");
  const supabaseUrl = `http://127.0.0.1:${address.port}`;
  process.env.NEXT_PUBLIC_SUPABASE_URL = supabaseUrl;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = `sb_publishable_${"a".repeat(40)}`;
  KEY = `sb-${new URL(supabaseUrl).hostname.split(".")[0]}-auth-token`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

afterEach(() => {
  seen.length = 0;
  vi.unstubAllEnvs();
});

/** 이미 만료된 세션. 다음 조회가 갱신을 일으킨다. */
function expiredSessionCookie() {
  const session = {
    access_token: "STALE-access-token",
    refresh_token: "STALE-refresh-token",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) - 60,
    user: USER,
  };
  return `${KEY}=base64-${Buffer.from(JSON.stringify(session), "utf8").toString("base64url")}`;
}

function setCookieFor(response: Response, name: string): string | undefined {
  return response.headers.getSetCookie().find((header) => header.startsWith(`${name}=`));
}

describe("토큰이 갱신되는 요청이 관문으로 나갈 때", () => {
  it("온보딩 관문으로 돌려세우면서도 갱신된 세션을 실어 보낸다", async () => {
    // `onboarding_complete` 가 없으므로 미들웨어는 온보딩으로 돌려세운다.
    const response = await updateSession(
      new NextRequest("https://hanbang.ai/wedding/lounge", {
        headers: { cookie: expiredSessionCookie() },
      }),
    );

    expect(seen).toContain("/auth/v1/token");
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/wedding/onboarding");

    const written = setCookieFor(response, KEY);
    expect(written, "갱신된 세션 쿠키가 리다이렉트에 실려야 한다").toBeDefined();
    // 회전된 토큰이 실제로 들어 있어야 한다. 예전 값이 남으면 브라우저는 이미
    // 소비된 refresh token 을 계속 들고 있게 된다.
    const value = decodeURIComponent(written!.split(";")[0].slice(`${KEY}=`.length));
    const decoded = Buffer.from(value.replace(/^base64-/, ""), "base64url").toString("utf8");
    expect(decoded).toContain("ROTATED-refresh-token");
    expect(decoded).not.toContain("STALE-refresh-token");
  });

  it("통과하는 요청에서도 갱신된 세션이 실린다", async () => {
    const response = await updateSession(
      new NextRequest("https://hanbang.ai/wedding/lounge", {
        headers: { cookie: `${expiredSessionCookie()}; onboarding_complete=true` },
      }),
    );

    expect(seen).toContain("/auth/v1/token");
    expect(response.status).toBe(200);
    expect(setCookieFor(response, KEY)).toBeDefined();
  });

  it("갱신이 없으면 세션 쿠키를 건드리지 않는다", async () => {
    // 멀쩡한 세션에 괜히 쿠키를 다시 쓰면 만료 시각이 조용히 밀린다.
    const session = {
      access_token: "FRESH-access-token",
      refresh_token: "FRESH-refresh-token",
      token_type: "bearer",
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: USER,
    };
    const cookie = `${KEY}=base64-${Buffer.from(JSON.stringify(session), "utf8").toString("base64url")}`;

    const response = await updateSession(
      new NextRequest("https://hanbang.ai/wedding/lounge", {
        headers: { cookie: `${cookie}; onboarding_complete=true` },
      }),
    );

    expect(seen).not.toContain("/auth/v1/token");
    expect(setCookieFor(response, KEY)).toBeUndefined();
  });

  it("갱신한 쿠키를 같은 응답에서 다시 지우지 않는다", async () => {
    // 지우기(망가진 쿠키 제거)와 쓰기(갱신)가 같은 이름에 겹치면, 순서에 따라
    // 갱신을 스스로 무효로 만들 수 있다.
    const response = await updateSession(
      new NextRequest("https://hanbang.ai/wedding/lounge", {
        headers: { cookie: expiredSessionCookie() },
      }),
    );

    const written = setCookieFor(response, KEY);
    expect(written).toBeDefined();
    expect(written).not.toMatch(/Max-Age=0/i);
  });
});
