import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { stripComments } from "../../testing/sourceText";

// 가족 조율 페이지는 2026-07-26에 제거했다. 2026-08-11 파운더 결정으로 출처 계약을
// 통과한 `/manners` 가이드는 별도 표면이 됐지만, 삭제된 `/etiquette` 코퍼스와 모바일
// 404 링크는 되살리지 않는다. 이 테스트는 그 레거시 경계를 계속 지킨다.
const webRoot = process.cwd();
const source = (path: string): string => readFileSync(resolve(webRoot, path), "utf8");

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const fullPath = join(directory, entry);
    if (statSync(fullPath).isDirectory()) return sourceFiles(fullPath);
    if (!/\.tsx?$/.test(entry) || /\.test\.tsx?$/.test(entry)) return [];
    return [fullPath];
  });
}

describe("removed family-coordination page", () => {
  it("keeps the route deleted", () => {
    expect(existsSync(resolve(webRoot, "src/app/(community)/etiquette/page.tsx"))).toBe(false);
    expect(existsSync(resolve(webRoot, "src/app/(community)/etiquette/layout.tsx"))).toBe(false);
    expect(source("src/app/sitemap.ts")).not.toContain("/etiquette");
  });

  it("leaves no link pointing at the removed route", () => {
    const offenders = sourceFiles(resolve(webRoot, "src"))
      .filter((file) => /["'`]\/(wedding\/)?etiquette(["'`/])/.test(readFileSync(file, "utf8")))
      .map((file) => relative(webRoot, file));
    expect(offenders).toEqual([]);
  });

  // 이 가드는 apps/web만 훑고 있었다. 그 사이 모바일 앱은 "예절 가이드" 메뉴에서
  // `https://hanbang.ai/etiquette`를 웹뷰로 열고 있었다 — 2026-07-26 이후 계속 404다.
  // 웹에서 라우트를 지우면 앱에도 죽은 링크가 남는다. 같이 지킨다.
  it("leaves no mobile entry pointing at the removed route", () => {
    const mobileRoot = resolve(webRoot, "..", "mobile");
    const offenders = [
      ...sourceFiles(resolve(mobileRoot, "app")),
      ...sourceFiles(resolve(mobileRoot, "src")),
    ]
      .filter((file) => !file.includes("__tests__"))
      // 주석은 대상이 아니다 — 왜 지웠는지 설명을 남길 수 있어야 한다.
      .filter((file) => /etiquette/i.test(stripComments(readFileSync(file, "utf8"))))
      .map((file) => relative(mobileRoot, file));

    expect(
      offenders,
      `모바일에 지워진 예절 라우트 참조가 남았다: ${offenders.join(", ")}`,
    ).toEqual([]);
  });

  it("does not retain the unsupported legacy corpus as reactivatable dead code", () => {
    expect(existsSync(resolve(webRoot, "src/constants/etiquetteData.ts"))).toBe(false);
    expect(existsSync(resolve(webRoot, "src/components/app/etiquette/EtiquetteClient.tsx"))).toBe(false);
    expect(existsSync(resolve(webRoot, "src/components/app/etiquette/EtiquetteSeoContent.tsx"))).toBe(false);
    expect(source("src/lib/ai/prompts.ts")).not.toContain("예절 관련 답변 시 `[etiquette:번호]`");
  });
});
