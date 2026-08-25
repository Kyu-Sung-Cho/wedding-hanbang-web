import { describe, expect, it } from "vitest";

import {
  describeUnconfirmedAmoraPendingAction,
  extractAmoraPendingAction,
} from "@/lib/ai/amoraPendingAction";
import { buildAmoraSystemPrompt } from "@/lib/ai/amoraPromptComposer";
import { BETA_SAFE_TOOLS } from "@/lib/ai/tools";
import { isMutatingTool } from "@/lib/ai/mutationTools";

/**
 * 카드가 떴는데 사용자가 버튼 대신 말로 승인하면 아모라가 카드를 몰랐다.
 *
 * 2026-08-25 운영 실측 — 네 가지 표현 전부 실패:
 *
 *   "응"              → "네, 편하게 말씀해 주세요. …무엇인가요?"
 *   "네 적용해줘"      → "어떤 내용을 적용할지 이 대화에서 확인되지 않아요."
 *   "그렇게 해줘"      → "좋아요. …원하시는 내용을 한 가지만 말씀해 주세요."
 *   "좋아 그걸로 하자"  → "좋아요. 그 선택으로 진행할게요."
 *
 * 마지막이 가장 나쁘다. 진행하겠다고 말했지만 아무것도 반영되지 않았다
 * (DB 확인 — 그 카테고리는 키조차 없었다).
 *
 * 클라이언트는 **버튼 클릭에서만** `confirmedActionId` 를 보낸다
 * (`ChatContent.applyPendingAmoraAction`). 말로 한 승인은 평범한 대화 턴이라
 * 서버가 실행하지 않는다 — 그건 맞다. 문제는 아모라가 그 사실을 모른 채
 * 엉뚱하게 답하는 것이다.
 */

const PENDING_ACTION_TOOLS = BETA_SAFE_TOOLS.filter((t) => isMutatingTool(t.name));
const READ_ONLY_BETA_TOOLS = BETA_SAFE_TOOLS
  .map((t) => t.name)
  .filter((name) => !isMutatingTool(name));

/**
 * 카드를 손으로 짓지 않고 **운영이 실제로 만드는 경로**로 만든다.
 * 손으로 지으면 서명·만료·자릿수가 운영과 달라져 통과해도 뜻이 없다.
 */
function issueRealCard(now: number) {
  const extracted = extractAmoraPendingAction({
    text: '신혼여행 예산을 잡을게요.[pending_action]{"tool":"update_category_budget","input":{"category":"honeymoon","budget":7000000}}[/pending_action]',
    allowedTools: PENDING_ACTION_TOOLS,
    now,
    createActionId: () => "11111111-2222-4333-8444-555555555555",
  });
  if (!extracted.pendingAction) throw new Error("운영 경로로 카드를 못 만들었다");
  return extracted.pendingAction;
}

const baseContext = {
  weddingDate: "2027-05-15", budget: 62_000_000, venue: null, progress: {},
  preparationStatus: null, brideName: "신부", groomName: "신랑",
  bookings: [], scheduleEvents: [], chatSummaries: [],
  pastConflicts: [], pastDecisions: [],
} as never;

function promptWith(confirmation?: string): string {
  return buildAmoraSystemPrompt(baseContext, {
    requestKind: "chat",
    persistenceMode: "durable",
    enabledToolNames: READ_ONLY_BETA_TOOLS,
    ...(confirmation === undefined ? {} : { awaitingCardConfirmation: confirmation }),
  });
}

describe("말로 한 승인", () => {
  const now = 1_787_600_000_000;

  it("적용되지 않은 카드를 읽기 신호로 알아본다", () => {
    const card = issueRealCard(now);
    const seen = describeUnconfirmedAmoraPendingAction({
      value: card, allowedTools: PENDING_ACTION_TOOLS, now: now + 60_000,
    });
    expect(seen?.tool).toBe("update_category_budget");
    expect(seen?.confirmation).toContain("신혼여행");
  });

  it("만료된 카드는 알아보지 않는다", () => {
    const card = issueRealCard(now);
    expect(describeUnconfirmedAmoraPendingAction({
      value: card, allowedTools: PENDING_ACTION_TOOLS, now: card.expiresAt + 1,
    })).toBeNull();
  });

  it("입력이 조작된 카드는 알아보지 않는다", () => {
    const card = issueRealCard(now);
    const tampered = { ...card, input: { ...card.input, budget: 99_000_000 } };
    expect(describeUnconfirmedAmoraPendingAction({
      value: tampered, allowedTools: PENDING_ACTION_TOOLS, now: now + 60_000,
    })).toBeNull();
  });

  it("카드가 있으면 버튼을 눌러야 반영된다고 알려준다", () => {
    const card = issueRealCard(now);
    const prompt = promptWith(card.confirmation);
    expect(prompt).toContain("[화면에 대기 중인 변경 카드]");
    // 화면이 실제로 쓰는 버튼 문구여야 한다. 지어낸 문구면 사용자가 못 찾는다.
    expect(prompt).toContain("이대로 적용");
    expect(prompt).toContain("그 말만으로는 반영되지 않습니다");
  });

  it("진행하겠다고 말하는 것과 모르겠다고 하는 것 둘 다 막는다", () => {
    const prompt = promptWith(issueRealCard(now).confirmation);
    expect(prompt).toContain("반영했다고, 진행하겠다고 말하지 마세요");
    expect(prompt).toContain("무엇을 말하는지 모르겠다고도 하지 마세요");
  });

  it("카드에 적힌 값이 모델에게 전달된다", () => {
    // "무엇을 기다리는지" 를 모델이 알아야 엉뚱한 되묻기를 안 한다.
    const prompt = promptWith(issueRealCard(now).confirmation);
    expect(prompt).toContain("신혼여행");
    expect(prompt).toContain("700만 원");
  });

  it("카드가 없으면 이 계약문이 아예 없다", () => {
    expect(promptWith()).not.toContain("[화면에 대기 중인 변경 카드]");
  });

  it("계약문은 절단되지 않는 자리에 있다", () => {
    // 프롬프트가 상한에 걸려 잘려도 이 규칙은 남아야 한다.
    const card = issueRealCard(now);
    const trimmed = buildAmoraSystemPrompt(baseContext, {
      requestKind: "chat",
      persistenceMode: "durable",
      enabledToolNames: READ_ONLY_BETA_TOOLS,
      awaitingCardConfirmation: card.confirmation,
      maxChars: 20_000,
    });
    expect(trimmed.length).toBeLessThanOrEqual(20_000);
    // 실제로 잘린 프롬프트여야 검사에 뜻이 있다.
    expect(trimmed.length).toBeGreaterThan(15_000);
    expect(trimmed).toContain("[화면에 대기 중인 변경 카드]");
    expect(trimmed).toContain("이대로 적용");
  });
});
