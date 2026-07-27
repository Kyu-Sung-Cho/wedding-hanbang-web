// @vitest-environment node

import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Turnstile 검증이 걸린 API를, 위젯이 없는 화면에서 직접 부르면 안 된다.
 *
 * 실키가 발급되기 전에는 서버가 `skipped:true`로 통과시켜 아무 문제가 없어 보인다.
 * 키를 넣는 순간 그 화면은 토큰을 만들 방법이 없으므로 **영구 실패**한다.
 * 2026-07-23에 이 방식으로 가입·사전등록·비번재설정이 전면 차단됐고(`fb1dca94`),
 * `6a95dd5b`가 `/demo/login`의 가입 경로만 고치고 바로 아래 forgot 경로는
 * 같은 상태로 남겨 뒀다. 사람이 다시 못 보고 넘길 자리라 테스트로 잠근다.
 */
const GATED_ENDPOINTS = [
  "/api/auth/signup",
  "/api/auth/forgot-password",
  "/api/preregister",
  "/api/survey",
] as const;

const APP_DIR = resolve(process.cwd(), "src", "app");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      // API 라우트는 서버측이고, 검증하는 주체라 대상이 아니다.
      return entry.name === "api" ? [] : sourceFiles(path);
    }
    if (!/\.tsx?$/.test(entry.name)) return [];
    if (/\.test\.tsx?$/.test(entry.name)) return [];
    return [path];
  });
}

describe("Turnstile 게이트 API를 부르는 화면은 위젯을 렌더한다", () => {
  it("위젯 없이 게이트된 엔드포인트를 직접 호출하는 화면이 없다", () => {
    const violations: string[] = [];

    for (const path of sourceFiles(APP_DIR)) {
      const source = readFileSync(path, "utf8");
      const called = GATED_ENDPOINTS.filter((endpoint) => source.includes(`"${endpoint}"`)
        || source.includes(`'${endpoint}'`));
      if (called.length === 0) continue;
      if (source.includes("TurnstileWidget")) continue;
      violations.push(`${relative(APP_DIR, path)} → ${called.join(", ")}`);
    }

    expect(
      violations,
      `위젯 없이 Turnstile 게이트 API 호출: ${violations.join(" | ")}`
        + " — 실키를 넣는 순간 이 경로는 영구 실패한다",
    ).toEqual([]);
  });
});
