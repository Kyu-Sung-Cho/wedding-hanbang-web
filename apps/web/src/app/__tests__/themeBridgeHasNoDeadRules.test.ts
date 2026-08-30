import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 테마 브리지는 **죽은 규칙을 쌓지 않는다.**
 *
 * ## 브리지가 무엇인가
 *
 * `globals.css`의 "Service app theme bridge"는 로그인 후 화면의 옛 rose/taupe 유틸리티를
 * 유칼립투스 그린으로 덮어쓰는 레이어다. 방식은 속성 선택자다 —
 * `.hanbang-service-theme [class~="text-[var(--hb-accent-hover)]"] { color: ... !important }`.
 *
 * 즉 **문자열 매칭**이다. 컴포넌트에서 그 클래스가 사라지면 규칙은 아무것도 안 하지만,
 * 아무도 모른다. 실제로 2026-08-20에 세어보니 대상 140종 중 **43종이 소스에 0곳**이었다.
 * 그 43종을 지우자 `!important` 선언이 116개에서 96개로 줄었다. 화면은 하나도 안 바뀌었다 —
 * 애초에 아무 요소에도 걸리지 않던 규칙이기 때문이다.
 *
 * ## 이 테스트가 지키는 것
 *
 * 브리지의 모든 대상 클래스가 **소스에 실제로 쓰이고 있을 것**. 이것이 깨지는 경우는 둘이다.
 *
 *   1. 컴포넌트에서 그 클래스를 걷어냈는데 브리지 규칙을 안 지웠다 → 규칙을 지워라.
 *   2. 브리지에 새 규칙을 넣었는데 대상 클래스를 잘못 적었다 → 오타다.
 *
 * 둘 다 지금 고치는 게 맞다. 브리지는 걷어내는 중인 부채이고, 죽은 규칙이 섞여 있으면
 * "무엇이 아직 살아 있는가"를 셀 수 없다.
 *
 * ## 이 테스트가 지키지 않는 것
 *
 * 브리지가 **옳은지**는 보지 않는다. 살아 있는 97종은 여전히 같은 버튼이 랜딩에서는
 * 로즈, 제품 안에서는 초록으로 갈리게 만든다. 그건 프리미티브로 옮겨야 풀리는 문제이고,
 * 이 테스트는 그 이사가 진행되는 동안 **남은 양을 정직하게 유지**하는 역할만 한다.
 */

const WEB_ROOT = process.cwd();
const GLOBALS = path.join(WEB_ROOT, "src/app/globals.css");
const SOURCE_ROOT = path.join(WEB_ROOT, "src");

/**
 * 브리지가 실제로 적용되는 곳 — 테마 클래스가 붙는 두 레이아웃 아래.
 *
 * 처음에는 저장소 전체에서 클래스를 셌는데, 그러면 **영원히 "살아 있다"고 말한다.**
 * 예를 들어 `border-rose-500`은 브리지 안에서 0회지만 랜딩·정책 화면에서 35회 쓰인다.
 * 그 화면들은 테마 밖이라 브리지 규칙이 걸리지 않으므로, 규칙은 이미 죽어 있는데
 * 저장소 전체 카운트는 그 사실을 가려버린다.
 */
const BRIDGED_ROUTE_DIRS = ["app/(app)/", "app/(community)/"];

/**
 * 브리지 라우트가 실제로 import 하는 컴포넌트 디렉터리. **하드코딩하지 않고 읽어낸다** —
 * 새 디렉터리를 쓰기 시작했는데 목록이 낡으면 살아 있는 규칙을 죽었다고 오판한다.
 */
function bridgeReachableComponentDirs(files: string[]): Set<string> {
  const dirs = new Set<string>();
  for (const file of files) {
    const rel = toPosix(path.relative(WEB_ROOT, file));
    if (!BRIDGED_ROUTE_DIRS.some((d) => rel.startsWith(`src/${d}`))
      && !rel.startsWith("src/components/app/")
      && !rel.startsWith("src/components/community/")) continue;
    for (const m of readFileSync(file, "utf8").matchAll(/from "@\/components\/([a-zA-Z-]+)\//g)) {
      dirs.add(m[1]);
    }
  }
  return dirs;
}

function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}

