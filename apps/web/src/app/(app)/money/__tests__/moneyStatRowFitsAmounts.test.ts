// @vitest-environment node

/**
 * 축의금 통계 카드는 **한 줄에 넷을 놓지 않는다.**
 *
 * ## 무엇이 잘못됐었나
 *
 * 총 축의금·총 인원·평균·신랑/신부 카드 넷이 `md`(768px)부터 4단이었다. 이 페이지는
 * `max-w-[800px]` 안이라 4단이면 금액 칸이 59~143px 밖에 안 된다. 그런데 축의금은
 * **원 단위 원본**이다 — 예산 카드가 `totalBudget / 10000` 으로 만원 단위를 쓰는 것과
 * 반대다. "1,250,000" 은 36px 에서 185px 를 먹는다.
 *
 * `globals.css` 의 전역 `overflow-wrap: anywhere` 때문에 넘치는 대신 **숫자 중간에서
 * 줄이 바뀐다.** 화면에는 "1,250,00 / 0" 처럼 나오고, 다른 금액으로 읽힌다.
 *
 * 2026-08-31 에 운영 CSS 로 폭을 사다리로 재서 확인했다(숫자가 차지하는 줄 수):
 *
 *   뷰포트   현재 4단          2단
 *   768     3줄 (칸 59px)     1줄 (칸 178px)
 *   1024    2줄 (칸 123px)    1줄 (칸 306px)
 *   1440    2줄 (칸 143px)    1줄 (칸 346px)
 *
 * **1024px 에서는 10만원조차 두 줄이었다.** 평균 카드는 거의 늘 깨져 있었다.
 * 모바일(≤767px)은 원래 2단이고 글자도 22px 로 줄어 영향이 없다.
 *
 * ## 왜 글자를 줄이지 않았나
 *
 * 59px 칸에 여섯 자리를 넣으려면 12px 까지 내려야 하고, 그러면 1024px 이상에서 근거
 * 없이 작아진다. 크기가 아니라 배치 문제였다. 같은 판단을 예산 카드에서도 했다
 * (`budgetRowBreakpoint.test.ts`).
 *
 * ## 이 테스트가 지키는 것
 *
 * 그리드가 3단 이상으로 늘지 않을 것, 그리고 금액 글자 크기가 그대로일 것.
 * 문자열을 찾지 않고 **변형을 꺼내 대조**한다 — `max-lg:grid-cols-4` 처럼 뜻이
 * 반대인 것이 부분문자열 검사를 통과한 전례가 있다.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function moneyPageSource(): string {
  return readFileSync(
    resolve(process.cwd(), "src/app/(app)/money/page.tsx"),
    "utf8",
  );
}

/** 통계 카드를 감싼 그리드 한 줄. `총 축의금` 라벨 바로 위에 있다. */
function statGridLine(): string {
  const lines = moneyPageSource().split(/\r?\n/);
  const label = lines.findIndex((line) => line.includes("총 축의금"));
  expect(label, "통계 카드를 찾지 못했다").toBeGreaterThan(-1);
  const grid = lines.slice(0, label).reverse().find((line) => line.includes("grid-cols-"));
  expect(grid, "통계 카드를 감싼 그리드를 찾지 못했다").toBeTruthy();
  return grid as string;
}

/** `grid-cols-N` 을 켜는 변형과 열 수를 함께 꺼낸다. */
function gridColumns(source: string): Array<{ variant: string; cols: number }> {
  return [...source.matchAll(/(?:^|[\s"'`])((?:max-)?(?:sm|md|lg|xl|2xl):|min-\[[^\]]+\]:)?grid-cols-(\d+)/g)]
    .map((m) => ({ variant: m[1] ?? "(무조건)", cols: Number(m[2]) }));
}

describe("축의금 통계 카드", () => {
  it("측정기가 살아 있다", () => {
    // 스캔이 비면 아래 단언이 공짜로 통과한다.
    const source = moneyPageSource();
    expect(source.length, "페이지 소스를 못 읽었다").toBeGreaterThan(2000);
    expect(gridColumns('grid grid-cols-2 md:grid-cols-4'), "변형 추출이 깨졌다")
      .toEqual([{ variant: "(무조건)", cols: 2 }, { variant: "md:", cols: 4 }]);
  });

  it("어떤 폭에서도 3단 이상으로 늘지 않는다", () => {
    const grid = statGridLine();
    const wide = gridColumns(grid).filter((g) => g.cols >= 3);
    expect(wide, `실제 그리드: ${grid} — 3단 이상이면 원 단위 금액이 숫자 중간에서 끊긴다`)
      .toEqual([]);
  });

  it("금액 글자 크기는 그대로 둔다", () => {
    const source = moneyPageSource();
    // 고침은 배치였다. 글자를 줄여서 때우면 넓은 화면에서 근거 없이 작아진다.
    // 금액 카드는 총 축의금·총 인원·평균 셋이다.
    const count = source.split("font-serif-kr text-4xl font-light").length - 1;
    expect(count, "금액 카드 셋이 같은 크기를 써야 한다").toBe(3);
  });
});
