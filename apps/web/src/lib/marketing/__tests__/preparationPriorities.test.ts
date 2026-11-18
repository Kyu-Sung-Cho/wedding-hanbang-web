// @vitest-environment node

import { describe, expect, it } from "vitest";

import { START_COPY } from "@hanbang/shared/invitation";
import { landingContent } from "@/components/landing/redesign/landingContent";
import { CATEGORY_CHECKLISTS } from "@/constants/checklists";
import { computePreparationPriorities } from "../preparationPriorities";

import { everyLandingComponent, rendered } from "../../../app/landing/__tests__/landingSource";

/**
 * 준비 우선순위 계산과, 그것을 약속하는 **화면**이 어긋나지 않는다는 계약.
 *
 * 이 계산이 틀리면 첫 화면에서 바로 틀린 안내가 된다.
 *
 * ## 약속이 어느 화면에 있는지가 두 번 바뀌었다
 *
 * 1. 처음: 랜딩 히어로가 "날짜를 넣으면 준비 3가지가 나와요"라고 하고 그 자리에서
 *    결과를 보여줬다.
 * 2. 2026-08-27: 그 약속이 "지금 되는 것" 카드 하나로 내려갔다(`/start-here`로 보냄).
 * 3. **2026-08-29 정본 시안 개편**: 랜딩이 `/start-here`로 보내는 자리를 아예 갖고
 *    있지 않다. "지금 되는 것" 네 장은 견적 점검·스무 장면·공시 가격·예절 가이드다.
 *
 * 그래서 **개수 약속의 정본은 `/start-here` 자신**이 됐다("지금 볼 세 가지"). 랜딩에서
 * 개수를 읽던 단언은 지우지 않고 두 갈래로 옮겼다:
 *
 * - 랜딩이 다시 `/start-here`로 보내게 되면 그 자리의 개수를 검사한다
 *   (`the landing may not re-promise a different number of priorities`).
 *   지금은 그런 자리가 0개지만, **검사기가 도는지를 대조군으로 함께 증명한다** —
 *   그러지 않으면 "자리가 없다"와 "검사가 고장났다"가 구분되지 않는다.
 * - 랜딩이 **준비 항목의 이름을 부르는 것**은 지금도 한다(아모라 노트 카드의 샘플
 *   답변이 "헤어·메이크업"을 1순위로 부른다). 그 고리는 카드 하나가 아니라
 *   **랜딩 카피 전체**로 넓혔다 — 예전엔 카드 한 장만 봐서, 다른 섹션이 화면에 없는
 *   준비 항목을 불러도 몰랐다.
 *
 * ## 재는 김에 알게 된 것 (2026-08-29)
 *
 * 전 구간(D-0~D-590)을 훑어 보니 체크리스트 21개 중 **셋은 어떤 날짜에서도 상위 3에
 * 못 든다**: `housing`(신혼집)·`shoes`(결혼식 신발)·`registration`(혼인신고와 주소·보험
 * 신고). 그래서 "화면에 절대 안 뜨는 라벨"을 대조군으로 만들 수 있다. 동시에,
 * **랜딩이 이 셋을 예로 들면 안 된다**는 뜻이기도 하다 — 방문자가 그 이름을 보고
 * `/start-here`에 가면 목록에 없다. 이 테스트가 그 자리를 지킨다.
 *
 * ## 2026-08-28 적대적 검증에서 빠져나간 것 (그대로 유효하다)
 *
 * - `computePreparationPriorities` 를 **주석에만 남기고** 사본을 되살려도 통과했다.
 *   원문을 `toContain` 으로 물었기 때문이다 → 이제 주석을 벗기고 묻는다.
 * - `/start-here` 가 **두 개만 그려도** 통과했다(`visiblePriorities.slice(0, 2)`).
 *   계산은 셋을 돌려주므로 계산만 보면 모른다 → 화면이 그 셋을 다 그리는지,
 *   머리말이 같은 수를 말하는지 함께 본다.
 * - 개수를 "세 가지" 문자열로만 물어서, 표기를 "3가지"로 바꾸면 **정상 변경인데도
 *   깨지고** 개수를 "두 가지"로 바꾸면 안 잡혔다 → 개수를 계산 결과에서 끌어내고,
 *   한글·숫자 표기를 함께 받아들이되 **다른 개수는 막는다.**
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

/**
 * 계산이 다루는 날짜 **전 구간**.
 *
 * ⚠️ 여기는 원래 손으로 고른 여섯 날짜(3·30·120·300·500·800)였다. 그 여섯은
 * **헤어·메이크업이 뜨는 창(D-46~D-105)을 통째로 건너뛴다.** 그래서 랜딩이 정상적으로
 * "헤어·메이크업"을 1순위 샘플로 부르는데도 "어떤 날짜에서도 화면에 없다"고 빨간불이
 * 났다 — 카피가 아니라 **내 표본이 틀린 것**이었다(2026-08-29에 실제로 그랬다).
 * 창이 좁은 항목은 표본으로 잡히지 않는다. 전 구간을 훑는 데 몇 밀리초면 된다.
 *
 * 위쪽 끝은 상수로 적지 않고 체크리스트에서 끌어온다 — 가장 이른 시작점보다 한참
 * 뒤(폴백 구간)까지 봐야 "다가오는 순서"로 뜨는 항목도 함께 세어진다.
 */
