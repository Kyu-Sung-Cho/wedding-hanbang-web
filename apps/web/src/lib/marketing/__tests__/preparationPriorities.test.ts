// @vitest-environment node

import { describe, expect, it } from "vitest";

import { availableNow } from "@/components/landing/redesign/landingContent";
import { CATEGORY_CHECKLISTS } from "@/constants/checklists";
import { computePreparationPriorities } from "../preparationPriorities";

import { rendered } from "../../../app/landing/__tests__/landingSource";

/**
 * 랜딩과 `/start-here`가 같은 3가지를 보여준다는 계약.
 *
 * 랜딩이 "날짜를 넣으면 준비 3가지가 나와요"라고 약속하고 그 자리에서 결과를
 * 보여주므로, 이 계산이 틀리면 첫 화면에서 바로 틀린 안내가 된다.
 *
 * 2026-08-27 개편으로 그 약속을 히어로가 아니라 "지금 되는 것" 카드가 진다
 * (`landingContent.availableNow`에서 `/start-here`로 보내는 카드). 랜딩은 이제
 * 결과를 그 자리에서 보여주지 않고 `/start-here`로 보내지만, **약속한 개수와
 * 이름이 계산과 같아야 한다**는 계약은 그대로다.
 *
 * ## 2026-08-28 적대적 검증에서 빠져나간 것
 *
 * - `computePreparationPriorities` 를 **주석에만 남기고** 사본을 되살려도 통과했다.
 *   원문을 `toContain` 으로 물었기 때문이다 → 이제 주석을 벗기고 묻는다.
 * - 랜딩은 "세 가지"를 약속하는데 `/start-here` 가 **두 개만 그려도** 통과했다
 *   (`visiblePriorities.slice(0, 2)`). 계산은 셋을 돌려주므로 계산만 보면 모른다
 *   → 화면이 그 셋을 다 그리는지, 도착 화면 머리말이 같은 수를 말하는지 함께 본다.
 * - 카피의 "세 가지"만 문자열로 물어서, 표기를 "3가지"로 바꾸면 **정상 변경인데도
 *   깨지고** 개수를 "두 가지"로 바꾸면 다른 곳에서 안 잡혔다 → 개수를 계산 결과에서
 *   끌어내고, 한글·숫자 표기를 함께 받아들이되 **다른 개수는 막는다.**
 */

/** 화면이 그린다고 약속한 개수. 상수로 적지 않고 계산에서 끌어온다. */
const PROMISED_COUNT = computePreparationPriorities(200).visiblePriorities.length;

/** 개수를 세는 한국어 관형사. 카피는 "세 가지"로도 "3가지"로도 쓸 수 있다. */
const KOREAN_COUNT_WORDS: Readonly<Record<number, string>> = {
  1: "한",
  2: "두",
  3: "세",
  4: "네",
  5: "다섯",
  6: "여섯",
};

/** `n가지`를 한글·숫자 두 표기로 찾는 정규식. 표기 하나만 막으면 다른 표기로 돌아온다. */
function countPhrase(n: number): RegExp {
  return new RegExp(`(${KOREAN_COUNT_WORDS[n]}|${n})\\s*가지`, "u");
}

