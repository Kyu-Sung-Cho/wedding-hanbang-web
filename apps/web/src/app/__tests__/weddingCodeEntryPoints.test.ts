import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, "..");
const srcRoot = path.resolve(appRoot, "..");
const read = (relative: string) => readFileSync(path.join(appRoot, relative), "utf8");

/** 테스트가 아닌 .ts/.tsx 소스. 이전 판 코드 조회 화면 자신은 뺀다. */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "__tests__" || name === "node_modules") continue;
      if (full === path.join(appRoot, "wedding-code", "c")) continue;
      sourceFiles(full, out);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

/** 주석 속 경로 설명은 링크가 아니다. 블록 주석과 줄 주석(주소의 `://`는 남긴다)을 걷어낸다. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/**
 * 2026-11-21 파운더 결정으로 웨딩코드와 준비 스타일을 내렸다. 그 전에는 "웨딩코드는 로그인 없이 해볼
 * 수 있는 입구다(2026-09-15 파운더 결정: 어디서든 보이게)"를 지키던 묶음이었다. 이제 반대로
 * **들어가는 길이 다시 생기지 않는지** 지킨다. 웨딩코드 주소는 `proxy.ts` 가 라운지로 보낸다.
 */
describe("WeddingCode entry points (retired 2026-11-21)", () => {
  it("로그인 화면에 웨딩코드로 가는 링크가 없다", () => {
    const login = withoutComments(read("(auth)/login/page.tsx"));
    expect(login).not.toContain('"/wedding-code"');
    expect(login).not.toContain("웨딩코드");
  });

  it("라운지와 서비스 메뉴에 웨딩코드·준비 스타일 입구가 없다", () => {
    // 라운지는 청첩장 홈(`LiveLounge`)이고, 다른 화면으로 가는 길은 바닥 서비스 메뉴(`liveRoutes.ts`)다.
    const links = withoutComments(readFileSync(path.join(srcRoot, "components/invitation/live/liveRoutes.ts"), "utf8"));
    expect(links).not.toContain('"/preparation-style"');
    expect(links).not.toContain('"/wedding-code"');
    expect(links).not.toContain("웨딩코드");
    const lounge = withoutComments(readFileSync(path.join(srcRoot, "components/invitation/live/LiveLounge.tsx"), "utf8"));
    expect(lounge).not.toContain('"/wedding-code"');
    expect(lounge).not.toContain("우리의 준비 스타일");
  });

  /**
   * `/wedding-code/c/[code]` 는 이전 판(장면 문항) 글자표만 읽는다. 지금 판 결과가 이 경로로
   * 링크하면 지금 코드를 옛 뜻으로 풀거나 404 를 낸다. 웨딩코드 화면·로직과 사이트맵 어디에서도
   * 이 경로를 만들지 않는지 본다.
   */
  it("지금 웨딩코드 화면과 사이트맵은 이전 판 코드 조회 경로로 링크하지 않는다", () => {
    const scanned = [
      ...sourceFiles(path.join(appRoot, "wedding-code")),
      ...sourceFiles(path.join(srcRoot, "lib", "weddingCode")),
      ...sourceFiles(path.join(srcRoot, "components", "wedding-code")),
      ...sourceFiles(path.join(srcRoot, "components", "app", "preparation-style")),
      path.join(appRoot, "sitemap.ts"),
    ];
    // 측정기가 살아 있는지: 지금 판 결과·공유·함께 보기 파일을 실제로 읽는다.
    for (const required of ["WeddingCodeV31Results.tsx", "WeddingCodeV31Sharing.tsx", "WeddingCodeTogether.tsx", "v31.ts", "sitemap.ts"]) {
      expect(scanned.some((file) => path.basename(file) === required), required).toBe(true);
    }
    const offenders = scanned.filter((file) => {
      const code = withoutComments(readFileSync(file, "utf8"));
      return /wedding-code\/c\b/.test(code) || /["'`]\/c\/|\/c\/\$\{/.test(code);
    });
    expect(offenders.map((file) => path.relative(srcRoot, file))).toEqual([]);
  });
});
