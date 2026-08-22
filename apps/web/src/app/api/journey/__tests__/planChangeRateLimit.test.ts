// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { CATEGORY_CHECKLISTS } from "@hanbang/shared/constants";

/**
 * 체크리스트를 평범하게 쓰는 사람이 저장에서 막히지 않는지 본다.
 *
 * `PATCH /api/journey` 의 한도가 **정확히 10회/분**이었다. 체크리스트에서 항목 열 개를
 * 체크하면 열한 번째부터 "요청이 너무 많습니다"로 막혔다 — 스트레스 테스트가 아니라
 * 평범한 사용에서 바로 걸리는 값이었다(2026-08-22 파운더 제보).
 *
 * 이름은 `journey:plan-change` 지만 이 한도는 **모든 PATCH 가 함께 쓴다.** 결혼 날짜·예산
 * 같은 드문 변경을 염두에 둔 값이 체크 토글에도 그대로 걸렸다.
 *
 * 그래서 숫자 하나를 지킨다. 다시 낮추는 변경은 **체크리스트 화면을 다시 망가뜨린다.**
 * 근본 수정(클라이언트가 토글을 묶어 보내기)이 들어오면 이 검사의 전제를 다시 정하면 된다.
 */
describe("준비 정보 저장 한도", () => {
  const source = readFileSync(
    resolve(process.cwd(), "src/app/api/journey/route.ts"),
    "utf8",
  );

  /** 사람이 한 분야를 열어 항목을 쭉 체크할 때 나가는 요청 수의 현실적인 상한. */
  const BIGGEST_CATEGORY = Math.max(
    ...CATEGORY_CHECKLISTS.map((category) => category.items.length),
  );

  it("판별식이 실제로 한도를 읽어낸다", () => {
    // 못 읽으면 아래 검사가 늘 통과한다. 먼저 읽었는지 본다.
    expect(source).toContain('rateLimitKey("journey:plan-change"');
    expect(source).toMatch(/maxRequests:\s*\d+/);
  });

  it("가장 큰 분야를 한 번에 다 체크해도 막히지 않는다", () => {
    const match = source.match(/maxRequests:\s*(\d+),\s*windowMs:\s*60\s*\*\s*1000/);
    expect(match, "1분 창의 한도를 못 찾았다 — 형태가 바뀌었으면 이 검사를 고쳐라").toBeTruthy();
    const maxRequests = Number(match![1]);

    // 지금 가장 큰 분야는 항목이 열한 개다. 한도가 그보다 작으면 그 분야를 끝까지
    // 체크하는 것만으로 저장이 막힌다.
    expect(BIGGEST_CATEGORY).toBeGreaterThan(5);
    expect(
      maxRequests,
      `가장 큰 분야가 ${BIGGEST_CATEGORY}개인데 한도가 ${maxRequests}회/분이다 — `
        + "그 분야를 끝까지 체크하면 사용자가 막힌다",
    ).toBeGreaterThan(BIGGEST_CATEGORY);

    // 한 분야를 끝내고 다음 분야로 넘어가는 것도 1분 안에 일어난다. 여유를 둔다.
    expect(maxRequests).toBeGreaterThanOrEqual(40);
  });

  it("무제한은 아니다", () => {
    // 한도를 없애거나 터무니없이 올리는 것으로 이 검사를 통과시키지 못하게 한다.
    const match = source.match(/maxRequests:\s*(\d+),\s*windowMs:\s*60\s*\*\s*1000/);
    expect(Number(match![1])).toBeLessThanOrEqual(120);
    expect(source).toContain("failClosed: true");
  });
});
