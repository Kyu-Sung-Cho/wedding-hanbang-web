#!/usr/bin/env node
/**
 * `globals.css`의 색 커스텀 프로퍼티를 `@hanbang/design-tokens`에서 다시 만들어 넣는다.
 *
 *   node apps/web/scripts/sync-design-token-css.mjs          # 파일에 기록
 *   node apps/web/scripts/sync-design-token-css.mjs --check   # 어긋나면 exit 1 (기록 안 함)
 *
 * 색을 바꾸려면 `packages/design-tokens/src/colors.ts`를 고치고 이 스크립트를 돌려라.
 * globals.css의 표시 구간을 직접 고치면 다음 실행에서 되돌아가고, 그전에
 * `designTokenCssIsGenerated.test.ts`가 먼저 깨진다.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  WEB_ROOT_COLOR_VARS,
  WEB_SEMANTIC_ROLE_VARS,
  WEB_THEME_COLOR_VARS,
  WEB_THEME_ROLE_VARS,
  WEB_HTML_WORKSPACE_COLOR_VARS,
  WEB_HTML_WORKSPACE_ROLE_VARS,
  WEB_INVITATION_COLOR_VARS,
  WEB_INVITATION_THEME_VARS,
  renderWebCssColorVars,
  webCssManagedEnd,
  webCssManagedStart,
} from "@hanbang/design-tokens";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GLOBALS = path.join(HERE, "..", "src", "app", "globals.css");

const REGIONS = [
  { region: "root", vars: WEB_ROOT_COLOR_VARS, prefix: "" },
  // 역할 변수도 :root에 산다. 브랜드 색과 섞이지 않게 구간을 나눈다 —
  // 브랜드 색은 "무슨 색인가", 역할 변수는 "무슨 일을 하는가"다.
  { region: "roles", vars: WEB_SEMANTIC_ROLE_VARS, prefix: "hb-" },
  { region: "theme", vars: WEB_THEME_COLOR_VARS, prefix: "color-" },
  // 브리지 규칙이 참조하는 값들. 이게 빠져 있으면 토큰을 바꿔도 제품 표면이 안 따라와
  // 색이 둘로 갈린다(2026-08-21 실측).
  { region: "service-theme", vars: WEB_THEME_ROLE_VARS, prefix: "hb-" },
  { region: "community-theme", vars: WEB_THEME_ROLE_VARS, prefix: "hb-" },
  { region: "html-workspace", vars: WEB_HTML_WORKSPACE_COLOR_VARS, prefix: "amora-" },
  { region: "html-workspace-roles", vars: WEB_HTML_WORKSPACE_ROLE_VARS, prefix: "hb-" },
  // 청첩장 디자인(2026-11-17). 정본은 `packages/design-tokens/src/invitation.ts`.
  { region: "invitation", vars: WEB_INVITATION_COLOR_VARS, prefix: "inv-" },
  { region: "invitation-theme", vars: WEB_INVITATION_THEME_VARS, prefix: "color-" },
];

/**
 * 한 구간을 생성 내용으로 교체한다. 표시가 없으면 **끼워 넣지 않고 실패한다** —
 * 표시를 놓을 위치는 사람이 정해야 하고, 스크립트가 짐작해서 넣으면 엉뚱한 곳을 덮는다.
 */
export function applyRegion(source, { region, vars, prefix }, eol) {
  const start = webCssManagedStart(region);
  const end = webCssManagedEnd(region);
  const startAt = source.indexOf(start);
  const endAt = source.indexOf(end);

  if (startAt === -1 || endAt === -1 || endAt < startAt) {
    throw new Error(
      `globals.css에 '${region}' 구간 표시가 없습니다. `
      + `색 선언을 다음 두 줄로 감싸세요:\n  ${start}\n  ${end}`,
    );
  }

  const body = renderWebCssColorVars(vars, { prefix }).split("\n").join(eol);
  const before = source.slice(0, startAt + start.length);
  const after = source.slice(endAt);
  return `${before}${eol}${body}${eol}  ${after}`;
}

export function syncDesignTokenCss(source) {
  const eol = source.includes("\r\n") ? "\r\n" : "\n";
  return REGIONS.reduce((acc, spec) => applyRegion(acc, spec, eol), source);
}

function main() {
  const checkOnly = process.argv.includes("--check");
  const current = readFileSync(GLOBALS, "utf8");
  const next = syncDesignTokenCss(current);

  if (current === next) {
    console.log("globals.css의 색 토큰이 colors.ts와 일치합니다.");
    return;
  }

  if (checkOnly) {
    console.error(
      "globals.css의 색 토큰이 colors.ts와 어긋납니다.\n"
      + "  node apps/web/scripts/sync-design-token-css.mjs 를 실행하세요.",
    );
    process.exit(1);
  }

  writeFileSync(GLOBALS, next);
  console.log("globals.css의 색 토큰을 colors.ts 기준으로 갱신했습니다.");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
