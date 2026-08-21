import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * 상단 내비의 화면 안 앵커가 **실제로 어딘가로 간다.**
 *
 * ## 무엇이 있었나
 *
 * `CustomerNav.handleClick` 은 `preventDefault()` 를 먼저 부르고, 타깃을 못 찾으면
 * 그냥 반환했다. 그래서 `/beta` 와 `/demo` 의 "베타 신청" 버튼은 **눌러도 아무 일도
 * 일어나지 않았다** — `id="cta"` 는 `/about` 에만 있었기 때문이다.
 *
 * 스스로 링크해 둔 곳이 죽어 있는 것은 사용자가 "이 서비스는 고장났다"고 읽는 종류의
 * 실패다. 그런데 오류도 로그도 없어서 아무도 모른다.
 *
 * ## 무엇을 지키나
 *
 * 두 가지다.
 * 1. 내비가 쓰는 `#앵커` 는 **그 앵커를 렌더하는 화면이 저장소에 실재**해야 한다.
 * 2. 못 찾았을 때 **조용히 끝나지 않아야** 한다.
 */
describe("내비의 화면 안 앵커", () => {
  const webRoot = process.cwd();
  const read = (relative: string) => readFileSync(resolve(webRoot, relative), "utf8");

  const NAV = "src/components/customer-landing/CustomerNav.tsx";

  it("측정기가 살아 있다", () => {
    const nav = read(NAV);
    expect(nav.length).toBeGreaterThan(500);
    expect(nav, "내비에 navLinks 가 있어야 합니다").toMatch(/navLinks\s*=/u);
  });

  /** 내비가 쓰는 화면 안 앵커들(`#...`). 목록을 손으로 적지 않고 소스에서 뽑는다. */
  function anchorsInNav(): string[] {
    const nav = read(NAV);
    const at = nav.indexOf("navLinks");
    const block = nav.slice(at, nav.indexOf("];", at));
    return [...block.matchAll(/href:\s*"(#[A-Za-z0-9_-]+)"/gu)].map((m) => m[1]);
  }

  it("앵커를 실제로 쓰고 있다", () => {
    // 앵커가 0개면 아래 검사가 조용히 통과한다. 그쪽을 먼저 막는다.
    expect(
      anchorsInNav().length,
      "내비에서 화면 안 앵커를 못 찾았습니다 — 링크 정의 모양이 바뀌었는지 보세요",
    ).toBeGreaterThan(0);
  });

  it("모든 앵커가 저장소 어딘가에서 실제로 렌더된다", () => {
    // 앵커를 렌더하는 곳을 저장소에서 찾는다. 못 찾으면 그 링크는 영원히 죽어 있다.
    const roots = ["src/app", "src/components"];
    const sources: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSyncSafe(resolve(webRoot, dir))) {
        const rel = `${dir}/${entry.name}`;
        if (entry.isDirectory()) {
          if (entry.name === "node_modules" || entry.name === "__tests__") continue;
          walk(rel);
        } else if (/\.tsx$/.test(entry.name) && !/\.test\.tsx$/.test(entry.name)) {
          sources.push(read(rel));
        }
      }
    };
    roots.forEach(walk);
    expect(sources.length, "화면 소스를 못 읽었습니다").toBeGreaterThan(50);

    const dead = anchorsInNav().filter((anchor) => {
      const id = anchor.slice(1);
      return !sources.some((src) => src.includes(`id="${id}"`));
    });

    expect(
      dead,
      `내비가 가리키는 앵커가 어디에도 없습니다: ${dead.join(", ")}. `
        + "그 버튼은 눌러도 아무 일이 일어나지 않습니다.",
    ).toEqual([]);
  });

  it("폴백이 보내는 화면에 그 앵커가 실제로 있다", () => {
    // "저장소 어딘가에 있다"만으로는 부족하다. 폴백은 특정 화면으로 보내는데, 그
    // 화면에 앵커가 없으면 이동만 하고 아무 데도 안 간다 — 사용자 눈에는 여전히
    // 아무 일도 안 일어난 것이다. (이 검사가 없을 때 실제로 그 변형을 놓쳤다.)
    const nav = read(NAV);
    const home = /const SCROLL_ANCHOR_HOME = "([^"]+)"/u.exec(nav)?.[1];
    expect(home, "폴백 목적지 상수를 못 찾았습니다").toBeTruthy();

    const page = `src/app${home}/page.tsx`;
    let source = "";
    expect(() => { source = read(page); }, `폴백 목적지 화면이 없습니다: ${page}`).not.toThrow();

    for (const anchor of anchorsInNav()) {
      expect(
        source,
        `폴백이 ${home} 로 보내는데 그 화면에 ${anchor} 가 없습니다. `
          + "이동은 하지만 아무 데도 안 갑니다.",
      ).toContain(`id="${anchor.slice(1)}"`);
    }
  });

  it("앵커를 못 찾았을 때 조용히 끝나지 않는다", () => {
    const nav = read(NAV);
    const at = nav.indexOf("function handleClick");
    expect(at, "handleClick 을 못 찾았습니다").toBeGreaterThan(-1);

    // 함수 본문만 정확히 떼어낸다. 창을 넓게 잡으면 주변 코드를 집는다.
    const open = nav.indexOf("{", at);
    let depth = 0;
    let end = open;
    for (let i = open; i < nav.length; i += 1) {
      if (nav[i] === "{") depth += 1;
      else if (nav[i] === "}") {
        depth -= 1;
        if (depth === 0) { end = i + 1; break; }
      }
    }
    const body = nav.slice(open, end);

    expect(body, "preventDefault 를 부른다면 대체 경로가 있어야 합니다").toMatch(
      /preventDefault\(\)/u,
    );
    expect(
      body,
      "타깃을 못 찾았을 때 갈 곳이 없습니다. `preventDefault()` 뒤에 그냥 반환하면 "
        + "브라우저 기본 이동까지 막혀 버튼이 완전히 죽습니다.",
    ).toMatch(/window\.location|router\.(push|replace)/u);
  });
});

/** 디렉터리를 읽되 없으면 빈 목록. 테스트가 경로 오타로 조용히 통과하지 않게 위에서 개수를 단언한다. */
function readdirSyncSafe(dir: string): Array<{ name: string; isDirectory: () => boolean }> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { readdirSync } = require("node:fs") as typeof import("node:fs");
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}
