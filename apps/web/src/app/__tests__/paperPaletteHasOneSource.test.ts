// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { colors } from "@hanbang/design-tokens";

/**
 * 종이 팔레트가 **두 곳에 중복**돼 있다 — 그 둘이 갈리지 않는가.
 *
 * ## 무엇이 있었나
 *
 * 팔레트 값은 `packages/design-tokens/src/colors.ts` 의 `colors.paper` 에 있고,
 * 화면이 실제로 쓰는 것은 `apps/web/src/app/globals.css` 의 `--color-paper-*` 다.
 * 후자는 전자에서 **생성되지 않고 손으로 적혀 있다.**
 *
 * 2026-08-29 에 실제로 당했다. 선 버튼 테두리가 대비 기준 미달(1.60:1)이라
 * `colors.ts` 를 고쳤는데 **화면은 그대로였다** — `globals.css` 가 옛 값을 들고
 * 있었기 때문이다. 토큰만 고치고 "고쳤다"고 넘어갔다면 접근성 수정이 코드에만
 * 있고 사용자에게는 없는 상태가 됐을 것이다.
 *
 * ## 왜 합치지 않았나
 *
 * `globals.css` 는 Tailwind v4 의 `@theme` 안에서 유틸리티 이름을 만들어 낸다.
 * 빌드 시점에 TS 값을 주입하려면 CSS 생성 단계가 필요하고, 그건 이 변경의 범위를
 * 넘는다. 그래서 **중복은 남기되 갈라지지 못하게** 한다.
 */
describe("종이 팔레트 정본이 하나다", () => {
  const css = readFileSync(
    resolve(process.cwd(), "src/app/globals.css"),
    "utf8",
  );

  /** `inkSoft` → `ink-soft` */
  const kebab = (name: string) => name.replace(/([a-z0-9])([A-Z])/gu, "$1-$2").toLowerCase();

  const cssVars = new Map(
    [...css.matchAll(/--color-paper-([a-z0-9-]+):\s*(#[0-9A-Fa-f]{6})/gu)].map(
      (m) => [m[1], m[2].toUpperCase()] as const,
    ),
  );

  it("측정기가 살아 있다", () => {
    // 정규식이 낡아 0개를 읽으면 아래 검사가 전부 공짜로 통과한다.
    expect(cssVars.size, "globals.css 에서 --color-paper-* 를 못 읽었다").toBeGreaterThan(10);
    expect(Object.keys(colors.paper).length, "colors.paper 가 비었다").toBeGreaterThan(10);
  });

  it("globals.css 의 값이 colors.paper 와 같다", () => {
    const drift: string[] = [];
    for (const [name, value] of Object.entries(colors.paper)) {
      const key = kebab(name);
      const inCss = cssVars.get(key);
      if (!inCss) continue; // CSS 에 안 실린 토큰은 아래 검사가 따로 본다
      if (inCss !== value.toUpperCase()) {
        drift.push(`--color-paper-${key}: globals.css=${inCss} · colors.ts=${value.toUpperCase()}`);
      }
    }
    expect(
      drift,
      "팔레트가 두 곳에서 갈렸다. 화면이 쓰는 것은 globals.css 이므로, 토큰만 고치면 "
        + "사용자에게는 아무것도 바뀌지 않는다.",
    ).toEqual([]);
  });

  it("CSS 에만 있는 종이 변수는 없다", () => {
    // 반대 방향도 막는다 — CSS 에만 있는 값은 정본이 없는 색이다.
    const orphans = [...cssVars.keys()].filter(
      (key) => !Object.keys(colors.paper).some((name) => kebab(name) === key),
    );
    expect(orphans, "colors.paper 에 없는 종이 변수가 globals.css 에 있다").toEqual([]);
  });

  it("선 버튼 테두리는 컨트롤 경계 대비(3:1)를 지킨다", () => {
    // 이 토큰은 장식이 아니다. 테두리 버튼은 이 선 하나로 "누를 수 있는 것"이 된다.
    // 값을 밝게 되돌리면 버튼이 버튼으로 안 읽힌다(2026-08-29 이전 상태: 1.60:1).
    const luminance = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
      const channel = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
      return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    };
    const ratio = (a: string, b: string) => {
      const [x, y] = [luminance(a), luminance(b)];
      return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
    };

    // 계산기 자가검증 — 아는 답으로 먼저 잰다.
    expect(Math.round(ratio("#FFFFFF", "#000000")), "대비 계산기가 틀렸다").toBe(21);

    // 버튼이 실제로 앉는 세 지면 모두에서 3:1.
    for (const surface of [colors.paper.sheet, colors.paper.card, colors.paper.tint]) {
      expect(
        ratio(colors.paper.outline, surface),
        `선 버튼 테두리가 ${surface} 위에서 3:1 미만이다`,
      ).toBeGreaterThanOrEqual(3);
    }
  });
});
