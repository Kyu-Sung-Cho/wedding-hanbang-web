import { colors } from "./colors";

/**
 * 웹 `globals.css`의 색 커스텀 프로퍼티를 **토큰에서 만들어낸다.**
 *
 * ## 왜 이 파일이 있는가
 *
 * 2026-08-20까지 웹은 `@hanbang/design-tokens`를 package.json에 의존성으로 적어두고
 * **0개 파일에서 import 했다**(모바일은 49개). 팔레트는 `globals.css`의 `:root`와
 * `@theme inline`에 손으로 복사돼 있었고, 값은 우연히 맞았지만 **키가 이미 갈려 있었다** —
 * `rose-700`·`ivory-blush`·`danger-700`은 globals에만, `adSponsored`는 토큰에만 있었다.
 *
 * 그래서 "디자인을 확정하면 토큰 값만 바꾸면 된다"가 성립하지 않았다. 두 곳을 손으로
 * 맞춰야 했고, 맞는지 확인할 방법도 없었다.
 *
 * ## 어떻게 쓰는가
 *
 * `apps/web/scripts/sync-design-token-css.mjs`가 이 파일이 만든 문자열로 `globals.css`의
 * 표시된 구간을 갈아끼운다. `designTokenCssIsGenerated.test.ts`가 파일 내용과 여기서
 * 만든 문자열이 같은지 검사하므로, 한쪽만 손으로 고치면 테스트가 깨진다.
 *
 * 색을 바꾸려면 `colors.ts`를 고치고 sync 스크립트를 돌려라. globals.css를 직접 고치면
 * 다음 sync에서 되돌아간다.
 *
 * ## 두 구간의 키 집합이 다른 이유
 *
 * `:root`에는 `rose-glow`가 있고 `rose-700`·`ivory-blush`가 없다. `@theme inline`은 그
 * 반대다. 이건 정리되지 않은 과거지만 **지금 맞추지 않는다** — `@theme inline`에 키를
 * 더하면 Tailwind가 없던 유틸리티(`bg-rose-glow` 등)를 새로 만들어내기 때문이다.
 * 배관을 놓는 이 단계에서는 화면과 산출물을 그대로 두는 것이 우선이다.
 */

export type WebCssColorVar = {
  /** `--` 뒤에 오는 이름. `@theme inline`에서는 `--color-` 접두사가 붙는다. */
  readonly name: string;
  readonly value: string;
  /** 이 항목 **앞에** 들어갈 섹션 주석. 원본 globals.css의 구획을 유지한다. */
  readonly section?: string;
};

/** `:root` 구간. 참조용 원시 변수라 Tailwind 유틸리티를 만들지 않는다. */
export const WEB_ROOT_COLOR_VARS: readonly WebCssColorVar[] = [
  { name: "noir-800", value: colors.noir[800], section: "Primary - Eucalyptus Ink" },
  { name: "noir-900", value: colors.noir[900] },
  { name: "noir-soft", value: colors.noir.soft },
  { name: "charcoal", value: colors.noir.charcoal },

  { name: "rose-500", value: colors.rose[500], section: "Accent - Dusty Mauve" },
  { name: "rose-600", value: colors.rose[600] },
  { name: "rose-light", value: colors.rose.light },
  { name: "rose-pale", value: colors.rose.pale },
  { name: "rose-glow", value: colors.rose.glow },

  { name: "ivory-50", value: colors.ivory[50], section: "Background - Pearl Ivory" },
  { name: "ivory-100", value: colors.ivory[100] },
  { name: "ivory-200", value: colors.ivory[200] },
  { name: "ivory-warm", value: colors.ivory.warm },
  { name: "ivory-deep", value: colors.ivory.deep },
  { name: "surface-low", value: colors.surfaceLow },
  { name: "stone-900", value: colors.stone[900] },

  { name: "taupe-400", value: colors.taupe[400], section: "Taupe" },
  { name: "taupe-500", value: colors.taupe[500] },

  { name: "sage-500", value: colors.sage[500], section: "Sage" },
  { name: "sage-pale", value: colors.sage.pale },

  { name: "danger-500", value: colors.danger, section: "Semantic danger" },
  { name: "danger-700", value: colors.dangerDeep },

  { name: "gold", value: colors.gold.DEFAULT, section: "Champagne Taupe" },
  { name: "gold-light", value: colors.gold.light },

  { name: "platinum", value: colors.platinum, section: "Platinum" },
];

