// @vitest-environment node

/**
 * 예산 카테고리 행이 **한 브레이크포인트에서만** 접히게 고정한다.
 *
 * ## 무엇이 잘못됐었나
 *
 * 이 행은 아이콘·이름·진행바·분담·기록지출·구분선·예산·상태까지 8개를 한 줄에
 * 놓는다. 진행바(`flex-1 min-w-0`)만 줄어들고 **나머지는 전부 `flex-shrink-0`**
 * 이라, 자리가 모자라면 오른쪽으로 넘친다. 그런데 감싼 카드가 `overflow-hidden`
 * 이라 넘친 부분은 **스크롤도 안 되고 그냥 잘린다** — 예산 금액과 "총예산의 N%"
 * 가 화면에서 사라진다.
 *
 * 줄바꿈은 `max-md:`(768px 미만)에만 걸려 있었는데, 실측한 실제 한계는 1024px
 * 였다(2026-08-23, 운영에서 폭을 사다리로 재서 확인):
 *
 *   1440 / 1280 / 1152 / 1024 → 여유 24px, 정상
 *   900  → 45px 넘침·잘림
 *   800  → 145px 넘침·잘림
 *
 * 즉 **768~1024px 구간이 비어 있었다.** 작은 노트북과 아이패드 가로가 그 폭이다.
 *
 * ## 이 테스트가 지키는 것
 *
 * 브레이크포인트를 옮길 때 **일부만 옮기는 것**이 이 행의 진짜 위험이다. 줄바꿈은
 * lg 인데 상태 배지는 md 로 남으면, 그 사이 폭에서 모바일 배지와 데스크톱 배지가
 * 동시에 사라지거나 둘 다 나온다. 그래서 개수가 아니라 **한 종류만 쓰는지**를 본다.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function categoryRowSource(): string {
  const file = readFileSync(
    resolve(process.cwd(), "src/components/app/budget/BudgetContent.tsx"),
    "utf8",
  );
  // ⚠️ 이 저장소의 파일은 CRLF 다. 줄 끝을 다듬지 않으면 `"}"` 비교가 `"}\r"`
  // 과 어긋나 범위를 못 찾고, 테스트가 "행이 없다"로 조용히 무너진다.
  const lines = file.split(/\r?\n/);
  const start = lines.findIndex((line) =>
    line.includes("group flex items-center gap-3 px-6 py-5"));
  expect(start, "예산 카테고리 행을 찾지 못했다").toBeGreaterThan(-1);
  const end = lines.findIndex((line, index) => index > start && line.trim() === "}");
  expect(end, "행 컴포넌트의 끝을 찾지 못했다").toBeGreaterThan(start);
  return lines.slice(start, end).join("\n");
}

/** `max-md:` 의 `md`, `md:` 의 `md` 를 모두 모은다. */
function breakpointsUsed(source: string): Set<string> {
  const found = new Set<string>();
  for (const match of source.matchAll(/(?:^|[\s"'`])(?:max-)?(sm|md|lg|xl|2xl):/g)) {
    found.add(match[1]);
  }
  return found;
}

describe("예산 카테고리 행의 접히는 폭", () => {
  it("행 안에서 브레이크포인트를 한 종류만 쓴다", () => {
    const used = [...breakpointsUsed(categoryRowSource())];
    // 섞이면 그 사이 폭에서 절반은 모바일, 절반은 데스크톱 배치가 된다.
    expect(used, `섞여 있다: ${used.join(", ")}`).toHaveLength(1);
  });

  it("768px 이 아니라 1024px 에서 접힌다", () => {
    const source = categoryRowSource();
    // 실측된 한계가 1024px 이므로 md(768) 로는 부족하다.
    expect(source).toContain("max-lg:flex-wrap");
    expect(source).not.toContain("max-md:flex-wrap");
  });

  it("줄바꿈이 켜지는 폭과 상태 배지가 갈리는 폭이 같다", () => {
    const source = categoryRowSource();
    // 모바일 배치(라벨 옆 배지)와 데스크톱 배치(행 끝 배지)는 정확히 같은
    // 지점에서 교대해야 한다. 어긋나면 둘 다 보이거나 둘 다 사라진다.
    expect(source).toContain("lg:hidden");
    expect(source).toContain("hidden lg:flex");
  });

  it("좁아질 때 줄어들 수 있는 칸이 남아 있다", () => {
    const source = categoryRowSource();
    // 진행바가 유일한 신축 칸이다. 이것까지 flex-shrink-0 이 되면
    // 어떤 폭에서도 넘친다.
    expect(source).toContain("flex-1 min-w-0");
  });
});

/**
 * 위 카테고리 행과 **같은 실수가 통계 카드 줄에서 한 번 더** 일어났다.
 *
 * 총예산·기록지출·남은금액 카드 셋은 `md`(768px)부터 3단이었는데, 그 폭에서 칸이
 * 100px 로 좁아진다. 금액은 42px 이라 "8,000" 하나가 117px 을 먹고, 상위 규칙이
 * `overflow-wrap: anywhere` 라 넘치는 대신 **숫자 중간에서 줄이 바뀐다.**
 * 화면에는 "8,00 / 0" 으로 나왔다 — 다른 금액으로 읽힌다.
 *
 * 2026-08-31 운영에서 폭을 사다리로 재서 확인했다.
 *
 *   1280 → 칸 270px, "123,456"(178px)까지 한 줄
 *   1024 → 칸 185px, "123,456"까지 한 줄
 *    850 → 칸 117px, "8,000"(117px)이 딱 맞아 아슬아슬
 *    768 → 칸 100px, **깨짐**
 *   768 미만 → 한 단이라 칸 407px, 안전
 *
 * 그래서 3단은 `lg` 부터다. 어떤 고정 글자 크기로도 100px 칸에 여섯 자리를 넣을 수
 * 없다(28px 로 줄여야 "10,000" 이 겨우 들어간다) — 크기가 아니라 배치 문제였다.
 */
function statRowSource(): string {
  const file = readFileSync(
    resolve(process.cwd(), "src/components/app/budget/BudgetContent.tsx"),
    "utf8",
  );
  const lines = file.split(/\r?\n/);
  const start = lines.findIndex((line) => line.includes("TOTAL BUDGET"));
  expect(start, "통계 카드 줄을 찾지 못했다").toBeGreaterThan(-1);
  // 카드 셋을 감싼 그리드는 이 줄보다 위에 있다.
  const gridLine = lines.slice(0, start).reverse().find((line) => line.includes("grid-cols-1"));
  expect(gridLine, "통계 카드를 감싼 그리드를 찾지 못했다").toBeTruthy();
  return gridLine as string;
}

describe("예산 통계 카드가 3단이 되는 폭", () => {
  it("md 가 아니라 lg 부터 3단이다", () => {
    const grid = statRowSource();
    expect(grid, `실제 그리드: ${grid}`).toContain("lg:grid-cols-3");
    expect(grid, "md 로 되돌리면 768px 에서 금액이 숫자 중간에서 끊긴다")
      .not.toContain("md:grid-cols-3");
  });

  it("금액 글자 크기는 그대로 둔다", () => {
    const file = readFileSync(
      resolve(process.cwd(), "src/components/app/budget/BudgetContent.tsx"),
      "utf8",
    );
    // 고침은 배치였다. 글자를 줄여서 때우면 1024px 이상에서 근거 없이 작아진다.
    expect(file).toContain("text-[36px] font-medium sm:text-[40px] lg:text-[42px]");
  });
});