function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules") continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) collectSourceFiles(full, out);
    else if (/\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

const sourceFiles = collectSourceFiles(SOURCE_ROOT);

/**
 * `components/community/StartHereClient.tsx`는 브리지 범위 안에 있지만 `/start-here`
 * (테마 밖)에서도 렌더된다. 여기 쓰인 클래스는 브리지가 안 걸린 채로도 보이므로
 * "브리지 안에서 쓰인다"고 셀 수 없다.
 */
const RENDERED_OUTSIDE_TOO = ["src/components/community/StartHereClient.tsx"];

const reachableDirs = bridgeReachableComponentDirs(sourceFiles);

function isBridged(file: string): boolean {
  const rel = toPosix(path.relative(WEB_ROOT, file));
  if (RENDERED_OUTSIDE_TOO.includes(rel)) return false;
  if (BRIDGED_ROUTE_DIRS.some((d) => rel.startsWith(`src/${d}`))) return true;
  const m = rel.match(/^src\/components\/([a-zA-Z-]+)\//);
  return Boolean(m && reachableDirs.has(m[1]));
}

const sources = sourceFiles.filter(isBridged).map((file) => readFileSync(file, "utf8"));

/** 고정 문자열 등장 횟수. 클래스 문자열에 정규식 메타문자(`[`, `(`, `.`)가 잔뜩 들어 있어
 *  정규식으로 세면 조용히 0이 나온다 — 실제로 한 번 그렇게 틀렸다. */
function countFixed(needle: string): number {
  let total = 0;
  for (const text of sources) {
    let from = 0;
    for (;;) {
      const at = text.indexOf(needle, from);
      if (at === -1) break;
      total += 1;
      from = at + needle.length;
    }
  }
  return total;
}

const bridgeTargets = [
  ...new Set(
    [...readFileSync(GLOBALS, "utf8").matchAll(/\[class~="(.+?)"\]/g)].map(
      (match) => match[1],
    ),
  ),
];

describe("테마 브리지", () => {
  it("측정기가 살아 있다", () => {
    // 이 테스트의 실패 모드는 "브리지가 깨끗하다"가 아니라 **아무것도 못 세는 것**이다.
    // 스캔이 비면 모든 대상이 0곳으로 보이고, 그래도 아래 단언은... 오히려 다 실패한다.
    // 반대로 대상 추출이 비면 아래 단언이 **전부 통과**한다. 그쪽을 여기서 막는다.
    // 브리지 범위 안 파일만 센다. 범위 판정이 망가져 0개가 되면 모든 대상이
    // "죽었다"로 보여 규칙을 통째로 지우게 된다 — 그쪽을 먼저 막는다.
    expect(sources.length).toBeGreaterThan(80);
    expect(reachableDirs.size).toBeGreaterThan(2);
    // ⚠️ 하한이 50 이었다. 2026-08-30에 브리지를 **걷어내기 시작**하면서 규칙 32개가
    // 사라져 대상이 11종만 남았다(색을 다루는 규칙은 전부 은퇴했고, 남은 것은
    // 글꼴·그라디언트·그림자다). 옛 하한은 이제 "브리지가 줄었다"를 파서 고장으로
    // 오인한다.
    //
    // 이 단언의 목적은 여전히 같다 — **추출이 0을 내는 것**을 막는다. 그래야
    // 모든 대상이 "죽었다"로 보여 규칙을 통째로 지우는 일이 안 생긴다. 그래서
    // 숫자만 오늘 값(11)의 아래로 내린다. 브리지가 완전히 은퇴하면 이 파일도
    // 함께 지워야 한다 — 그때는 지킬 대상이 0이 되는 것이 정답이기 때문이다.
    expect(bridgeTargets.length).toBeGreaterThan(6);

    // 카나리아는 **마이그레이션과 무관한 문자열**이어야 한다.
    //
    // 처음에는 `text-[#1A1A1F]`가 200회 넘게 나오는지로 카운터를 검증했다. 그런데 그
    // 클래스는 `migrate-bridge-classes.mjs`의 치환 대상 1순위다 — 같은 세션이 만든 두
    // 도구가 서로를 무너뜨린다. 코드모드를 범위 전체에 돌리면 233 → 20으로 떨어지고,
    // 실패 메시지가 "측정기가 살아 있다"라서 원인을 마이그레이션이 아니라 측정 장치에서
    // 찾게 만든다. 그래서 브리지가 겨냥하지 않는 문자열로 바꿨다.
    expect(countFixed("className=")).toBeGreaterThan(200);
  });

  it("겨냥하는 클래스가 전부 소스에 실제로 쓰인다", () => {
    const dead = bridgeTargets.filter((target) => countFixed(target) === 0);

    expect(
      dead,
      `브리지가 겨냥하지만 소스에 0곳인 클래스 ${dead.length}종입니다. `
        + `globals.css에서 해당 선택자를 지우세요 — 아무 요소에도 걸리지 않는 규칙입니다.`,
    ).toEqual([]);
  });
});