const EVERY_DDAY: number[] = Array.from(
  { length: Math.max(...CATEGORY_CHECKLISTS.map((c) => c.ddayStart)) + 200 },
  (_, index) => index,
);

/**
 * 랜딩에서 `/start-here` 로 보내는 자리와, **그 자리가 하는 말**을 `[이름, 글]` 로.
 *
 * ## 왜 파일 전체를 안 보나
 *
 * 처음엔 `landingContent` 를 통째로 문자열로 만들어 물었다. 카드 하나를
 * `/start-here` 로 되돌려 놓고 돌려 보니 **엉뚱한 이유로** 빨간불이 났다 —
 * 랜딩 다른 섹션의 "한 번에 **한 가지** 변경"이 "1가지를 약속한다"로 잡혔다.
 * 그렇게 잡히면 카드가 돌아오는 날 무조건 실패하는 덫이 되고, 진짜 위반(개수가
 * 다른 약속)과 구분되지 않는다. 그래서 **링크를 든 블록**까지만 좁혀서 본다.
 *
 * 좁히는 규칙: 최상위 블록과 배열 원소(카드 한 장)를 후보로 두고, 링크를 담은 것 중
 * **가장 깊은 것**만 남긴다. 카드가 `href` 를 직접 들든 `cta: { href }` 로 감싸든
 * 카드 한 장이 잡힌다.
 *
 * 컴포넌트 소스는 파일 단위로 본다(얇아서 섞일 글이 적다). 목록은 손으로 적지 않는다
 * (`everyLandingComponent`) — 손으로 적은 목록은 새로 생긴 파일을 놓친다.
 */