/**
 * `@theme inline` 구간. 여기 있는 이름이 곧 Tailwind 유틸리티가 된다
 * (`--color-rose-500` → `text-rose-500`). **키를 더하면 산출 CSS가 커진다.**
 */
export const WEB_THEME_COLOR_VARS: readonly WebCssColorVar[] = [
  { name: "noir-800", value: colors.noir[800], section: "Colors" },
  { name: "noir-900", value: colors.noir[900] },
  { name: "noir-soft", value: colors.noir.soft },
  { name: "charcoal", value: colors.noir.charcoal },

  { name: "rose-500", value: colors.rose[500], section: "" },
  { name: "rose-600", value: colors.rose[600] },
  { name: "rose-700", value: colors.rose[700] },
  { name: "rose-light", value: colors.rose.light },
  { name: "rose-pale", value: colors.rose.pale },

  { name: "ivory-50", value: colors.ivory[50], section: "" },
  { name: "ivory-100", value: colors.ivory[100] },
  { name: "ivory-200", value: colors.ivory[200] },
  { name: "ivory-warm", value: colors.ivory.warm },
  { name: "ivory-blush", value: colors.ivory.blush },
  { name: "ivory-deep", value: colors.ivory.deep },
  { name: "surface-low", value: colors.surfaceLow },
  { name: "stone-900", value: colors.stone[900] },

  { name: "taupe-400", value: colors.taupe[400], section: "" },
  { name: "taupe-500", value: colors.taupe[500] },

  { name: "sage-500", value: colors.sage[500], section: "" },
  { name: "sage-pale", value: colors.sage.pale },

  { name: "danger-500", value: colors.danger, section: "" },
  { name: "danger-700", value: colors.dangerDeep },

  { name: "gold", value: colors.gold.DEFAULT, section: "" },
  { name: "gold-light", value: colors.gold.light },

  { name: "platinum", value: colors.platinum, section: "" },
];

/**
 * 관리 구간의 표시. 스크립트와 테스트가 같은 문자열을 본다.
 *
 * 구간이 둘인 이유는 `:root`와 `@theme inline`의 키 집합이 다르기 때문이다(위 주석 참고).
 */
export type WebCssRegion = "root" | "theme";

export function webCssManagedStart(region: WebCssRegion): string {
  return "/* @generated:design-tokens " + region
    + " start — colors.ts에서 생성됩니다. 직접 고치지 마세요. */";
}

export function webCssManagedEnd(region: WebCssRegion): string {
  return "/* @generated:design-tokens " + region + " end */";
}

/**
 * 커스텀 프로퍼티 선언들을 CSS 문자열로 만든다. 줄바꿈은 `\n`으로만 낸다 —
 * 파일에 쓸 때 그 파일의 줄바꿈 방식으로 바꾸는 것은 호출자 몫이다.
 */
export function renderWebCssColorVars(
  vars: readonly WebCssColorVar[],
  options: { readonly prefix?: string; readonly indent?: string } = {},
): string {
  const prefix = options.prefix ?? "";
  const indent = options.indent ?? "  ";
  const lines: string[] = [];

  vars.forEach((entry, index) => {
    if (entry.section !== undefined) {
      if (index > 0) lines.push("");
      if (entry.section !== "") lines.push(`${indent}/* ${entry.section} */`);
    }
    lines.push(`${indent}--${prefix}${entry.name}: ${entry.value};`);
  });

  return lines.join("\n");
}
