import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

// 개수를 세지 않는다. 안전한 리졸버를 삼항으로 감싸기만 해도 개수가 어긋나서
// 실제로는 안전한 변경이 실패로 잡혔다. 지켜야 하는 건 개수가 아니라
// "모든 출구가 안전한 리졸버를 통과한다"이다.
const SAFE_RESOLVERS = [
  "getAuthRedirectPath(",
  "resolveNeutralPreparationSpaceRedirect(",
];

// 로그인으로 되돌리는 것은 제품 화면이 아니라 인증 경계라 예외로 둔다.
const ALLOWED_LITERAL_EXITS = ['window.location.href = "/login";'];

describe("onboarding return journey boundary", () => {
  it("모든 온보딩 출구가 안전한 리졸버를 통과한다", () => {
    const onboarding = source("src/app/(auth)/onboarding/page.tsx");
    const lines = onboarding.split(/\r?\n/u);

    const exits = lines
      .map((line, index) => ({ line: line.trim(), lineNumber: index + 1 }))
      .filter((entry) => entry.line.includes("window.location.href ="));

    expect(exits.length).toBeGreaterThan(0);

    for (const exit of exits) {
      if (ALLOWED_LITERAL_EXITS.some((allowed) => exit.line.includes(allowed))) {
        continue;
      }
      // 같은 줄이거나 바로 다음 줄들에 리졸버가 있어야 한다(삼항 줄바꿈 허용)
      const nearby = lines
        .slice(exit.lineNumber - 1, exit.lineNumber + 3)
        .join(" ");
      const usesSafeResolver = SAFE_RESOLVERS.some((fn) => nearby.includes(fn));
      expect(
        usesSafeResolver,
        `line ${exit.lineNumber}이 안전한 리졸버를 통과하지 않는다: ${exit.line}`,
      ).toBe(true);
    }

    // 제품 화면 경로를 손으로 박지 않는다
    expect(onboarding).not.toContain('window.location.href = "/wedding');
  });

  it("keeps the requested destination when login must finish onboarding first", () => {
    const login = source("src/app/(auth)/login/page.tsx");

    expect(login).toContain("getPostLoginRedirectPath(");
    expect(login).not.toContain('window.location.href = "/wedding/onboarding"');
  });
});
