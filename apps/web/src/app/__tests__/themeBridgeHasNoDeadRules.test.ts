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
 * `.hanbang-service-theme [class~="text-rose-500"] { color: ... !important }`.
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

function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules") continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) collectSourceFiles(full, out);
    else if (/\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

const sources = collectSourceFiles(SOURCE_ROOT).map((file) => readFileSync(file, "utf8"));

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
    expect(sources.length).toBeGreaterThan(500);
    expect(bridgeTargets.length).toBeGreaterThan(50);
    // 브리지가 겨냥하는 클래스 중 확실히 쓰이는 것 하나로 카운터 자체를 검증한다.
    expect(countFixed("text-[#1A1A1F]")).toBeGreaterThan(200);
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
