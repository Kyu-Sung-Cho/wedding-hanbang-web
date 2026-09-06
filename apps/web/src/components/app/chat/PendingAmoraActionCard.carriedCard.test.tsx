import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import PendingAmoraActionCard, {
  CARRIED_PENDING_ACTION_LABEL,
  getPendingAmoraActionCarryCount,
} from "./PendingAmoraActionCard";
import {
  CARRIED_PENDING_ACTION_LABEL as MOBILE_CARRIED_PENDING_ACTION_LABEL,
  getPendingAmoraActionCarryCount as getCarryCountOnMobile,
} from "../../../../../mobile/src/lib/pendingAmoraAction";
import { getAmoraToolOperationIdentity } from "@/lib/ai/amoraToolIdentity";
import type { ChatMessage, PendingAmoraAction } from "@/types/database.types";

/**
 * 이월된 카드는 이월됐다고 말한다 (2026-09-04).
 *
 * 확인하지 않은 카드는 다음 답변으로 따라간다(`route.ts` 의 캐리포워드, 파운더가
 * 유지하기로 한 동작). 그래서 "9월 10일 일정을 등록할까요?" 라는 **새 문장 아래에
 * 직전 턴의 다른 카드**가 붙는 일이 생긴다 — 사용자는 방금 읽은 문장이 곧 이
 * 버튼이라고 읽고 누르며, 그러면 문장과 다른 것이 저장된다.
 *
 * 여기서 고정하는 것은 두 가지다.
 *   1. 이월이면 라벨과 모양이 다르다.
 *   2. 판정은 **서버 metadata 값**으로만 한다 — 화면이 직전 행을 뒤져 추측하지 않는다.
 */

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const identity = getAmoraToolOperationIdentity("update_budget", { totalBudget: 30_000_000 });
const action: PendingAmoraAction = {
  version: 2,
  actionId: "44444444-4444-4444-8444-444444444444",
  tool: "update_budget",
  input: { totalBudget: 30_000_000 },
  inputDigest: identity.inputDigest,
  operationKey: identity.operationKey,
  confirmation: "총예산을 3,000만 원으로 변경할까요?",
  issuedAt: Date.parse("2026-09-04T00:00:00.000Z"),
  expiresAt: Date.parse("2026-09-05T00:00:00.000Z"),
};

function aiMessage(metadata: Record<string, unknown>): ChatMessage {
  return {
    id: "ai-1",
    couple_id: "couple-1",
    sender_id: null,
    sender_role: "ai",
    content: "원하시면 바로 반영할게요.",
    metadata: metadata as ChatMessage["metadata"],
    visibility: "shared",
    created_at: "2026-09-04T00:00:01.000Z",
  };
}

describe("이월된 카드의 머리 라벨", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  async function renderCard(carryCount: number) {
    await act(async () => {
      root.render(
        <PendingAmoraActionCard
          action={action}
          messageId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
          disabledReason={null}
          isApplying={false}
          carryCount={carryCount}
          onApply={vi.fn()}
          onDismiss={vi.fn()}
        />,
      );
    });
    const section = container.querySelector<HTMLElement>(
      "section[data-pending-action-carried]",
    );
    expect(section).not.toBeNull();
    return section!;
  }

  it("원본 턴 카드(0)에는 라벨이 붙지 않는다", async () => {
    const section = await renderCard(0);
    expect(section.dataset.pendingActionCarried).toBe("false");
    expect(section.textContent).not.toContain(CARRIED_PENDING_ACTION_LABEL);
    // 원본 턴에서는 제목이 일반 문장이고 확인문이 그 아래에 온다.
    expect(section.querySelector("h3")?.textContent).toBe("적용하기 전에 확인해 주세요");
    expect(section.className).toContain("border-[var(--amora-line)]");
    expect(section.className).not.toContain("border-dashed");
  });

  for (const carryCount of [1, 2]) {
    it(`이월 ${carryCount}회 카드는 라벨과 다른 테두리를 갖는다`, async () => {
      const section = await renderCard(carryCount);
      expect(section.dataset.pendingActionCarried).toBe("true");
      expect(section.textContent).toContain(CARRIED_PENDING_ACTION_LABEL);
      // 무엇을 바꾸는지가 먼저다 — 서버가 발급한 확인문이 제목 자리에 그대로 온다.
      expect(section.querySelector("h3")?.textContent).toBe(action.confirmation);
      expect(section.textContent).toContain("적용하기 전에 확인해 주세요");
      expect(section.className).toContain("border-dashed");

      // 라벨이 접근성 이름의 **앞**에 온다. 화면을 못 보는 사용자가 버튼보다 먼저 듣는다.
      const labelledBy = section.getAttribute("aria-labelledby")?.split(" ") ?? [];
      expect(labelledBy).toHaveLength(2);
      expect(document.getElementById(labelledBy[0]!)?.textContent)
        .toContain(CARRIED_PENDING_ACTION_LABEL);
      expect(document.getElementById(labelledBy[1]!)?.textContent)
        .toBe(action.confirmation);

      // 확인 버튼 문구는 이월이라고 달라지지 않는다 — 누르는 일이 같기 때문이다.
      const buttons = section.querySelectorAll("button");
      expect(buttons[0]?.textContent).toContain("내용 확인하기");
      expect(buttons[0]?.getAttribute("aria-label")).toBe("변경 내용 확인하기");
      expect(buttons[0]?.disabled).toBe(false);
      await act(async () => buttons[0]?.click());
      const dialog = document.querySelector('[role="dialog"]');
      expect(dialog?.textContent).toContain(CARRIED_PENDING_ACTION_LABEL);
      expect(dialog?.textContent).toContain(action.confirmation);
    });
  }

  it("이월 라벨이 없어도 카드는 계속 뜬다 — 라벨은 막는 장치가 아니다", async () => {
    const section = await renderCard(0);
    expect(section.querySelectorAll("button")).toHaveLength(2);
  });
});

