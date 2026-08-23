// @vitest-environment node

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * **저장소 어디에도 "지금을 UTC 날짜로 자르는" 코드가 없다.**
 *
 * `new Date().toISOString().slice(0, 10)` 은 어디서 돌든 UTC 날짜다. 한국은 UTC+9 이므로
 * **한국 시각 00:00~09:00 동안 어제**가 된다. 하루 24시간 중 9시간이다.
 *
 * ## 왜 검사를 하나 더 만드나
 *
 * 이미 `todayIsKst.test.ts` 가 있다. 그런데 그 검사는 **고칠 파일의 이름을 적어 두는**
 * 방식이라, 목록에 없는 파일은 아무리 틀려도 초록불이었다. 실제로 그 검사가 통과하는
 * 동안 다섯 자리가 남아 있었고 그중 셋은 **화면 글자가 아니라 저장되는 값**이 틀렸다.
 *
 *   apps/web/src/app/(app)/money/page.tsx      축의금 받은 날 기본값 (×2)
 *   apps/web/src/app/api/money/route.ts        같은 값의 서버 기본값
 *   apps/web/src/app/api/admin/customers/route.ts
 *
 * 목록을 늘리는 대신 **나무 전체**를 훑는다. 새 파일에서 같은 실수를 해도 잡힌다.
 *
 * ## 무엇을 막고 무엇을 두나
 *
 * 막는 것은 **자르는 행위**다. 시각을 통째로 쓰는 `new Date().toISOString()` 은 그대로
 * 둔다 — `createdAt` 같은 타임스탬프는 UTC 로 저장하는 것이 맞다. 문제는 거기서 날짜만
 * 떼어 "오늘"로 쓸 때 생긴다.
 *
 * 인자가 있는 `new Date(x).toISOString().slice(0, 10)` 도 두지 않았다 — 그것은 이미
 * 특정 시각을 가리키는 값이라 UTC 로 읽어도 뜻이 바뀌지 않는 경우가 많고
 * (`todayYmdInKst` 도 안에서 그 모양을 쓴다), 정말 문제가 되는 것은 **인자 없는 지금**이다.
 */
describe("UTC 오늘이 저장소 어디에도 없다", () => {
  const roots = [
    resolve(process.cwd(), "src"),
    resolve(process.cwd(), "..", "mobile", "app"),
    resolve(process.cwd(), "..", "mobile", "src"),
    resolve(process.cwd(), "..", "..", "packages", "shared", "src"),
  ];
  const SKIP = new Set(["__tests__", "node_modules", ".next", ".expo", "dist"]);

  function walk(dir: string, out: string[] = []): string[] {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return out;
    }
    for (const entry of entries) {
      if (SKIP.has(entry)) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full, out);
      else if (/\.(tsx?|mjs)$/.test(entry) && !/\.(test|spec)\./.test(entry)) out.push(full);
    }
    return out;
  }

  /**
   * 줄 주석과 블록 주석을 지운다.
   *
   * 이걸 빼면 **이 규칙을 설명하는 주석이 스스로 위반으로 잡힌다.** 실제로 변형 시험에서
   * 그렇게 됐다. 이 저장소는 전에도 주석 속 낱말을 UI 문구로 세는 검사를 만든 적이 있다.
   */
  function stripComments(source: string): string {
    return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  }

  const files = roots.flatMap((root) => walk(root));

  const PATTERN =
    /new Date\(\)\s*\.toISOString\(\)\s*\.\s*(?:slice\(\s*0\s*,\s*10\s*\)|split\(\s*["']T["']\s*\)\s*\[\s*0\s*\]|substring\(\s*0\s*,\s*10\s*\))/;

  it("검사가 실제로 파일을 읽는다", () => {
    // 경로가 하나라도 틀리면 아래 검사가 빈 목록을 보며 늘 통과한다.
    expect(files.length, "훑은 파일이 없다").toBeGreaterThan(400);
    for (const marker of [`mobile${sep}app`, `shared${sep}src`]) {
      expect(files.some((f) => f.includes(marker)), `${marker} 를 안 훑었다`).toBe(true);
    }
  });

  it("판별식이 실제로 그 모양을 잡는다", () => {
    // 정규식이 낡아 아무것도 못 잡으면서 초록불을 주는 일이 이 저장소에 있었다.
    expect(PATTERN.test('const t = new Date().toISOString().slice(0, 10);')).toBe(true);
    expect(PATTERN.test('const t = new Date().toISOString().split("T")[0];')).toBe(true);
    // 시각 전체를 쓰는 것은 잡지 않는다.
    expect(PATTERN.test("const at = new Date().toISOString();")).toBe(false);
  });

  it("주석은 위반으로 세지 않는다", () => {
    const sample = '// new Date().toISOString().slice(0, 10)\nconst a = 1;';
    expect(PATTERN.test(stripComments(sample))).toBe(false);
  });

  it("지금을 UTC 날짜로 자르는 곳이 없다", () => {
    const offenders = files
      .filter((file) => PATTERN.test(stripComments(readFileSync(file, "utf8"))))
      .map((file) => relative(resolve(process.cwd(), "..", ".."), file).split(sep).join("/"));

    expect(
      offenders,
      "UTC 오늘이다 — 한국 새벽 0~9시에 어제가 된다. "
        + "`todayYmdInKst()` 를 쓰라(`@hanbang/shared/utils`). "
        + "시각 전체가 필요하면 자르지 말고 `toISOString()` 을 그대로 쓰라.",
    ).toEqual([]);
  });
});
