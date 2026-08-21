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
 * **역할(role) 변수.** 위의 `WEB_ROOT_COLOR_VARS`가 "이 색은 무엇인가"(rose-600)라면,
 * 이쪽은 "이 색은 무슨 일을 하는가"(누를 수 있는 것의 바탕)를 말한다.
 *
 * ## 왜 필요한가 — globals.css의 `!important` 96개가 여기서 나왔다
 *
 * 컴포넌트들이 색 리터럴을 직접 들고 있어서, 로그인 후 화면을 유칼립투스로 맞추려면
 * `[class~="bg-rose-500"] { background: ... !important }` 처럼 **리터럴을 힘으로 덮는**
 * 수밖에 없었다. 역할 변수가 있으면 그럴 필요가 없다 — 컴포넌트는 역할만 말하고,
 * 컨텍스트가 값을 정한다. 브리지는 시맨틱 토큰의 대용품이었다.
 *
 * ## 기본값이 유칼립투스인 이유
 *
 * 브리지가 존재하는 목적 자체가 "제품 표면을 유칼립투스로 강제"하는 것이다. 즉 제품의
 * 기본 정체는 유칼립투스이고 **랜딩이 예외**다. 그래서 `:root`에 유칼립투스를 두고,
 * 랜딩의 로즈는 지금처럼 자기 클래스를 유지한다. 이 순서라야 프리미티브를 채택해도
 * 화면이 안 바뀐다.
 *
 * 나중에 "랜딩도 제품과 같은 색으로" 또는 그 반대 결정이 나오면, 그 컨텍스트에서
 * 이 변수만 재정의하면 된다. 컨텍스트별 재정의가 실제로 동작하는 것은 확인했다 —
 * 같은 유틸리티 클래스가 `.hanbang-service-theme` 안팎에서 다른 색을 낸다.
 */
export const WEB_SEMANTIC_ROLE_VARS: readonly WebCssColorVar[] = [
  {
    name: "primary",
    value: colors.noir[800],
    section: "역할 — 누를 수 있는 것 (기본값은 제품 정체인 유칼립투스)",
  },
  { name: "primary-hover", value: colors.noir.pressed },
  { name: "on-primary", value: colors.surface },

  { name: "focus-ring", value: colors.noir[800], section: "역할 — 초점" },

  {
    name: "surface-raised",
    value: colors.surface,
    section: "역할 — 표면과 경계",
  },
  { name: "surface-hover", value: colors.ivory.warm },
  { name: "hairline", value: colors.border },

  { name: "text-strong", value: colors.textPrimary, section: "역할 — 글자" },
  { name: "text-body", value: colors.textSecondary },
  { name: "text-muted", value: colors.textTertiary },
];

/**
 * 관리 구간의 표시. 스크립트와 테스트가 같은 문자열을 본다.
 *
 * `root`/`theme`은 `:root`와 `@theme inline`의 브랜드 색이고(키 집합이 다르다, 위 참고),
 * `roles`는 `:root`의 역할 변수다.
 */
export type WebCssRegion = "root" | "theme" | "roles";

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