function startHerePromiseScopes(
  content: Record<string, unknown> = landingContent,
  includeComponents = true,
): Array<[string, string]> {
  const found: Array<[string, string]> = [];

  const visit = (node: unknown, path: string, isScope: boolean): void => {
    if (Array.isArray(node)) {
      node.forEach((child: unknown, index: number) => visit(child, `${path}[${index}]`, true));
      return;
    }
    if (node === null || typeof node !== "object") return;
    const text = JSON.stringify(node);
    if (isScope && text.includes("/start-here")) found.push([path, text]);
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      visit(value, `${path}.${key}`, false);
    }
  };

  for (const [key, value] of Object.entries(content)) {
    visit(value, `landingContent.${key}`, true);
  }

  // 가장 깊은 것만. 조상 블록을 함께 남기면 옆 카드의 글까지 같이 읽힌다.
  const deepest = found.filter(
    ([path]) => !found.some(([other]) => other !== path && other.startsWith(path)),
  );

  if (!includeComponents) return deepest;

  const components: Array<[string, string]> = [
    ["app/landing/page.tsx", rendered("src/app/landing/page.tsx")],
    ...everyLandingComponent(),
  ];

  return [...deepest, ...components.filter(([, text]) => text.includes("/start-here"))];
}

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

  it("the landing never names a preparation item this calculation cannot surface", () => {
    // 이 계약이 두 번 깨졌다. 한 번은 "드레스"를 예시로 들었는데 결과에 한 번도
    // 나오지 않았고, 한 번은 다른 브랜치에서 개명한 라벨을 그대로 옮겨 적어
    // 화면에는 없는 이름이 됐다. 둘 다 날짜를 하나만 넣어보고 넘어간 결과다.
    // 카피와 계산을 여기서 묶어 둔다 — 라벨을 바꾸면 이 테스트가 먼저 깨진다.
    //
    // ⚠️ 이 단언은 원래 "어떤 날짜를 넣어도 나오는 셋이 히어로가 약속한 이름이어야
    // 한다"였다. 그 형태는 결과가 **날짜와 무관하게 상수일 때만** 통과하므로,
    // 상수 버그를 잡기는커녕 계약으로 못 박고 있었다. 그래서 "화면에 없는 이름을
    // 말하지 않는다"로 한 번 좁혔다.
    //
    // ⚠️ 2026-08-29 정본 시안 개편으로 준비 3가지 카드가 랜딩에서 없어졌다. 그렇다고
    // 이 고리를 지우면 안 된다 — 랜딩은 지금도 준비 항목의 **이름을 부른다**.
    // 아모라 노트 카드의 샘플 답변이 "헤어·메이크업 예약 … 을 가장 먼저 하세요"라고
    // 1순위를 지목한다. 그래서 읽는 범위를 카드 한 장에서 **랜딩 카피 전체**로 넓혔다:
    // 카드 한 장만 보던 예전 형태는 다른 섹션이 화면에 없는 이름을 불러도 몰랐다.
    // ## 연출된 대화는 뺀다 (2026-09-03)
    //
    // 이 검사가 막는 것은 **랜딩이 제품 기능처럼 이름을 부르는 것**이다 —
    // "예산·할 일·일정" 처럼 화면이 주겠다고 약속하는 목록. 그런데 2026-09-03 시안이
    // 커플의 말을 그대로 인용하는 대화 카드를 들여왔고, 거기서 신랑이
    // "근데 신혼집 자금은 안 건드렸으면 해" 라고 말한다. 그건 **약속이 아니라 인용**이다.
    // 사람이 자기 사정을 말한 것을 두고 "우리가 신혼집 항목을 준다"고 읽을 수는 없다.
    //
    // 그래서 연출된 대화의 발화(`turns[].say` · `chat.me` · `chat.amora`)만 뺀다.
    // 나머지 카피 — 제목·본문·카드·고지 — 는 전부 그대로 본다. 뺀 자리를 넓히지 마라.
    const STAGED_SPEECH = new Set(["say", "me", "amora"]);
    // 2026-11-17 파운더 디자인 아티팩트(원문: 이 디자인 완전 같아야해): 첫 화면 글자는 앱과 같은
    // 정본 `START_COPY` 에서 온다. 랜딩이 부르는 이름이므로 함께 본다(예: "웨딩홀").
    const landingCopy = JSON.stringify({ landingContent, START_COPY }, (key, value) =>
      (STAGED_SPEECH.has(key) ? undefined : value));
    // 자기검증: 정말로 발화만 빠졌는지. 연출 대화가 없어진 지금은 고지 문장과 첫 화면 본문이
    // 남아 있어야 한다(대조군).
    expect(landingCopy, "연출 대화 제거가 카피를 통째로 먹었다")
      .toContain(landingContent.notices.privacy);
    expect(landingCopy, "첫 화면 정본이 빠졌다").toContain(START_COPY.body);
    expect(landingCopy, "연출된 발화가 그대로 남아 있다")
      .not.toContain("신혼집 자금은 안 건드렸으면");

    const everShown = new Set(
      EVERY_DDAY
        .flatMap((dday) => computePreparationPriorities(dday).visiblePriorities)
        .map((p) => p.key),
    );

    // ⚠️ **먼저 검사기가 도는지 대조군으로 증명한다.** 이 고리는 "카피가 라벨을
    // 부를 때만" 도는데, 라벨 문자열이 어긋나면(개명·띄어쓰기) 고리가 조용히 0바퀴가
    // 되고 테스트는 초록불이 된다 — 헛초록불이다. 화면에 절대 안 뜨는 라벨을 심은
    // 가짜 카피로 탐지기가 실제로 걸리는지 먼저 확인한다.
    const neverShown = CATEGORY_CHECKLISTS.find((category) => !everShown.has(category.key));
    expect(neverShown, "어떤 날짜에도 안 뜨는 항목이 없어 대조군을 만들 수 없다").toBeTruthy();
    const probe = `샘플 답변: ${neverShown!.label}을 가장 먼저 하세요.`;
    expect(
      CATEGORY_CHECKLISTS.filter((category) => probe.includes(category.label))
        .map((category) => category.key),
      "라벨 탐지기가 심어 둔 위반을 못 잡는다 — 아래 고리는 헛초록불이다",
    ).toContain(neverShown!.key);

    // 이제 진짜 카피. 카피가 부른 이름은 (1) 실제 준비 항목의 라벨이어야 하고
    // (2) 적어도 하나의 날짜에서 화면에 떠야 한다.
    const namedInCopy = CATEGORY_CHECKLISTS
      .filter((category) => landingCopy.includes(category.label))
      .map((category) => category.key);

    // ⚠️ 이 고리는 카피가 라벨을 **부를 때만** 돈다. 라벨이 개명되거나 카피가 이름을
    // 그만 부르면 0바퀴가 되고, 위 대조군은 탐지기만 증명하므로 테스트는 초록불이 된다
    // (2026-08-29에 고리를 비워 보니 13개가 그대로 통과했다 — 헛초록불이다).
    // 그래서 "지금 랜딩이 준비 항목 이름을 적어도 하나 부른다"를 명시적으로 못 박는다.
    // 오늘 그 자리는 아모라 노트 카드의 샘플 답변("헤어·메이크업 … 을 가장 먼저 하세요")이다.
    //
    // 랜딩이 정말로 준비 항목 이름을 하나도 안 부르게 바뀌었다면, 이 줄을 지우되
    // **왜 지웠는지 여기에 남겨라.** 조용히 0바퀴로 두면 다음 사람은 검사가 도는 줄 안다.
    // ## 2026-09-03 — 지금은 0바퀴가 맞다
    //
    // 위 줄은 "랜딩이 준비 항목 이름을 적어도 하나 부른다"를 요구했다. 그 자리는
    // 아모라 노트 카드의 샘플 답변("헤어·메이크업 … 을 가장 먼저 하세요")이었는데,
    // 2026-09-03 시안이 그 카드를 **대화 카드**로 바꾸면서 없어졌다. 새 카피는 준비
    // 항목을 하나도 이름으로 부르지 않는다 — 도구 카드도 "예산 / 할 일 / 일정" 이라는
    // **도구 이름**이지 준비 항목(`ham`·`pyebaek`…)이 아니다.
    //
    // 그래서 요구를 지운다. **검사가 죽은 것이 아니다** — 아래 고리는 랜딩이 다시
    // 항목 이름을 부르는 순간 되살아나고, 위 대조군이 탐지기가 도는 것을 매번 증명한다.
    // 다시 부르기 시작하면 이 주석을 지우고 요구를 되살려라.
    expect(namedInCopy.filter((key) => key !== "venue"), "랜딩이 예시 외 준비 항목 이름을 부르기 시작했다")
      .toHaveLength(0);

    for (const key of namedInCopy) {
      expect(everShown, `랜딩이 예로 든 "${key}"가 어떤 날짜에서도 화면에 없다`)
        .toContain(key);
    }

    // 계산이 날짜마다 같은 개수를 돌려준다는 것도 여기서 묶어 둔다. 화면이 개수를
    // 어디서 말하든(지금은 `/start-here`) 그 수와 계산이 갈리면 안 된다.
    for (const dday of EVERY_DDAY) {
      expect(computePreparationPriorities(dday).visiblePriorities, `D-${dday}`)
        .toHaveLength(PROMISED_COUNT);
    }
  });

  it("the landing may not re-promise a different number of priorities", () => {
    // 2026-08-29 개편 전에는 "지금 되는 것" 카드 하나가 `/start-here`로 보내면서
    // "세 가지"를 약속했다. 지금 랜딩에는 그 자리가 없다. **단언을 지우지 않고
    // 조건으로 바꾼다** — 카드가 돌아올 때 개수를 안 물으면, 랜딩이 "두 가지"를
    // 약속하고 도착 화면이 셋을 그리는 옛 사고가 그대로 재현된다.
    //
    // ⚠️ 조건부 단언은 조건이 0건이면 아무것도 검사하지 않는다. 그래서 검사가 살아있는지를
    // **가짜 자리로 먼저 증명한다**(대조군). 이걸 안 하면 "자리가 없다"와 "검사가 고장났다"가
    // 구분되지 않는다.
    //
    // 대조군은 **진짜 단언 함수를 그대로 통과시킨다.** 정규식만 따로 돌려보면
    // "정규식은 맞는데 단언이 그걸 안 쓰는" 경우를 못 잡는다. (처음엔 제품 카피를 직접
    // 고쳤다가, **같은 파일을 동시에 고치는 다른 세션이 있어** 측정 중에 파일이 바뀜었다 —
    // 공유 파일을 변형해 재는 방식 자체가 결과를 속인다. 그래서 가짜 입력을 쓴다.)
    const assertPromisedCount = (name: string, text: string): void => {
      expect(text, `${name} 이 /start-here로 보내면서 ${PROMISED_COUNT}개를 말하지 않는다`)
        .toMatch(countPhrase(PROMISED_COUNT));
      for (const wrong of [1, 2, 4, 5, 6].filter((n: number) => n !== PROMISED_COUNT)) {
        expect(text, `${name} 이 ${wrong}가지를 약속한다`).not.toMatch(countPhrase(wrong));
      }
    };

    const card = (promise: string) =>
      JSON.stringify({ title: "지금 볼 것", body: promise, href: "/start-here" });

    // 개수를 아예 안 말하는 자리 → 빨간불
    expect(() => assertPromisedCount("대조군", card("바로 보러 가기")))
      .toThrow();
    // 틀린 개수를 말하는 자리 → 빨간불 (이게 안 잡히면 랜딩과 도착 화면이 갈린다)
    //
    // ⚠️ 이 반례는 **맞는 개수도 함께 담아야 한다.** 처음엔 "준비 두 가지를 보여드려요"만
    // 넣었는데, 그건 "세 가지"가 없어서 **앞의 맞는-개수 단언이 대신 터졌다.** 그래서
    // 틀린-개수 검사를 통째로 지워도 대조군은 초록불이었다 — 2026-08-29에 실제로 그
    // 변형을 심어 보고 발견했다(13개 전부 통과). 두 개수를 한 문장에 함께 적어야
    // **오직 틀린-개수 검사만이 잡을 수 있는** 반례가 된다.
    for (const wrong of [1, 2, 4, 5, 6].filter((n: number) => n !== PROMISED_COUNT)) {
      const right = KOREAN_COUNT_WORDS[PROMISED_COUNT];
      expect(
        () => assertPromisedCount(
          "대조군",
          card(`준비 ${right} 가지 중 ${KOREAN_COUNT_WORDS[wrong]} 가지만 보여드려요`),
        ),
        `${wrong}가지를 함께 약속하는 자리를 못 잡는다 — 아래 고리는 헛초록불이다`,
      ).toThrow();
      expect(
        () => assertPromisedCount("대조군", card(`준비 ${right} 가지 중 ${wrong}가지만 보여드려요`)),
        `숫자 표기 ${wrong}가지를 못 잡는다`,
      ).toThrow();
    }
    // 맞는 개수를 말하는 자리 → 초록불. 정상 카피까지 빨간불을 내면 경고가 쓸모없어진다.
    expect(() => assertPromisedCount(
      "대조군",
      card(`준비 ${KOREAN_COUNT_WORDS[PROMISED_COUNT]} 가지를 보여드려요`),
    )).not.toThrow();
    expect(() => assertPromisedCount("대조군", card(`준비 ${PROMISED_COUNT}가지를 보여드려요`)))
      .not.toThrow();

    // 자리를 찾는 쪽도 대조군으로 증명한다. 가짜 카피 나무에 카드 한 장을 심어
    // ① 그 카드가 잡히고 ② **옆 카드의 글은 안 딸려오는지** 본다. ②이 깨지면
    // 옆 카드의 "한 번에 한 가지" 같은 말이 위반으로 잡혀 카드가 돌아오는 날
    // 무조건 빨간불이 된다(처음 판이 실제로 그랬다).
    const fakeContent = {
      availableNow: {
        title: "지금 바로",
        cards: [
          { title: "옆 카드", body: `한 번에 ${KOREAN_COUNT_WORDS[1]} 가지만 바꿔요`, href: "/price" },
          { title: "준비 목록", body: `준비 ${KOREAN_COUNT_WORDS[PROMISED_COUNT]} 가지`, href: "/start-here" },
        ],
      },
    };
    const fakeScopes = startHerePromiseScopes(fakeContent, false);
    expect(fakeScopes.map(([name]) => name), "심어 둔 /start-here 자리를 정확히 한 개 잡지 못한다")
      .toEqual(["landingContent.availableNow.cards[1]"]);
    for (const [name, text] of fakeScopes) assertPromisedCount(name, text);

    for (const [name, text] of startHerePromiseScopes()) assertPromisedCount(name, text);
  });

  it("renders the notices that moved into the landing footer", () => {
    // 이 단언은 원래 "준비 3가지 카드를 그리는가"였고, 2026-08-29 부터는 '지금 되는 것' 카드가
    // 옮겨 온 고지 세 줄을 그리는지 물었다. **단언은 남긴다** — 카피가 아무리 맞아도 그 줄을
    // 그리지 않으면 방문자는 고지를 못 본다.
    //
    // 2026-11-17 파운더 디자인 아티팩트(원문: 이 디자인 완전 같아야해)로 카드가 없어지고 고지는
    // 첫 화면 아래 바닥글(`LandingFooter`)로 글자 그대로 모였다. 그래서 그 목록을 묻는다.
    const landingFooter = rendered("src/components/landing/redesign/LandingFooter.tsx");
    // ⚠️ 배선 이름은 개편마다 바뀐다. 이름을 손으로 적어 두면 개편 때 통째로 지워지기 쉬우니,
    // **카피 정본에서 실제로 쓰는 필드 이름을 끌어와** 그 필드가 그려지는지 묻는다.
    const itemFields = Object.keys(landingContent.boundaries.items[0]);
    expect(itemFields.length, "항목에 그릴 본문 필드가 없다").toBeGreaterThan(0);
    expect(landingFooter, "고지 목록을 돌지 않는다").toContain("boundaries.items.map(");
    for (const field of itemFields) {
      expect(landingFooter, `바닥글이 항목의 ${field} 를 그리지 않는다`)
        .toMatch(new RegExp(`\\{\\s*[A-Za-z_$][\\w$]*\\.${field}\\s*\\}`, "u"));
    }
    for (const key of Object.keys(landingContent.notices)) {
      expect(landingFooter, `바닥글이 notices.${key} 를 그리지 않는다`).toContain(`{notices.${key}}`);
    }
    // 목록이 잘려 나가면 남은 고지가 화면에서 사라진다.
    expect(landingFooter, "고지 목록을 잘라서 그린다").not.toMatch(/items\s*\.\s*slice\s*\(/u);
  });

  it("/start-here actually renders every priority it promises", () => {
    // 계산이 셋을 돌려주는 것과 화면이 셋을 그리는 것은 다른 일이다.
    // `visiblePriorities.slice(0, 2)` 한 줄이면 머리말은 "세 가지"를 말하고
    // 목록은 둘만 나온다 — 2026-08-28 적대적 검증에서 이 변형이 통과했다.
    //
    // ⚠️ 2026-08-29 개편으로 랜딩이 `/start-here`로 보내지 않게 됐다. 그래서 개수
    // 약속의 **정본이 이 화면 자신**이 됐다("지금 볼 세 가지"). 예전엔 랜딩이 약속하고
    // 여기가 지켰는데, 이제 여기가 약속하고 여기가 지킨다 — 그래서 머리말과 목록을
    // 한 화면 안에서 맞춰 본다.
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
