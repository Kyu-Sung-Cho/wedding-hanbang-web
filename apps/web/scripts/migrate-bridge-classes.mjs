#!/usr/bin/env node
/**
 * 테마 브리지가 `!important`로 덮고 있는 색 리터럴 클래스를, 같은 값을 내는
 * **역할 변수 클래스**로 바꾼다. 바꾸고 나면 그 브리지 규칙은 아무 요소에도 걸리지
 * 않게 되고, `themeBridgeHasNoDeadRules` 테스트가 "이제 지워도 된다"고 알려준다.
 *
 *   node apps/web/scripts/migrate-bridge-classes.mjs --list
 *   node apps/web/scripts/migrate-bridge-classes.mjs --check <파일...>
 *   node apps/web/scripts/migrate-bridge-classes.mjs <파일...>
 *
 * ## 매핑을 손으로 적지 않는다
 *
 * 매핑은 `globals.css`의 브리지 규칙에서 **실행 시점에 읽어낸다.** 손으로 표를 적어두면
 * 브리지가 바뀔 때 조용히 어긋나고, 어긋난 표로 색을 칠하면 화면이 틀어진다.
 *
 * ## 왜 브리지 안 파일만 바꾸는가
 *
 * `text-[#1A1A1F]`는 브리지 **안에서만** `#263832`로 보인다. 밖에서는 `#1A1A1F` 그대로다.
 * 그래서 밖에 있는 파일을 바꾸면 색이 실제로 달라진다. 범위를 벗어난 파일은 거부한다.
 *
 * 2026-08-20 실측으로 확인한 것:
 *   - 브리지 밖(랜딩·price)은 `components/app|community`를 import 하지 않는다
 *   - 예외가 하나 있다 — `app/start-here/page.tsx`가 `components/community/StartHereClient`를
 *     쓴다. 그 파일은 브리지 밖에서 렌더되므로 아래 EXCLUDED에 넣는다.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.join(HERE, "..");
const GLOBALS = path.join(WEB_ROOT, "src", "app", "globals.css");

const SEP = path.sep;

/** 브리지가 실제로 적용되는 곳. 이 밖의 파일은 바꾸지 않는다. */
const SCOPE = [
  `src${SEP}app${SEP}(app)${SEP}`,
  `src${SEP}app${SEP}(community)${SEP}`,
  `src${SEP}components${SEP}app${SEP}`,
  `src${SEP}components${SEP}community${SEP}`,
];

/** 범위 안에 있지만 브리지 밖에서도 렌더되는 파일. */
const EXCLUDED = [`src${SEP}components${SEP}community${SEP}StartHereClient.tsx`];

/**
 * `globals.css`에서 브리지 규칙을 읽어 `클래스 → 역할 변수` 표를 만든다.
 * 값이 어떤 역할 변수와도 일치하지 않으면 그 클래스는 **매핑하지 않는다** —
 * 짐작해서 가까운 색으로 칠하면 그게 새 드리프트다.
 */