describe("이월 판정은 서버 값으로만 한다", () => {
  const cases: Array<{ name: string; message: ChatMessage; expected: number }> = [
    {
      name: "값이 없으면 0",
      message: aiMessage({ pending_amora_action: action }),
      expected: 0,
    },
    {
      name: "1이면 1",
      message: aiMessage({ pending_amora_action: action, pending_amora_action_carry_count: 1 }),
      expected: 1,
    },
    {
      name: "2면 2",
      message: aiMessage({ pending_amora_action: action, pending_amora_action_carry_count: 2 }),
      expected: 2,
    },
    {
      name: "0은 원본 턴이다",
      message: aiMessage({ pending_amora_action: action, pending_amora_action_carry_count: 0 }),
      expected: 0,
    },
    {
      name: "문자열은 믿지 않는다",
      message: aiMessage({ pending_amora_action: action, pending_amora_action_carry_count: "2" }),
      expected: 0,
    },
    {
      name: "소수는 믿지 않는다",
      message: aiMessage({ pending_amora_action: action, pending_amora_action_carry_count: 1.5 }),
      expected: 0,
    },
    {
      name: "음수는 믿지 않는다",
      message: aiMessage({ pending_amora_action: action, pending_amora_action_carry_count: -1 }),
      expected: 0,
    },
    {
      name: "사람이 쓴 행에서는 읽지 않는다",
      message: {
        ...aiMessage({ pending_amora_action_carry_count: 2 }),
        sender_role: "bride",
        sender_id: "user-1",
      },
      expected: 0,
    },
    {
      name: "비공개 행에서는 읽지 않는다",
      message: {
        ...aiMessage({ pending_amora_action_carry_count: 2 }),
        visibility: "bride_private",
      },
      expected: 0,
    },
    {
      name: "metadata 가 없으면 0",
      message: { ...aiMessage({}), metadata: null },
      expected: 0,
    },
  ];

  for (const { name, message, expected } of cases) {
    it(name, () => {
      expect(getPendingAmoraActionCarryCount(message)).toBe(expected);
    });
  }

  it("앱과 웹이 같은 입력에 같은 값을 낸다", () => {
    // 문자열 비교가 아니라 **같은 입력에 같은 결과**로 대조한다. 한쪽만 고치면
    // 두 화면이 같은 카드에 다른 말을 한다.
    for (const { name, message, expected } of cases) {
      expect(
        getCarryCountOnMobile({
          sender_type: message.sender_role === "ai" ? "ai" : "bride",
          visibility: message.visibility,
          metadata: message.metadata,
        }),
        name,
      ).toBe(expected);
    }
  });

  it("라벨 문구가 두 화면에서 같다", () => {
    expect(MOBILE_CARRIED_PENDING_ACTION_LABEL).toBe(CARRIED_PENDING_ACTION_LABEL);
  });
});
