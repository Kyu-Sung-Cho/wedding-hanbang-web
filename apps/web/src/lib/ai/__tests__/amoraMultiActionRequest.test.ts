import { describe, expect, it } from "vitest";

import {
  AMORA_SYSTEM_PROMPT_MAX_CHARS,
  buildAmoraSystemPrompt,
} from "@/lib/ai/amoraPromptComposer";
import {
  buildAmoraPendingActionPrompt,
  extractAmoraPendingAction,
  isAmoraFailedProposalNotice,
} from "@/lib/ai/amoraPendingAction";
import { getAmoraActionApprovalPolicy } from "@/lib/ai/amoraActionApprovalPolicy";
import {
  classifyAmoraQuestionScope,
  filterAmoraToolsByQuestionScope,
} from "@/lib/ai/amoraQuestionScope";
import { isMutatingTool } from "@/lib/ai/mutationTools";
import { selectAmoraPendingProposalTools } from "@/lib/ai/amoraToolPolicy";
import { BETA_SAFE_TOOLS } from "@/lib/ai/tools";

/**
 * 한 턴에 여러 건을 부탁하면 카드가 **하나도** 안 나온다(2026-09-03 감사, 1차 Raw
 * Turn 14~16 / 2차 Turn 16). 서버는 표식이 둘 이상이면 둘 다 버리는데, 계약문에는
 * "정확히 하나" 만 있고 **요청이 여러 건일 때 무엇을 하라는 줄이 없었다.**
 *
 * 그래서 두 곳을 본다.
 *  1. 합성된 프롬프트(원본 파일이 아니라)에 여러 건 처리 순서가 실려 있는가.
 *  2. 그래도 표식이 둘 오면 서버가 남기는 말이 **다음 행동을 지목**하는가.
 */

const PENDING_ACTION_TOOLS = BETA_SAFE_TOOLS.filter((tool) =>
  isMutatingTool(tool.name));

const MULTI_REQUEST_USER_TEXT = "예산 6천으로 올리고 상견례도 다음 주 토요일로 잡아줘";

const EMPTY_CONTEXT = {
  startingPointAsked: false,
  weddingDate: null,
  budget: null,
  venue: null,
  progress: {},
  preparationStatus: "preparing",
  brideName: null,
  groomName: null,
  neutralMemberPresentation: false,
  senderName: null,
  bookings: [],
  scheduleEvents: [],
  chatSummaries: [],
  preferences: undefined,
  helpPreference: null,
  amoraProfiles: { shared: null, private: null },
  pastDecisions: [],
  pastConflicts: [],
};

/** route.ts 와 같은 순서로 도구를 고른 뒤 **합성된** 시스템 프롬프트를 만든다. */
function composeProposalPromptLikeProduction(userText: string): string {
  const questionScope = classifyAmoraQuestionScope({ userText });
  const proposableTools = filterAmoraToolsByQuestionScope(
    selectAmoraPendingProposalTools({
      availableTools: PENDING_ACTION_TOOLS,
      userText,
      specialistType: "general",
      checklistLabels: [],
      attachmentKind: "none",
    } as never).filter((tool) =>
      getAmoraActionApprovalPolicy(tool.name) !== "blocked"),
    questionScope,
  );
  expect(proposableTools.length).toBeGreaterThan(0);

  return buildAmoraSystemPrompt(EMPTY_CONTEXT as never, {
    specialist: "general",
    requestKind: "chat",
    persistenceMode: "durable",
    enabledToolNames: [],
    actionContract: {
      kind: "proposal",
      text: buildAmoraPendingActionPrompt(proposableTools),
    },
    questionScope,
    maxChars: AMORA_SYSTEM_PROMPT_MAX_CHARS,
  } as never);
}

function extract(text: string) {
  return extractAmoraPendingAction({
    text,
    allowedTools: PENDING_ACTION_TOOLS.filter((tool) =>
      tool.name === "update_budget" || tool.name === "add_schedule_event"),
    now: Date.UTC(2026, 8, 3, 12, 0, 0),
    createActionId: () => "11111111-1111-4111-8111-111111111111",
  });
}

const BUDGET_TAG =
  '[pending_action]{"tool":"update_budget","input":{"total_budget":60000000},'
  + '"confirmation":"총 예산을 6,000만 원으로 바꿀까요?"}[/pending_action]';