export function buildClassRoleMap(css, theme = "both") {
  const vars = new Map();
  for (const m of css.matchAll(/^\s*--([a-z0-9-]+):\s*([^;]+);/gim)) {
    if (!vars.has(m[1])) vars.set(m[1], m[2].trim());
  }
  const resolve = (value) => {
    const direct = value.trim();
    const ref = direct.match(/^var\(--([a-z0-9-]+)\)$/);
    return (ref ? (vars.get(ref[1]) ?? direct) : direct).trim().toLowerCase();
  };

  /**
   * 후보는 **`:root`의 역할 구간에서 정의된 것만**이다.
   *
   * 처음에는 파일 전체에서 `--hb-*`를 긁었는데, 그러면 테마 블록에만 사는 변수
   * (`--hb-ivory`, `--hb-navy` 등)까지 후보가 된다. 그런 변수를 뱉으면 그 클래스는
   * **테마 밖에서 값이 없어 배경·글자색이 통째로 사라진다.** 지금은 범위 가드가
   * 테마 안 파일만 허용해서 드러나지 않지만, 값이 없는 변수를 심는 것 자체가 함정이다.
   */
  const rolesStart = css.indexOf("@generated:design-tokens roles start");
  const rolesEnd = css.indexOf("@generated:design-tokens roles end");
  if (rolesStart === -1 || rolesEnd === -1) {
    throw new Error("globals.css에서 roles 관리 구간을 찾지 못했습니다.");
  }
  const rolesRegion = css.slice(rolesStart, rolesEnd);
  const roleNames = new Set(
    [...rolesRegion.matchAll(/--(hb-[a-z0-9-]+):/g)].map((m) => m[1]),
  );
  const roles = [...vars.entries()].filter(([name]) => roleNames.has(name));

  /** CSS 속성 → Tailwind 접두사. 여기 없는 속성은 손대지 않는다. */
  const PREFIX = {
    color: "text",
    "background-color": "bg",
    "border-color": "border",
  };

  const map = new Map();
  let index = 0;
  while ((index = css.indexOf("[class~=", index)) !== -1) {
    const open = css.indexOf("{", index);
    const close = css.indexOf("}", open);
    if (open === -1 || close === -1) break;

    const selectors = css.slice(css.lastIndexOf("}", index) + 1, open);
    const body = css.slice(open + 1, close);
    // 상태 셀렉터(:hover, :focus)가 붙은 규칙은 클래스 자체가 이미 상태 접두사를
    // 갖고 있어 단순 치환이 어긋난다. 이번 판에서는 다루지 않는다.
    const stateful = /:(hover|focus|focus-visible|active|is\()/.test(selectors);

    /**
     * **규칙이 어느 테마에 걸리는지 본다.** 실측하면 대상 90종 중 53종이
     * `.hanbang-service-theme` 에만 걸린다. 커뮤니티 화면에서 그런 클래스를 역할
     * 변수로 바꾸면 "브리지가 어차피 덮으니 같은 색"이라는 전제가 깨지고 **색이 진짜로
     * 달라진다** — 이 스크립트가 막겠다고 선언한 바로 그 사고다.
     */
    const coversService = selectors.includes("hanbang-service-theme");
    const coversCommunity = selectors.includes("hanbang-community-theme");
    const coversTarget = theme === "service"
      ? coversService
      : theme === "community"
        ? coversCommunity
        : coversService && coversCommunity;

    const classes = [...selectors.matchAll(/\[class~="(.+?)"\]/g)].map((m) => m[1]);
    const decls = [...body.matchAll(/([a-z-]+)\s*:\s*([^;!]+)!important/g)];

    if (coversTarget && !stateful && decls.length === 1) {
      const [, prop, rawValue] = decls[0];
      const prefix = PREFIX[prop.trim()];
      const resolved = resolve(rawValue);
      const role = roles.find(([, value]) => value.trim().toLowerCase() === resolved);
      if (prefix && role) {
        for (const cls of classes) {
          // 상태·그룹 접두사가 붙은 클래스는 건너뛴다(위와 같은 이유).
          if (cls.includes(":")) continue;
          map.set(cls, `${prefix}-[var(--${role[0]})]`);
        }
      }
    }
    index = close;
  }
  return map;
}

/**
 * 이 파일이 어느 테마 안에서 렌더되는가. 브리지 규칙이 테마 단위로 갈리므로
 * **디렉터리만 보고 한 벌의 매핑을 쓰면 안 된다**(대상 90종 중 53종이 service 전용).
 *
 * 어느 쪽인지 확정할 수 없는 곳(`components/common|ui|invite|demo` 등)은 양쪽 모두에
 * 걸리는 규칙만 쓴다 — 좁게 가는 쪽이 틀렸을 때 아무 일도 안 일어난다.
 */
function themeOf(relative) {
  if (relative.startsWith(`src${SEP}app${SEP}(app)${SEP}`)
    || relative.startsWith(`src${SEP}components${SEP}app${SEP}`)) return "service";
  if (relative.startsWith(`src${SEP}app${SEP}(community)${SEP}`)
    || relative.startsWith(`src${SEP}components${SEP}community${SEP}`)) return "community";
  return "both";
}

function assertInScope(relative) {
  if (EXCLUDED.some((excluded) => relative === excluded)) {
    throw new Error(
      `${relative}는 브리지 밖에서도 렌더됩니다. 바꾸면 색이 실제로 달라집니다.`,
    );
  }
  if (!SCOPE.some((prefix) => relative.startsWith(prefix))) {
    throw new Error(
      `${relative}는 브리지 범위 밖입니다. 여기서 리터럴을 역할 변수로 바꾸면 색이 달라집니다.\n`
      + `  범위: ${SCOPE.join(", ")}`,
    );
  }
}

/** 클래스 목록 안에서만 정확히 일치하는 토큰을 바꾼다(부분 문자열 치환 금지). */
export function rewriteSource(source, map) {
  let changed = 0;
  const next = source.replace(/className="([^"]*)"|className=\{`([^`]*)`\}/g, (whole, plain, tpl) => {
    const value = plain ?? tpl;
    const rebuilt = value
      .split(/(\s+)/)
      .map((token) => {
        const replacement = map.get(token);
        if (!replacement) return token;
        changed += 1;
        return replacement;
      })
      .join("");
    if (rebuilt === value) return whole;
    return plain !== undefined ? `className="${rebuilt}"` : `className={\`${rebuilt}\`}`;
  });
  return { next, changed };
}

function main() {
  const args = process.argv.slice(2);
  const css = readFileSync(GLOBALS, "utf8");
  const maps = {
    service: buildClassRoleMap(css, "service"),
    community: buildClassRoleMap(css, "community"),
    both: buildClassRoleMap(css, "both"),
  };

  if (args.includes("--list") || args.length === 0) {
    for (const theme of ["service", "community", "both"]) {
      console.log(`\n[${theme}] 매핑 ${maps[theme].size}개`);
      for (const [from, to] of [...maps[theme].entries()].sort()) {
        console.log(`  ${from}  →  ${to}`);
      }
    }
    console.log("\n사용법: node apps/web/scripts/migrate-bridge-classes.mjs [--check] <파일...>");
    return;
  }

  const checkOnly = args.includes("--check");
  const files = args.filter((a) => !a.startsWith("--"));
  let total = 0;

  // 실패해도 앞서 쓴 파일이 남지 않도록, **전부 계산한 뒤에** 기록한다.
  const planned = [];
  for (const file of files) {
    const absolute = path.resolve(file);
    const relative = path.relative(WEB_ROOT, absolute);
    assertInScope(relative);

    const theme = themeOf(relative);
    const source = readFileSync(absolute, "utf8");
    const { next, changed } = rewriteSource(source, maps[theme]);
    total += changed;
    planned.push({ absolute, relative, theme, next, changed });
  }

  for (const item of planned) {
    console.log(`  ${String(item.changed).padStart(3)}곳  [${item.theme}]  ${item.relative}`);
    if (!checkOnly && item.changed > 0) writeFileSync(item.absolute, item.next);
  }

  console.log(checkOnly ? `\n바꿀 곳 ${total}개(기록 안 함)` : `\n${total}곳을 바꿨습니다.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
