import { describe, expect, it } from "vitest";

import { buildAmoraSystemPrompt } from "@/lib/ai/amoraPromptComposer";
import { BETA_SAFE_TOOLS } from "@/lib/ai/tools";
import { isMutatingTool } from "@/lib/ai/mutationTools";
import {
  asksWhereToStart,
  computePreparationPriorities,
  EARLY_STARTING_POINTS,
} from "@/lib/marketing/preparationPriorities";
// **`prompts.ts` 가 쓰는 것과 같은 함수여야 한다.** 같은 이름이 두 곳에 있고
// 시그니처가 다르다 — `@/lib/utils/weddingDate` 는 `Date`, 이쪽은 밀리초다.
// 처음에 다른 쪽을 넣어 `today.getTime is not a function` 으로 죽었다.
import { daysUntilWedding } from "@hanbang/shared";

/**
 * "뭐부터 해야 하나요" 에 아모라가 되묻기만 했다.
 *
 * ## 무엇이 있었나 (2026-08-27 팀 테스트 · 같은 날 재현)
 *
 *     사용자: 결혼 준비를 뭐부터 해야 할지 하나도 모르겠어요. 처음이라 막막해요.
 *     아모라: 처음이라면 결혼식 날짜와 예산 범위부터 두 사람이 정하는 게 좋아요.
 *             지금 가장 먼저 정하고 싶은 건 날짜와 예산 중 어느 쪽인가요?
 *
 * 일반론 한 줄과 질문 하나. 팀 리포트는 이것을 Major 로 적었다.
 *
 * ## 왜 그랬나 — 계약문 탓이 아니다
 *
 * 처음에는 `amoraVoice` 의 억제 규칙("부담이 가장 작은 질문 하나만") 때문이라고 봤다.
 * **틀렸다.** 그 규칙의 조건은 "막힌 지점이 아직 흐리면" 인데 "뭐부터?" 는 흐린 것이
 * 아니라 **명확한 요청**이다. 같은 계약문의 `실행` 역할이 "할 일이 분명하면 필요한
 * 정보를 바로 주세요" 라고 말한다. 계약문은 이미 답을 주라고 했다.
 *
 * 진짜 이유는 **아모라에게 그 답이 없었다는 것**이다. `/start-here` 화면은 결혼일
 * 하나로 "지금 볼 세 가지" 를 계산해 보여주는데(`computePreparationPriorities`),
 * 그 계산이 프롬프트에 실리지 않았다.
 *
 * 같은 파일의 `CHECKLIST_CHECK_POINTS` 가 **같은 이유로 이미 한 번 추가됐다** —
 * 주석에 "같은 제품 안에 답이 있는데도 일반론으로 답했다" 고 적혀 있다.
 * 확인 포인트는 그때 고쳐졌고 순서는 안 고쳐졌다.
 *
 * ## 이 파일이 지키는 것
 *
 * 1. 섹션이 **합성된 프롬프트**에 실제로 남는가 (원본 grep 이 아니다 —
 *    `prompts.ts` 에는 모델에게 안 가는 죽은 구간이 있고 거기 썼다가 배포한 적이 있다).
 * 2. 화면과 **같은 세 가지**인가. 두 곳이 각자 계산하면 대화와 앱이 다른 말을 한다 —
 *    처음 구현했을 때 실제로 그랬다(먼 결혼일 구간에서 화면은 기준 3개, 프롬프트는
 *    항목 3개를 말했다).
 * 3. 시점 문구가 뒤집히지 않는가. `daysUntilStart` 는 **지금부터** 남은 날인데
 *    "예식 N개월 뒤" 로 쓰면 반대가 된다 — 첫 판이 그랬다.
 */

const ENABLED = BETA_SAFE_TOOLS
  .filter((tool) => !isMutatingTool(tool.name))
  .map((tool) => tool.name);

function promptFor(weddingDate: string | null, startingPointAsked = true): string {
  return buildAmoraSystemPrompt(
    {
      startingPointAsked,
      weddingDate,
      budget: 50_000_000,
      venue: null,
      progress: {},
      preparationStatus: null,
      brideName: "신부",
      groomName: "신랑",
      bookings: [],
      scheduleEvents: [],
      chatSummaries: [],
      pastConflicts: [],
      pastDecisions: [],
      senderName: "신부",
    } as never,
    { enabledToolNames: ENABLED, requestKind: "chat", persistenceMode: "durable" } as never,
  );
}