const SCHEDULE_TAG =
  '[pending_action]{"tool":"add_schedule_event","input":{"title":"상견례",'
  + '"event_date":"2026-09-12"},"confirmation":"상견례 일정을 추가할까요?"}'
  + "[/pending_action]";

describe("여러 건 요청 계약이 합성된 프롬프트에 있다", () => {
  it("첫 건은 이번 답변에 내고 나머지는 이어서 제안하라는 순서가 실린다", () => {
    const prompt = composeProposalPromptLikeProduction(MULTI_REQUEST_USER_TEXT);

    // 원본 파일이 아니라 **모델이 실제로 받는 문자열**에 묻는다. 절단 예산에
    // 밀려 사라지면 이 단언이 빨간불이 된다.
    //
    // 2026-09-03 문구가 바뀌었다. 옛 문구는 "첫 번째 건만 표식으로 내고" 였는데,
    // 모델이 그것을 **능력 부정**으로 옮겨 적었다 — 일정 3건을 한 번에 부탁하면
    // "한 번에 하나만 등록할 수 있어요" 로 답하고 표식을 아예 내지 않았다
    // (스테이징 일괄 등록 카드 0건). 순서 규칙은 그대로고, 첫 건을 **이번
    // 답변에** 내라는 것이 명시됐다.
    expect(prompt).toContain("첫 번째 건의 표식은 이번 답변에 반드시 내고");
    expect(prompt).toContain("이어서 제안하겠다고 말하세요");
  });

  it("계약문이 실리는 턴이면 길이 상한 안에서 함께 실린다", () => {
    const prompt = composeProposalPromptLikeProduction(MULTI_REQUEST_USER_TEXT);

    expect(prompt.length).toBeLessThanOrEqual(AMORA_SYSTEM_PROMPT_MAX_CHARS);
    // 같은 계약문 안의 이웃 규칙이 밀려나지 않았는지 함께 본다.
    expect(prompt).toContain("**반드시 정확히 하나**");
  });
});

