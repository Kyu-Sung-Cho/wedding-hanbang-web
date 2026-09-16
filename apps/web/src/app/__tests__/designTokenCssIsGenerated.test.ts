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
    for (const region of ["root", "roles", "theme", "html-workspace", "html-workspace-roles"]) {
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
    //
    // 2026-08-28: 역할이 유칼립투스에서 **종이**로 옮겨졌다(파운더 결정 — 랜딩의
    // 표면 언어를 제품 전체로). 지키는 계약은 그대로다: 값이 아니라 **토큰 경로**를
    // 박으므로, 생성기가 상수를 뱉기 시작하면 여전히 여기서 걸린다.
    //
    // 2026-09-16: **채움과 글자가 갈렸다**(파운더 결정 — "검정처럼 어두운 색 말고").
    // 누를 수 있는 면은 더스티 모브로 가고, 읽는 글자는 잉크로 남는다. 여기서도
    // 지키는 계약은 그대로다 — 값이 아니라 토큰 경로를 박는다. 아래 두 줄이
    // rose 를 가리키고 `--hb-text-muted` 가 여전히 paper 를 가리키는 것이 그 분리다.
    expect(current).toContain(`--hb-primary: ${colors.rose[600]};`);
    expect(current).toContain(`--hb-primary-hover: ${colors.rose[700]};`);
    expect(current).toContain(`--hb-hairline: ${colors.paper.edge};`);
    expect(current).toContain(`--hb-text-muted: ${colors.paper.inkFaint};`);

    // 브리지 규칙이 참조하는 테마 블록 값도 같은 토큰에서 나와야 한다.
    // `--hb-navy` 는 배경·그라디언트 전용이라(글자로 쓰이는 곳 0곳) 채움 쪽을 따른다.
    expect(current).toContain(`--hb-navy: ${colors.rose[600]};`);
    expect(current).toContain(`--hb-line: ${colors.paper.edge};`);
  });

  it("`:root`와 테마 블록이 같은 표면 언어를 쓴다", () => {
    // 2026-08-21 사고의 **다른 절반**이다. 그때 고친 것은 "테마 블록도 토큰에서
    // 생성한다"였는데, 두 목록이 각각 토큰에서 생성되면서도 **서로 다른 토큰을**
    // 가리키면 색은 여전히 둘로 갈린다. 위 테스트는 그것을 못 잡는다 — 둘 다
    // "토큰에서 나온" 값이기 때문이다.
    //
    // 뜻이 겹치는 역할끼리 값이 같은지 본다. 이름이 다른 이유는 브리지 규칙 65개가
    // 옛 이름(`navy`·`gold`)을 참조하기 때문이고, 브리지를 걷어낼 때 함께 사라진다.
    const current = readFileSync(GLOBALS, "utf8");

    const region = (name: string): string => {
      const start = current.indexOf(`@generated:design-tokens ${name} start`);
      const end = current.indexOf(`@generated:design-tokens ${name} end`, start);
      expect(start, `${name} 구간을 찾지 못했습니다`).toBeGreaterThan(-1);
      expect(end, `${name} 구간의 끝을 찾지 못했습니다`).toBeGreaterThan(start);
      return current.slice(start, end);
    };

    const valueOf = (block: string, name: string): string => {
      const found = new RegExp(`--hb-${name}:\\s*([^;]+);`, "u").exec(block);
      expect(found, `--hb-${name} 를 찾지 못했습니다`).toBeTruthy();
      return (found?.[1] ?? "").trim();
    };

    const roles = region("roles");
    for (const theme of ["service-theme", "community-theme"]) {
      const block = region(theme);
      // [ :root 이름, 테마 블록 이름 ] — 같은 뜻을 지는 짝
      for (const [rootName, themeName] of [
        ["text-strong", "text"],
        ["text-body", "body"],
        ["text-muted", "muted"],
        ["hairline", "line"],
        ["surface-hover", "ivory-warm"],
      ]) {
        expect(
          valueOf(block, themeName),
          `${theme} 의 --hb-${themeName} 가 :root 의 --hb-${rootName} 와 다릅니다 — `
            + "같은 뜻인데 색이 갈리면 화면이 두 언어로 나뉩니다.",
        ).toBe(valueOf(roles, rootName));
      }
    }
  });

  it("`--hb-*`가 관리 구간 밖에서 손으로 정의되지 않는다", () => {
    // 2026-08-21에 실제로 당한 것: `:root`의 역할 변수만 생성되고, 브리지가 참조하는
    // 테마 블록의 `--hb-navy` 등 12개는 손으로 박혀 있었다. `colors.ts`를 빨강으로
    // 바꾸고 sync를 돌리면 **Button만 빨개지고 제품 표면 전부는 초록으로 남는다.**
    // 그때 가드 3개가 전부 초록이었다 — 아무도 색이 갈린 것을 몰랐다.
    //
    // 이 테스트는 그 구멍을 막는다. `--hb-*`를 새로 만들면 생성 구간 안에 넣어야 한다.
    const current = readFileSync(GLOBALS, "utf8");
    const managed: Array<[number, number]> = [];
    for (const match of current.matchAll(/@generated:design-tokens (\S+) start/g)) {
      const endMarker = `@generated:design-tokens ${match[1]} end`;
      const endAt = current.indexOf(endMarker, match.index ?? 0);
      if (endAt !== -1) managed.push([match.index ?? 0, endAt]);
    }
    expect(managed.length, "생성 구간 표시를 못 찾았습니다").toBeGreaterThan(3);

    // 아래에서 `--hb-*`를 **하나도 못 찾으면** stray가 빈 배열이 되어 이 테스트가
    // 조용히 통과한다. 접두사를 바꾸거나 정규식이 상하면 그 순간 가드가 꺼지는데,
    // 실패 메시지는 없다. 이 세션에 같은 모양의 함정을 실제로 한 번 당했다 —
    // 온보딩 6스텝 워크 테스트가 스텝 본문을 통째로 지워도 초록이었다.
    // 그래서 "세는 대상이 실재하는가"를 먼저 못 박는다. 실측 34개(2026-08-21).
    const definitions = [...current.matchAll(/--hb-[a-z0-9-]+:\s*[^;]+;/g)];
    expect(
      definitions.length,
      "`--hb-*` 정의를 거의 못 찾았습니다 — 접두사나 정규식이 바뀌었는지 보세요. 그대로 두면 이 가드는 꺼진 채 초록입니다.",
    ).toBeGreaterThan(20);

    const inManaged = (at: number) => managed.some(([s, e]) => at >= s && at <= e);
    const stray: string[] = [];
    for (const match of definitions) {
      if (!inManaged(match.index ?? 0)) stray.push(match[0].trim());
    }

    expect(
      stray,
      `관리 구간 밖에서 정의된 \`--hb-*\` ${stray.length}개입니다. `
        + `여기에 두면 colors.ts를 바꿔도 따라오지 않아 색이 둘로 갈립니다.`,
    ).toEqual([]);
  });
});
