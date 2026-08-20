import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 손으로 만든 `<button>`은 **늘어나지 않는다.**
 *
 * ## 왜 이런 모양의 가드인가
 *
 * 2026-08-20 실측: 제품 코드의 `<button>` 702개 중 정적 className을 가진 것들이 서로 다른
 * 조합 **466종**을 쓰고, 그중 **90%가 딱 한 번씩만** 쓰인다. 색이 흩어진 게 아니라
 * 버튼을 매번 새로 쓰고 있었다.
 *
 * 이걸 "앞으로 raw `<button>` 금지"로 막으면 702곳이 한꺼번에 빨개진다. 그렇다고 다 옮기는
 * 것은 466종을 4종으로 줄이는 **재디자인**이라, 디자인이 확정되기 전에 할 일이 아니다.
 *
 * 그래서 래칫(ratchet)으로 막는다 — **지금보다 늘어나면 실패**한다. 새 코드는 프리미티브를
 * 쓸 수밖에 없고, 기존 코드는 준비된 화면부터 하나씩 옮기면 된다. 옮길 때마다 숫자가
 * 줄어드니 진행 상황이 저절로 기록된다.
 *
 * ## 늘려야 할 때
 *
 * 없다. 프리미티브가 못 하는 게 있으면 프리미티브를 고쳐라 — 그게 프리미티브를 만든
 * 이유다. 정말 예외가 필요하면 **왜 프리미티브로 안 되는지**를 여기 주석에 적고 올려라.
 *
 * ## 줄었을 때
 *
 * 축하한다. `BASELINE`을 새 숫자로 낮춰라. 낮추지 않으면 다음 사람이 다시 늘릴 여지가
 * 그만큼 생긴다.
 */

/**
 * 2026-08-20 기준 제품 코드의 raw `<button>` 수. **줄이는 방향으로만** 바꾼다.
 *
 * 세는 방식은 단순 문자열 검색이라 주석이나 문자열 안의 `<button`도 함께 센다. 래칫은
 * 절대값이 아니라 **방향**을 지키는 장치이므로 그래도 된다 — 세는 방법이 일정하기만
 * 하면 늘었는지 줄었는지는 정확하다. (이 사실을 모르고 손으로 계산했다가 1개 틀렸다.)
 */
const BASELINE = 701;

const SOURCE_ROOT = path.join(process.cwd(), "src");

/** 프리미티브 자신은 raw `<button>`을 낸다. 그게 이 파일의 일이다. */
const EXEMPT = [path.join("src", "components", "ui", "Button.tsx")];

function isTestFile(file: string): boolean {
  return /\.(test|spec)\.tsx$/.test(file) || file.includes(`${path.sep}__tests__${path.sep}`);
}

function collect(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules") continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) collect(full, out);
    else if (name.endsWith(".tsx")) out.push(full);
  }
  return out;
}

function countRawButtons(): { total: number; byFile: Array<[string, number]> } {
  const byFile: Array<[string, number]> = [];
  let total = 0;

  for (const file of collect(SOURCE_ROOT)) {
    if (isTestFile(file)) continue;
    const relative = path.relative(process.cwd(), file);
    if (EXEMPT.some((exempt) => relative === exempt)) continue;

    const matches = readFileSync(file, "utf8").match(/<button\b/g);
    if (!matches) continue;
    total += matches.length;
    byFile.push([relative, matches.length]);
  }

  return { total, byFile: byFile.sort((a, b) => b[1] - a[1]) };
}

describe("손으로 만든 버튼은 늘지 않는다", () => {
  it("측정기가 살아 있다", () => {
    // 스캔이 비면 total이 0이 되고 아래 단언이 **조용히 통과**한다. 그쪽을 먼저 막는다.
    const { total, byFile } = countRawButtons();
    expect(byFile.length).toBeGreaterThan(50);
    expect(total).toBeGreaterThan(300);
  });

  it("기준치를 넘지 않는다", () => {
    const { total, byFile } = countRawButtons();

    expect(
      total,
      `raw <button>이 ${total}개입니다(기준 ${BASELINE}). `
        + `새 버튼은 \`@/components/ui/Button\`을 쓰세요. `
        + `가장 많은 파일: ${byFile.slice(0, 3).map(([f, n]) => `${f}(${n})`).join(", ")}`,
    ).toBeLessThanOrEqual(BASELINE);
  });

  it("줄었으면 기준치를 낮추라고 알려준다", () => {
    const { total } = countRawButtons();

    // 줄어든 것을 방치하면 다음 사람이 그만큼 다시 늘릴 수 있다.
    expect(
      total,
      `raw <button>이 ${total}개로 줄었습니다. 이 파일의 BASELINE을 ${total}로 낮추세요.`,
    ).toBeGreaterThanOrEqual(BASELINE);
  });
});
