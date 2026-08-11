// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { CATEGORY_CHECKLISTS } from "@/constants/checklists";
import { computePreparationPriorities } from "../preparationPriorities";

/**
 * 랜딩과 `/start-here`가 같은 3가지를 보여준다는 계약.
 *
 * 랜딩이 "날짜를 넣으면 준비 3가지가 나와요"라고 약속하고 그 자리에서 결과를
 * 보여주므로, 이 계산이 틀리면 첫 화면에서 바로 틀린 안내가 된다.
 */

describe("computePreparationPriorities", () => {
  it("returns nothing without a usable date", () => {
    expect(computePreparationPriorities(null).visiblePriorities).toEqual([]);
    // 이미 지난 날짜에 "지금 알아볼 것"을 말하면 틀린 안내가 된다.
    expect(computePreparationPriorities(-1).visiblePriorities).toEqual([]);
  });

  it("always shows three once a future date is given", () => {
    for (const dday of [0, 30, 120, 300, 400, 900]) {
      const { visiblePriorities } = computePreparationPriorities(dday);
      expect(visiblePriorities, `D-${dday}`).toHaveLength(3);
      // 같은 항목을 두 번 보여주지 않는다.
      expect(new Set(visiblePriorities.map((p) => p.key)).size, `D-${dday}`).toBe(3);
    }
  });

  it("puts already-started items first, soonest deadline leading", () => {
    const { activeNow, visiblePriorities } = computePreparationPriorities(200);
    expect(activeNow.length).toBeGreaterThan(0);

    for (const item of activeNow) expect(item.started).toBe(true);
    // 마감에 가까운 순 — 곧 닥칠 일과 막 지난 일이 함께 앞에 온다.
    // "아직 안 지난 것을 무조건 앞"으로 두면 마감이 7일 지난 상견례가 여유 143일짜리
    // 항목 뒤로 밀린다. 놓친 지 얼마 안 된 일이야말로 지금 손대야 하는 일이다.
    const distances = activeNow.map((p) => Math.abs(p.daysUntilDeadline));
    expect([...distances].sort((a, b) => a - b)).toEqual(distances);
    // 시작한 항목이 화면 앞자리를 차지한다.
    expect(visiblePriorities.slice(0, activeNow.length).map((p) => p.key))
      .toEqual(activeNow.map((p) => p.key));
  });

  it("actually changes with the date", () => {
    // 이 가드가 없어서 상수 버그가 살아남았다. `daysUntilDeadline`은 `dday - ddayDeadline`
    // 이라 `dday`가 비교에서 상쇄되고, 정렬이 날짜와 무관한 상수가 됐다. 결혼식 사흘 전
    // 커플에게도 "양가 부모님 첫 만남"이 1순위로 나갔는데 어떤 테스트도 잡지 못했다.
    // 여러 날짜를 넣어보고 **결과가 서로 달라야** 검증이다.
    const shown = (dday: number) =>
      computePreparationPriorities(dday).visiblePriorities.map((p) => p.key).join(",");

    expect(shown(400)).not.toEqual(shown(120));
    expect(shown(120)).not.toEqual(shown(30));
    expect(shown(400)).not.toEqual(shown(30));

    // 결혼식 직전에는 시작조차 하지 않은 먼 항목이 1순위로 오면 안 된다.
    const soon = computePreparationPriorities(7).visiblePriorities;
    const farthestStart = Math.max(...CATEGORY_CHECKLISTS.map((c) => c.ddayStart));
    const farthest = CATEGORY_CHECKLISTS
      .filter((c) => c.ddayStart === farthestStart)
      .map((c) => c.key);
    expect(farthest).toContain(
      CATEGORY_CHECKLISTS.slice().sort((a, b) => b.ddayStart - a.ddayStart)[0].key,
    );
    expect(farthest, "가장 이른 준비가 결혼식 직전 1순위가 됐다")
      .not.toContain(soon[0].key);
  });

  it("falls back to upcoming items when nothing has started yet", () => {
    // 아주 먼 날짜에는 시작점을 지난 항목이 없을 수 있다. 그래도 빈손으로
    // 돌려보내지 않고 다가오는 순서를 보여준다.
    const far = Math.max(...CATEGORY_CHECKLISTS.map((c) => c.ddayStart)) + 100;
    const { activeNow, visiblePriorities } = computePreparationPriorities(far);
    expect(activeNow).toEqual([]);
    expect(visiblePriorities).toHaveLength(3);
    for (const item of visiblePriorities) expect(item.started).toBe(false);
  });

  it("carries first steps a first-timer can act on", () => {
    for (const item of computePreparationPriorities(150).visiblePriorities) {
      expect(item.firstSteps.length).toBeGreaterThan(0);
      expect(item.firstSteps.length).toBeLessThanOrEqual(3);
      for (const step of item.firstSteps) expect(step.trim().length).toBeGreaterThan(0);
      expect(item.label.trim().length).toBeGreaterThan(0);
    }
  });

  it("/start-here computes with the shared function, not its own copy", () => {
    // 두 화면이 같은 3가지를 보여준다는 계약은 **같은 함수를 쓸 때만** 성립한다.
    // /start-here에 사본이 있었고 그 사본에만 폴백이 빠져서, 랜딩이 권한
    // 프리셋(D-365·D-547)으로 넘어가면 목록이 0개였다.
    const startHere = readFileSync(
      resolve(process.cwd(), "src/components/community/StartHereClient.tsx"),
      "utf8",
    );
    expect(startHere).toContain("computePreparationPriorities");
    // 사본이 되살아나는 신호: 시작 여부로 직접 거르고 끝내는 코드.
    expect(startHere).not.toMatch(/\.filter\(\s*\(\s*category\s*\)\s*=>\s*category\.started\s*\)/u);
  });

  it("never leaves a future date with an empty list", () => {
    // 가장 이른 시작점보다 먼 날짜에서도 빈손으로 돌려보내지 않는다.
    const farthestStart = Math.max(...CATEGORY_CHECKLISTS.map((c) => c.ddayStart));
    for (const dday of [farthestStart + 1, 365, 547, 900, 1200]) {
      expect(computePreparationPriorities(dday).visiblePriorities, `D-${dday}`).toHaveLength(3);
    }
  });

  it("names in the hero are the names the screen actually shows", () => {
    // 이 계약이 두 번 깨졌다. 한 번은 "드레스"를 예시로 들었는데 결과에 한 번도
    // 나오지 않았고, 한 번은 다른 브랜치에서 개명한 라벨을 그대로 옮겨 적어
    // 화면에는 없는 이름이 됐다. 둘 다 날짜를 하나만 넣어보고 넘어간 결과다.
    // 카피와 계산을 여기서 묶어 둔다 — 라벨을 바꾸면 이 테스트가 먼저 깨진다.
    const heroBody = readFileSync(
      resolve(process.cwd(), "src/components/landing/redesign/landingContent.ts"),
      "utf8",
    ).match(/body:\s*"(날짜를 넣으면[^"]+)"/u)?.[1];
    expect(heroBody, "히어로 본문을 찾지 못했다").toBeTruthy();

    // ⚠️ 이 단언은 원래 "어떤 날짜를 넣어도 나오는 셋이 히어로가 약속한 이름이어야
    // 한다"였다. 그 형태는 결과가 **날짜와 무관하게 상수일 때만** 통과하므로,
    // 상수 버그를 잡기는커녕 계약으로 못 박고 있었다. 히어로 본문도 "…처럼"이라
    // 예시 표현이지 정확히 그 셋을 약속하지 않는다.
    //
    // 지키려던 진짜 의도는 "히어로가 화면에 없는 이름을 말하지 않는다"이다.
    // 그것만 남긴다: 히어로가 예로 든 이름은 (1) 실제 준비 항목의 라벨이어야 하고
    // (2) 적어도 하나의 날짜에서 실제로 화면에 떠야 한다.
    const heroNamed = CATEGORY_CHECKLISTS
      .filter((category) => heroBody!.includes(category.label))
      .map((category) => category.key);
    expect(heroNamed.length, "히어로가 예로 든 이름 중 실제 준비 항목이 하나도 없다")
      .toBeGreaterThanOrEqual(3);

    const everShown = new Set(
      [3, 30, 120, 300, 500, 800]
        .flatMap((dday) => computePreparationPriorities(dday).visiblePriorities)
        .map((p) => p.key),
    );
    for (const key of heroNamed) {
      expect(everShown, `히어로가 예로 든 "${key}"가 어떤 날짜에서도 화면에 없다`)
        .toContain(key);
    }
  });

  it("honours the skip set so the two screens can diverge only by user choice", () => {
    const base = computePreparationPriorities(200).visiblePriorities;
    const dropped = base[0].key;
    const after = computePreparationPriorities(200, { skipped: new Set([dropped]) });
    expect(after.visiblePriorities.map((p) => p.key)).not.toContain(dropped);
    expect(after.visiblePriorities).toHaveLength(3);
  });
});