const START_HERE_PATH = "src/components/community/StartHereClient.tsx";

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
    //
    // ⚠️ 원문을 물으면 **함수 이름을 주석에만 남기고 사본을 되살려도** 통과한다
    // (2026-08-28 적대적 검증에서 실제로 빠져나갔다). 주석을 벗기고 묻는다.
    const startHere = rendered(START_HERE_PATH);
    expect(startHere, "공유 계산을 쓰지 않는다").toContain("computePreparationPriorities");
    // 사본이 되살아나는 신호: 시작 여부로 직접 거르고 끝내는 코드.
    expect(startHere).not.toMatch(/\.filter\(\s*\(\s*category\s*\)\s*=>\s*category\.started\s*\)/u);
    // 이름만 남기고 그 자리에서 다시 정의해도 "쓴다"고 할 수 없다.
    expect(startHere, "같은 이름으로 사본을 다시 정의했다")
      .not.toMatch(/(const|function)\s+computePreparationPriorities/u);
  });

  it("never leaves a future date with an empty list", () => {
    // 가장 이른 시작점보다 먼 날짜에서도 빈손으로 돌려보내지 않는다.
    const farthestStart = Math.max(...CATEGORY_CHECKLISTS.map((c) => c.ddayStart));
    for (const dday of [farthestStart + 1, 365, 547, 900, 1200]) {
      expect(computePreparationPriorities(dday).visiblePriorities, `D-${dday}`).toHaveLength(3);
    }
  });

  it("the landing promises only what this calculation actually returns", () => {
    // 이 계약이 두 번 깨졌다. 한 번은 "드레스"를 예시로 들었는데 결과에 한 번도
    // 나오지 않았고, 한 번은 다른 브랜치에서 개명한 라벨을 그대로 옮겨 적어
    // 화면에는 없는 이름이 됐다. 둘 다 날짜를 하나만 넣어보고 넘어간 결과다.
    // 카피와 계산을 여기서 묶어 둔다 — 라벨을 바꾸면 이 테스트가 먼저 깨진다.
    //
    // ⚠️ 이 단언은 원래 "어떤 날짜를 넣어도 나오는 셋이 히어로가 약속한 이름이어야
    // 한다"였다. 그 형태는 결과가 **날짜와 무관하게 상수일 때만** 통과하므로,
    // 상수 버그를 잡기는커녕 계약으로 못 박고 있었다. 그래서 "히어로가 화면에 없는
    // 이름을 말하지 않는다"로 한 번 좁혔다.
    //
    // ⚠️ 2026-08-27 랜딩 개편으로 히어로가 준비 3가지를 아예 약속하지 않는다.
    // 첫 화면 후크가 "둘이 어디서 갈리는지"로 바뀌면서 `body: "날짜를 넣으면 …"`
    // 문장이 사라졌고, 그 약속은 "지금 되는 것" 카드 하나로 내려갔다.
    // 읽는 곳을 그 카드로 옮긴다. 소스 텍스트를 정규식으로 긁던 방식도 그만둔다 —
    // 문장이 조금 바뀌면 `?.[1]`이 undefined가 되어 **무엇을 검사하는지 모르는 채**
    // 실패했다. 카피 정본을 그대로 import 하면 그런 실패가 없다.
    const preparationCard = availableNow.find((card) => card.cta.href === "/start-here");
    expect(preparationCard, "랜딩에서 /start-here로 보내는 카드를 찾지 못했다").toBeTruthy();
    const preparationCopy = [
      preparationCard!.title,
      preparationCard!.body,
      preparationCard!.note,
    ].join("\n");

    // 개수는 여전히 약속한다. 약속한 개수와 계산 결과가 같아야 한다 —
    // 이름이 사라졌다고 카피·계산의 연결까지 놓으면 이 테스트가 빈 껍데기가 된다.
    //
    // ⚠️ `toContain("세 가지")`만 쓰면 표기 하나만 막는다. 개수를 계산에서 끌어와
    // 한글·숫자 두 표기를 함께 받고, **다른 개수는 명시적으로 막는다** — "두 가지"로
    // 바꾼 변형이 이 자리에서 잡히지 않으면 화면과 계산이 갈린 채로 나간다.
    expect(preparationCopy, `랜딩이 준비 ${PROMISED_COUNT}개를 약속하지 않는다`)
      .toMatch(countPhrase(PROMISED_COUNT));
    for (const wrong of [1, 2, 4, 5, 6].filter((n) => n !== PROMISED_COUNT)) {
      expect(preparationCopy, `랜딩이 ${wrong}가지를 약속한다`)
        .not.toMatch(countPhrase(wrong));
    }
    for (const dday of [3, 30, 120, 300, 500, 800]) {
      expect(computePreparationPriorities(dday).visiblePriorities, `D-${dday}`)
        .toHaveLength(PROMISED_COUNT);
    }

    // 카피가 아무리 맞아도 **그 카드를 그리지 않으면** 방문자는 약속을 못 본다.
    // 카피 파일만 보면 `<p>{item.body}</p>`를 지운 상태가 그대로 통과한다.
    const availableNowSection = rendered(
      "src/components/landing/redesign/AvailableNowSection.tsx",
    );
    for (const wiring of ["availableNow.map(", "{item.body}", "{item.note}", "{item.cta.label}"]) {
      expect(availableNowSection, `"지금 되는 것" 카드가 ${wiring} 를 그리지 않는다`)
        .toContain(wiring);
    }

    // 이름을 다시 적는 순간 옛 계약이 그대로 살아난다: 카피가 부른 이름은
    // (1) 실제 준비 항목의 라벨이어야 하고 (2) 적어도 하나의 날짜에서 화면에 떠야 한다.
    // 지금 카피는 이름을 하나도 적지 않으므로 이 고리는 비어 있다.
    const namedInCopy = CATEGORY_CHECKLISTS
      .filter((category) => preparationCopy.includes(category.label))
      .map((category) => category.key);
    const everShown = new Set(
      [3, 30, 120, 300, 500, 800]
        .flatMap((dday) => computePreparationPriorities(dday).visiblePriorities)
        .map((p) => p.key),
    );
    for (const key of namedInCopy) {
      expect(everShown, `랜딩이 예로 든 "${key}"가 어떤 날짜에서도 화면에 없다`)
        .toContain(key);
    }
  });

  it("/start-here actually renders every priority the landing promised", () => {
    // 계산이 셋을 돌려주는 것과 화면이 셋을 그리는 것은 다른 일이다.
    // `visiblePriorities.slice(0, 2)` 한 줄이면 랜딩은 "세 가지"를 약속하고
    // 도착 화면은 둘만 보여준다 — 2026-08-28 적대적 검증에서 이 변형이 통과했다.
    const startHere = rendered(START_HERE_PATH);

    expect(startHere, "결과 목록을 그리지 않는다").toContain("visiblePriorities.map(");
    expect(startHere, "결과 목록을 잘라서 그린다")
      .not.toMatch(/visiblePriorities\s*\.\s*slice\s*\(/u);
    // `focusLabels`(아모라 프리필)도 같은 목록을 통째로 넘긴다.
    expect(startHere, "아모라에게 넘기는 목록이 잘렸다")
      .not.toMatch(/visiblePriorities[^\n]{0,40}\.slice\(/u);

    // 도착 화면 머리말이 랜딩과 같은 수를 말한다. 다른 수를 말하면 사용자는
    // 랜딩에서 셋을 약속받고 도착해서 둘을 읽는다.
    expect(startHere, `도착 화면이 ${PROMISED_COUNT}개를 말하지 않는다`)
      .toMatch(countPhrase(PROMISED_COUNT));
    for (const wrong of [2, 4, 5, 6].filter((n) => n !== PROMISED_COUNT)) {
      expect(startHere, `도착 화면이 ${wrong}가지를 말한다`)
        .not.toMatch(new RegExp(`(${KOREAN_COUNT_WORDS[wrong]}|${wrong})\\s*가지를`, "u"));
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