describe("표식이 둘 이상이면 서버가 남기는 말", () => {
  // 2026-09-04: 첫 건을 살린다. `SCHEDULE_TAG` 는 선언되지 않은 키(`event_date`)를
  // 써서 검증을 통과하지 못하므로, 통과한 첫 표식인 예산 건이 카드가 된다.
  it("통과한 첫 표식은 카드로 내고 나머지가 어떻게 되는지 말한다", () => {
    const result = extract(`알겠어요.\n${BUDGET_TAG}\n${SCHEDULE_TAG}`);

    expect(result.pendingAction?.tool).toBe("update_budget");
    expect(result.hadPendingActionTag).toBe(true);
    expect(result.cleanText).toContain("총 예산: 6,000만 원");
    // 나머지가 조용히 사라지면 사용자는 둘 다 된 줄 안다. 서버가 직접 말한다.
    expect(result.cleanText).toContain("나머지 1건은 이 확인이 끝나면 이어서 제안할게요.");
    // 카드가 나간 턴은 실패 안내가 아니다 — 이력에서 빼면 안 된다.
    expect(isAmoraFailedProposalNotice(result.cleanText)).toBe(false);
  });

  it("통과한 표식이 하나도 없으면 다음에 무엇을 하면 되는지 지목한다", () => {
    const brokenSchedule = SCHEDULE_TAG;
    const brokenBudget =
      '[pending_action]{"tool":"update_budget","input":{"budget_total":60000000}}'
      + "[/pending_action]";
    const result = extract(`알겠어요.\n${brokenBudget}\n${brokenSchedule}`);

    expect(result.pendingAction).toBeNull();
    expect(result.hadPendingActionTag).toBe(true);
    // "하나씩 말씀해 주시면" 만으로는 나머지 요청이 어떻게 되는지 알 수 없다.
    expect(result.cleanText).toContain("먼저 바꾸고 싶은 것 한 가지만");
    expect(result.cleanText).toContain("나머지는 이어서 도와드릴게요");
  });

  it("일정 3건이면 첫 건 카드와 나머지 2건 안내가 함께 나간다", () => {
    // 라이브에서 사용자가 실제로 한 요청이다 — 날짜·제목이 다 적힌 세 건.
    // 그때는 카드가 0개였다(모델이 표식을 아예 안 냈고, 냈어도 서버가 다 버렸다).
    const event = (date: string, title: string) =>
      `[pending_action]{"tool":"add_schedule_event","input":{"date":"${date}",`
      + `"title":"${title}"}}[/pending_action]`;
    const result = extract([
      "세 개 모두 등록할게요.",
      event("2026-09-10", "신혼집 지역 정하기"),
      event("2026-09-11", "예식장 견적 문의"),
      event("2026-09-12", "사진 예산 합의"),
    ].join("\n"));

    expect(result.pendingAction?.tool).toBe("add_schedule_event");
    expect(result.pendingAction?.input).toEqual({
      date: "2026-09-10",
      title: "신혼집 지역 정하기",
    });
    expect(result.cleanText).toContain("- 제목: \"신혼집 지역 정하기\"");
    expect(result.cleanText).toContain("나머지 2건은 이 확인이 끝나면 이어서 제안할게요.");
    // 두 번째·세 번째 일정은 카드가 되지 않는다 — 확인 대상은 언제나 하나다.
    expect(result.cleanText).not.toContain("예식장 견적 문의");
    expect(result.cleanText).not.toContain("사진 예산 합의");
  });

  it("표식이 하나도 없으면 본문을 건드리지 않는다", () => {
    const result = extract("예식장 후보 세 곳을 비교해 볼까요?");

    expect(result.pendingAction).toBeNull();
    expect(result.hadPendingActionTag).toBe(false);
    expect(result.cleanText).toBe("예식장 후보 세 곳을 비교해 볼까요?");
  });

  it("표식이 하나면 서버 확인문이 그대로 나간다", () => {
    const result = extract(`알겠어요.\n${BUDGET_TAG}`);

    expect(result.pendingAction).not.toBeNull();
    expect(result.cleanText).toContain("다음 변경을 적용할까요?");
    expect(result.cleanText).toContain("총 예산: 6,000만 원");
    expect(isAmoraFailedProposalNotice(result.cleanText)).toBe(false);
  });

  it("같은 표식을 두 번 쓴 것에는 여러 건 안내를 쓰지 않는다", () => {
    // 사용자는 한 가지만 부탁했다. "하나씩 말씀해 달라" 고 하면 엉뚱한 말이 된다.
    const result = extract(`${BUDGET_TAG}\n${BUDGET_TAG}`);

    expect(isAmoraFailedProposalNotice(result.cleanText)).toBe(false);
    expect(result.cleanText).not.toContain("먼저 바꾸고 싶은 것 한 가지만");
    // 2026-09-04: 그때도 카드는 나가야 한다. 예전에는 여기서 카드가 0개였다.
    expect(result.pendingAction?.tool).toBe("update_budget");
    expect(result.cleanText).not.toContain("나머지");
  });
});

describe("카드를 못 낸 턴은 프로바이더 이력에서 뺀다", () => {
  it("바뀐 여러 건 안내를 거른다", () => {
    // 통과한 표식이 하나도 없는 턴만 이 안내가 된다(2026-09-04 이후).
    const brokenBudget =
      '[pending_action]{"tool":"update_budget","input":{"budget_total":60000000}}'
      + "[/pending_action]";
    const notice = extract(`${brokenBudget}\n${SCHEDULE_TAG}`).cleanText;

    expect(isAmoraFailedProposalNotice(notice)).toBe(true);
  });

  it("문구를 바꾸기 전에 쌓인 옛 안내도 계속 거른다", () => {
    // DB 에 이미 저장된 지난 턴은 옛 문자열 그대로다. 상수만 바꾸면 그 턴이
    // 이력으로 되돌아와 모델이 다시 그 모양을 배운다.
    expect(isAmoraFailedProposalNotice(
      "한 번에 두 가지를 바꾸는 건 아직 어려워요. 하나씩 말씀해 주시면 바로 확인 카드로 만들어 드릴게요.",
    )).toBe(true);
  });

  it("평범한 아모라 턴은 거르지 않는다", () => {
    expect(isAmoraFailedProposalNotice(
      "예식장 후보 세 곳을 비교해 볼까요? 보증 인원부터 확인하면 좋아요.",
    )).toBe(false);
  });
});
