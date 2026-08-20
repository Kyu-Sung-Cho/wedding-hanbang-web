import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { colors } from "@hanbang/design-tokens";

import { syncDesignTokenCss } from "../../../scripts/sync-design-token-css.mjs";

/**
 * 웹 팔레트는 **토큰 패키지에서 생성된다.**
 *
 * ## 무엇이 문제였나
 *
 * 2026-08-20까지 `apps/web`은 `@hanbang/design-tokens`를 package.json 의존성으로 적어두고
 * **0개 파일에서 import 했다**. 모바일은 49개 파일에서 쓰고 있었다. 웹 팔레트는
 * `globals.css`의 `:root`와 `@theme inline`에 손으로 복사돼 있었다.
 *
 * 값은 그날 기준으로 서로 맞았지만 **키가 이미 갈라져 있었다** — `rose-700`,
 * `ivory-blush`, `danger-700`은 globals.css에만 있었고 `adSponsored`는 토큰에만 있었다.
 * 지키는 장치가 없었으니 값이 갈리는 것도 시간 문제였다.
 *
 * 그래서 "디자인을 확정하면 토큰 값만 바꾸면 된다"가 거짓이었다. 이 테스트가 그 문장을
 * 참으로 만든다.
 *
 * ## 깨졌다면
 *
 * `globals.css`를 직접 고쳤거나 `colors.ts`를 고치고 sync를 안 돌린 것이다.
 *
 *   npx pnpm@11.7.0 --filter @hanbang/web tokens:sync
 *
 * 색을 바꾸는 정본은 `packages/design-tokens/src/colors.ts` 하나다.
 */

const GLOBALS = path.join(process.cwd(), "src/app/globals.css");

describe("웹 팔레트는 토큰에서 생성된다", () => {
  it("globals.css가 colors.ts와 어긋나지 않는다", () => {
    const current = readFileSync(GLOBALS, "utf8");

    expect(
      syncDesignTokenCss(current),
      "globals.css의 색 토큰이 colors.ts와 어긋납니다. "
        + "`--filter @hanbang/web tokens:sync`를 실행하세요.",
    ).toBe(current);
  });

  it("관리 구간 표시가 살아 있다", () => {
    // 표시가 사라지면 sync가 **던지므로** 위 테스트도 함께 깨진다. 다만 그때 나오는
    // 메시지가 "어긋남"이라 원인을 잘못 짚기 쉬워서, 여기서 따로 이름을 붙여둔다.
    const current = readFileSync(GLOBALS, "utf8");
    // `roles`가 빠져 있었다(2026-08-20 적대 검토). 구간 표시가 사라지면 sync가 던지긴
    // 하지만, 목록에 없으면 "이 구간이 관리 대상이다"라는 사실 자체가 기록되지 않는다.
    for (const region of ["root", "roles", "theme"]) {
      expect(current, `${region} 구간 시작 표시가 없습니다`).toContain(
        `@generated:design-tokens ${region} start`,
      );
      expect(current, `${region} 구간 끝 표시가 없습니다`).toContain(
        `@generated:design-tokens ${region} end`,
      );
    }
  });

  it("생성된 값이 실제로 토큰에서 나온다", () => {
    // 생성기가 토큰을 읽지 않고 상수를 내뱉어도 위 두 테스트는 통과한다.
    // 토큰 값이 실제로 CSS에 실려 나가는지 여기서 확인한다.
    const current = readFileSync(GLOBALS, "utf8");
    expect(current).toContain(`--rose-500: ${colors.rose[500]};`);
    expect(current).toContain(`--color-rose-700: ${colors.rose[700]};`);
    expect(current).toContain(`--color-ivory-blush: ${colors.ivory.blush};`);
    expect(current).toContain(`--danger-700: ${colors.dangerDeep};`);

    // 역할 변수도 같은 사각지대에 있었다 — 생성기가 토큰을 안 읽고 상수를 뱉어도
    // 위 두 테스트는 통과한다. Button이 실제로 쓰는 값들을 여기서 못 박는다.
    expect(current).toContain(`--hb-primary: ${colors.noir[800]};`);
    expect(current).toContain(`--hb-primary-hover: ${colors.noir.pressed};`);
    expect(current).toContain(`--hb-hairline: ${colors.border};`);
    expect(current).toContain(`--hb-text-muted: ${colors.textTertiary};`);
  });
});