/** 오늘 기준으로 D-day 를 만든다. 고정 날짜를 쓰면 시간이 지나며 분기가 바뀐다. */
function weddingDateInDays(days: number): string {
  const at = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}`;
}

const NEAR = weddingDateInDays(45);
const FAR = weddingDateInDays(450);

describe("측정기가 살아 있다", () => {
  it("두 날짜가 실제로 서로 다른 분기를 탄다 — 아니면 아래 검사가 한쪽만 본다", () => {
    const near = computePreparationPriorities(daysUntilWedding(NEAR, Date.now()));
    const far = computePreparationPriorities(daysUntilWedding(FAR, Date.now()));
    expect(near.activeNow.length, "가까운 날짜인데 시작된 항목이 없다").toBeGreaterThan(0);
    expect(far.activeNow.length, "먼 날짜인데 이미 시작된 항목이 있다").toBe(0);
  });
});

describe("시작점을 묻는 답이 프롬프트에 실린다", () => {
  it("결혼일이 가까우면 지금 확인할 항목이 실린다", () => {
    const prompt = promptFor(NEAR);
    expect(prompt, "섹션이 합성 결과에 없다 — 죽은 구간에 썼거나 배선이 빠졌다")
      .toContain("## 지금 확인할 준비 3가지");
    const { visiblePriorities } = computePreparationPriorities(daysUntilWedding(NEAR, Date.now()));
    for (const priority of visiblePriorities) {
      expect(prompt, `"${priority.label}" 이 프롬프트에 없다`).toContain(priority.label);
    }
  });

  it("결혼일이 없으면 아무것도 싣지 않는다", () => {
    const prompt = promptFor(null);
    expect(prompt).not.toContain("## 지금 확인할 준비 3가지");
    expect(prompt).not.toContain("## 아직 이르면 먼저 맞출 기준 3가지");
  });

  it("일반론으로 답하지 말라고 못박는다", () => {
    expect(promptFor(NEAR)).toContain("일반론");
  });

  it("\"둘 다 모르겠어요\" 에 되묻지 말라고 한다 — 리포트가 유일하게 옳게 짚은 구멍", () => {
    // `toContain("되묻지 말고")` 만으로는 부족하다 — 뒷부분을 "다시 여쭤보세요" 로
    // 바꿔도 앞 조각이 남아 통과한다(변형 검사에서 실제로 샜다). 출구가 무엇인지까지 본다.
    const prompt = promptFor(NEAR);
    expect(prompt).toContain("되묻지 말고");
    expect(prompt, "되묻지 말라고만 하고 대신 무엇을 하라는지 안 알려준다")
      .toContain("첫 걸음 한 가지**를 그대로 제안하세요");
  });

  it("묻지 않은 전체 계획을 펼치지 말라고 한다 — 억제 규칙과 싸우지 않는다", () => {
    /**
     * `amoraVoice` 는 "질문과 함께 완성된 계획까지 한꺼번에 주지 마세요" 라고 한다.
     * 이 섹션이 "세 가지를 다 말해라" 로 읽히면 계약문이 자기와 싸운다.
     * 같은 자기모순을 이 저장소에서 이미 한 번 배포했다(#242 에서 고침).
     */
    const prompt = promptFor(NEAR);
    expect(prompt).toContain("한꺼번에 쏟지 말고");
    expect(prompt).toContain("계획표를 펼치지 마세요");
  });
});

describe("화면과 같은 세 가지를 말한다", () => {
  /**
   * 두 곳이 각자 계산하면 대화와 앱이 다른 말을 한다. 처음 구현했을 때 실제로 그랬다 —
   * 화면은 `activeNow` 가 비면 `EARLY_STARTING_POINTS` 로 갈아타는데 프롬프트는
   * 항목 이름을 계속 나열했다.
   */
  it("아직 이른 구간에서는 화면과 같은 기준 3개를 쓴다", () => {
    const prompt = promptFor(FAR);
    expect(prompt).toContain("## 아직 이르면 먼저 맞출 기준 3가지");
    for (const point of EARLY_STARTING_POINTS) {
      expect(prompt, `"${point.title}" 이 없다 — 화면과 다른 것을 말한다`)
        .toContain(point.title);
    }
  });

  it("아직 이른 구간에서 항목 이름을 나열하지 않는다", () => {
    const prompt = promptFor(FAR);
    const { visiblePriorities } = computePreparationPriorities(daysUntilWedding(FAR, Date.now()));
    const section = prompt.slice(prompt.indexOf("## 아직 이르면 먼저 맞출 기준 3가지"));
    const heading = section.slice(0, section.indexOf("- 일반론"));
    for (const priority of visiblePriorities) {
      expect(heading, `"${priority.label}" 이 기준 자리에 섞였다 — 화면은 이걸 안 보여준다`)
        .not.toContain(priority.label);
    }
  });
});

describe("시점 문구가 뒤집히지 않는다", () => {
  it("아직 시작 전 항목은 '앞으로' 로 말한다 — '예식 뒤' 가 아니다", () => {
    /**
     * `daysUntilStart` 는 지금부터 시작점까지 남은 날이다. 첫 판은 이걸
     * "예식 N개월쯤 뒤부터" 라고 썼다 — 결혼식이 끝난 뒤로 읽힌다.
     */
    // 시작된 항목이 있으면서 아직 안 시작된 항목도 섞이는 구간을 찾는다.
    for (const days of [200, 260, 320, 380]) {
      const date = weddingDateInDays(days);
      const { activeNow, visiblePriorities } =
        computePreparationPriorities(daysUntilWedding(date, Date.now()));
      if (activeNow.length === 0) continue;
      if (!visiblePriorities.some((priority) => !priority.started)) continue;
      const prompt = promptFor(date);
      expect(prompt, `D-${days} 구간에서 시점 문구가 뒤집혔다`)
        .not.toMatch(/아직 시작 전 — 예식 \d+개월쯤 뒤부터/u);
      expect(prompt).toMatch(/아직 시작 전 — 앞으로 \d+개월쯤 뒤부터/u);
      return;
    }
    // 섞이는 구간을 못 찾으면 이 검사는 아무것도 지키지 못한다.
    throw new Error("시작된 항목과 안 된 항목이 섞이는 D-day 구간을 못 찾았다");
  });
});

describe("묻지 않은 턴에는 한 글자도 싣지 않는다", () => {
  /**
   * **왜 조건부인가.** 아모라 시스템 프롬프트 상한은 48,000자인데 운영에서 문맥이
   * 가장 많은 커플(일정 18 · 요약 1)은 이미 그 천장에 붙어 있다. 매 턴 실으면
   * 저장 문맥 꼬리가 그만큼 더 잘린다(실측 427자).
   *
   * 그래서 시작점을 묻는 턴에만 싣는다 — 그 턴에서는 순서가 정확히 필요한 것이고,
   * 나머지 턴에서는 **0자**다. 상한을 올리지 않아도 되는 이유가 이것이다.
   */
  it("플래그가 없으면 섹션이 없다", () => {
    const prompt = promptFor(NEAR, false);
    expect(prompt).not.toContain("## 지금 확인할 준비 3가지");
    expect(prompt).not.toContain("## 아직 이르면 먼저 맞출 기준 3가지");
  });

  it("플래그만 다르고 나머지가 같으면 그 섹션 길이만큼만 차이 난다", () => {
    const asked = promptFor(NEAR, true);
    const quiet = promptFor(NEAR, false);
    expect(asked.length, "묻는 턴이 더 길어야 한다").toBeGreaterThan(quiet.length);
    // 섹션 하나 분량. 크게 벗어나면 다른 것이 함께 딸려 들어온 것이다.
    expect(asked.length - quiet.length).toBeLessThan(900);
  });
});

describe("시작점을 묻는지 가리는 판정", () => {
  it.each([
    "결혼 준비를 뭐부터 해야 할지 하나도 모르겠어요",
    "뭐부터 해야 해?",
    "무엇부터 준비하면 되나요",
    "어디서부터 손대야 할지 모르겠어요",
    "뭐 먼저 할까?",
    "순서를 모르겠어요",
    "어떻게 시작해야 하나요",
    "처음이라 막막해요",
  ])("묻는 말로 본다: %s", (text) => {
    expect(asksWhereToStart(text), "시작점 질문인데 못 알아본다").toBe(true);
  });

  it.each([
    "드레스 피팅 6월 12일로 잡아줘",
    "예산 3천만원으로 바꿔줘",
    "예식장 계약할 때 뭘 확인해야 해?",
    "남편이랑 하객 수로 의견이 갈려요",
    "축의금은 보통 얼마나 하나요",
    "",
  ])("묻는 말이 아니다: %s", (text) => {
    expect(asksWhereToStart(text), "엉뚱한 턴에 순서 목록이 실린다").toBe(false);
  });

  it("문자열이 아니면 false", () => {
    expect(asksWhereToStart(null)).toBe(false);
    expect(asksWhereToStart(undefined)).toBe(false);
    expect(asksWhereToStart(42)).toBe(false);
  });
});
