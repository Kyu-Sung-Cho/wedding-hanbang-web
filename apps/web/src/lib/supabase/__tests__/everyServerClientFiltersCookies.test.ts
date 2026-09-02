import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createServerClient } from "@supabase/ssr";
import { describe, expect, it } from "vitest";

import { withoutCorruptAuthCookies } from "../authCookieRepair";

// 2026-09-02 CTO 독립 검증에서 드러난 것: 망가진 세션 쿠키 하나로 **18개 운영 경로**가
// 5xx 가 됐다. 내가 처음 보고한 것은 세 표면뿐이었다. 놓친 것들이 특히 나쁘다:
//
//   /api/auth/me?guest_probe=1   200 → 500   (인증선택 공개 프로브)
//   /api/community/posts         200 → 500   (공개 커뮤니티 조회)
//   /api/messages · /api/profile · /api/favorites · /api/couple/code
//                                401 → 500
//   /api/auth/confirm            메일 인증 링크가 도착하는 자리
//   /api/auth/callback           소셜 로그인이 돌아오는 자리
//
// 원인은 하나인데 **쿠키를 건네주는 자리가 여러 곳**이었다. 한 곳만 고치면 나머지는
// 그대로 던진다. 그래서 "새 서버 클라이언트를 만들 때 걸러내는 것을 잊는" 일 자체를
// 막는 검사를 둔다.

const WEB_ROOT = resolve(process.cwd(), "src");

/** 서버에서 쿠키로 세션을 읽는 자리. 여기 있는 모든 파일이 걸러내야 한다. */
const SERVER_CLIENT_FILES = [
  "lib/supabase/server.ts",
  "lib/supabase/middleware.ts",
  "app/api/auth/confirm/route.ts",
  "app/api/auth/callback/route.ts",
];

describe("쿠키로 세션을 읽는 모든 서버 자리", () => {
  it.each(SERVER_CLIENT_FILES)("%s 는 망가진 세션 쿠키를 걸러낸다", (file) => {
    const text = readFileSync(resolve(WEB_ROOT, file), "utf8");
    const getAllBlocks = [...text.matchAll(/getAll\(\)\s*\{([\s\S]*?)\n\s*\},/gu)]
      .map((match) => match[1]);

    expect(getAllBlocks.length, `${file} 에서 getAll 을 못 찾았다`).toBeGreaterThan(0);
    for (const block of getAllBlocks) {
      expect(block, `${file} 의 getAll 이 걸러내지 않는다`)
        .toContain("withoutCorruptAuthCookies");
    }
  });

  /**
   * 위 목록이 낡는 것을 막는다. 새 서버 클라이언트를 추가하면 이 검사가 먼저 깨진다 —
   * 목록에 넣지 않으면 그 자리는 조용히 다시 500 을 내기 시작한다.
   */
  it("목록 밖에서 서버 클라이언트를 새로 만들지 않는다", () => {
    const offenders: string[] = [];

    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = resolve(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === "__tests__" || entry.name === "node_modules") continue;
          walk(path);
          continue;
        }
        if (!/\.tsx?$/.test(entry.name)) continue;
        if (/\.test\.tsx?$/.test(entry.name)) continue;
        if (!readFileSync(path, "utf8").includes("createServerClient(")) continue;
        const relative = path.slice(WEB_ROOT.length + 1).split("\\").join("/");
        if (!SERVER_CLIENT_FILES.includes(relative)) offenders.push(relative);
      }
    };
    walk(WEB_ROOT);

    expect(
      offenders,
      "createServerClient 를 새로 쓰는 파일이 있습니다. 망가진 세션 쿠키를 "
      + "걸러내고(withoutCorruptAuthCookies) 이 파일의 SERVER_CLIENT_FILES 에 추가하세요",
    ).toEqual([]);
  });
});

/**
 * 걸러낸 목록을 주면 던지지 않는다.
 *
 * 반대 방향(걸러내지 않으면 던진다)은 여기서 검사하지 않는다. supabase-js 는
 * 클라이언트를 만드는 순간 내부에서도 세션을 읽으므로(`_emitInitialSession`),
 * 망가진 쿠키를 주면 우리가 await 하는 promise 와 **별개로** unhandledRejection
 * 이 난다 — 그것 자체가 운영에서 서버로 새던 모양이고(`⨯ unhandledRejection:
 * Error: Invalid UTF-8 sequence`), 검사 안에서 재현하면 결과를 오염시킨다.
 *
 * 던진다는 사실은 `middlewareCorruptSession.test.ts` 가 실제 요청으로 확인한다
 * (수정 전 그 파일은 운영과 같은 오류 원문으로 실패한다).
 *
 * 던지는 자리도 여기 적어 둔다: CTO 보고는 "createClient 중"이었지만, 로컬
 * 프로덕션 빌드에서 채집한 스택은 **세션을 처음 만지는 호출**을 가리킨다 —
 * `Object.getItem → __loadSession → _useSession`. 쿠키를 늦게 읽기 때문이다.
 * 고쳐야 하는 자리는 같다(쿠키를 건네주는 곳).
 */
describe("걸러낸 쿠키 목록", () => {
  it("망가진 세션을 '세션 없음'으로 만든다", async () => {
    const corrupt = [{
      name: "sb-abcdefghijklmnopqrst-auth-token",
      value: `base64-${Buffer.from([0xff, 0xfe, 0xfd]).toString("base64url")}`,
    }];

    const client = createServerClient(
      "https://abcdefghijklmnopqrst.supabase.co",
      `sb_publishable_${"a".repeat(40)}`,
      {
        cookies: {
          getAll: () => withoutCorruptAuthCookies(corrupt),
          setAll: () => {},
        },
      },
    );

    const result = await client.auth.getUser();
    expect(result.data.user).toBeNull();
    expect(result.error).not.toBeNull();
  });
});
