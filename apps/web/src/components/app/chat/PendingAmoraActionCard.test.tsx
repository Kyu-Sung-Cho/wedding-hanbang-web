import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import PendingAmoraActionCard, {
  getPendingAmoraAction,
  getPendingAmoraBudgetImpactPreview,
  getPendingActionDisabledReason,
  isPendingAmoraActionExpired,
} from "./PendingAmoraActionCard";
import type { BudgetImpactPreview } from "@hanbang/shared";
import { getAmoraToolOperationIdentity } from "@/lib/ai/amoraToolIdentity";
import type { ChatMessage, PendingAmoraAction } from "@/types/database.types";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const budgetIdentity = getAmoraToolOperationIdentity(
  "update_budget",
  { totalBudget: 30_000_000 },
);
const action: PendingAmoraAction = {
  version: 2,
  actionId: "11111111-1111-4111-8111-111111111111",
  tool: "update_budget",
  input: { totalBudget: 30_000_000 },
  inputDigest: budgetIdentity.inputDigest,
  operationKey: budgetIdentity.operationKey,
  confirmation: "총예산을 3,000만 원으로 변경할까요?",
  issuedAt: Date.parse("2026-07-17T00:00:00.000Z"),
  expiresAt: Date.parse("2026-07-18T00:00:00.000Z"),
};

const budgetImpactPreview: BudgetImpactPreview = {
  version: 1,
  kind: "budget_change",
  tool: "update_budget",
  inputDigest: action.inputDigest,
  sourceRevision: 5,
  recordedSpendBasis: "explicit_spent_only",
  current: {
    totalBudget: 50_000_000,
    allocatedBudget: 20_000_000,
    recordedSpend: 5_000_000,
    unallocatedBudget: 30_000_000,
  },
  proposed: {
    totalBudget: 30_000_000,
    allocatedBudget: 20_000_000,
    recordedSpend: 5_000_000,
    unallocatedBudget: 10_000_000,
  },
  delta: {
    totalBudget: -20_000_000,
    allocatedBudget: 0,
    recordedSpend: 0,
    unallocatedBudget: -20_000_000,
  },
  categories: [],
  warnings: [],
};

const singleIdentity = getAmoraToolOperationIdentity(
  "add_schedule_event",
  {
    date: "2026-08-01",
    title: "드레스 피팅",
    schedule_scope: "confirmed_fact",
  },
);
const singleAction: PendingAmoraAction = {
  version: 2,
  actionId: "22222222-2222-4222-8222-222222222222",
  tool: "add_schedule_event",
  input: {
    date: "2026-08-01",
    title: "드레스 피팅",
    schedule_scope: "confirmed_fact",
  },
  inputDigest: singleIdentity.inputDigest,
  operationKey: singleIdentity.operationKey,
  confirmation: "드레스 피팅 일정을 추가할까요?",
  issuedAt: Date.parse("2026-07-17T00:00:00.000Z"),
  expiresAt: Date.parse("2026-07-17T00:10:00.000Z"),
};

function message(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "ai-message-1",
    couple_id: "couple-1",
    sender_id: null,
    sender_role: "ai",
    content: "원하시면 바로 반영할게요.",
    metadata: { pending_amora_action: action },
    visibility: "shared",
    created_at: "2026-07-17T00:00:01.000Z",
    ...overrides,
  };
}

describe("PendingAmoraActionCard", () => {
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

  it("shows the canonical server confirmation and requires the explicit apply button", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({
      applicationGranted: true,
      retryAfterMs: 0,
    }), { status: 200 }));
    const onApply = vi.fn();
    const onDismiss = vi.fn();
    await act(async () => {
      root.render(
        <PendingAmoraActionCard
          action={singleAction}
          messageId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
          disabledReason={null}
          isApplying={false}
          onApply={onApply}
          onDismiss={onDismiss}
        />,
      );
    });

    expect(container.textContent).toContain(singleAction.confirmation);
    expect(container.textContent).not.toContain("30000000");
    const buttons = container.querySelectorAll("button");
    expect(buttons).toHaveLength(2);
    expect(buttons[0]?.getAttribute("aria-label")).toBe("확인한 내용을 이대로 적용");
    // 문구는 모바일과 같게 맞췄다. **접근성 이름이 보이는 글자를 담아야 한다** —
    // 예전에는 보이는 글자가 "이번 화면에서 숨기기" 인데 이름은 "…에서만 숨기기" 라
    // 음성으로 보이는 대로 불러도 그 버튼이 안 잡혔다(WCAG 2.5.3 Label in Name).
    const dismissText = buttons[1]?.textContent?.trim() ?? "";
    const dismissLabel = buttons[1]?.getAttribute("aria-label") ?? "";
    expect(dismissText).toContain("지금은 적용하지 않기");
    expect(dismissLabel).toBe("지금은 적용하지 않기");
    expect(dismissLabel, "접근성 이름이 보이는 글자를 담지 않는다").toContain(dismissText);

    await act(async () => buttons[0]?.click());
    await act(async () => Promise.resolve());
    expect(onApply).toHaveBeenCalledWith(singleAction.actionId);
    expect(fetch).toHaveBeenCalledWith(
      `/api/amora/shared-actions/${singleAction.actionId}`,
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({
          messageId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        }),
      }),
    );

    await act(async () => buttons[1]?.click());
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("keeps expired or superseded actions visible but disables mutation", async () => {
    const onApply = vi.fn();
    await act(async () => {
      root.render(
        <PendingAmoraActionCard
          action={action}
          messageId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
          disabledReason="not_latest"
          isApplying={false}
          onApply={onApply}
          onDismiss={vi.fn()}
        />,
      );
    });

    const apply = container.querySelector("button");
    expect(apply?.disabled).toBe(true);
    expect(container.textContent).toContain("새 대화가 이어져");
    await act(async () => apply?.click());
    expect(onApply).not.toHaveBeenCalled();
  });

  it("shows truthful before/after budget impact without calling recorded spend a payment", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({
      approvalMode: "couple",
      accepted: false,
      acceptedCount: 0,
      requiredCount: 2,
      partnerLinked: true,
      ready: false,
    }), { status: 200 }));

    await act(async () => {
      root.render(
        <PendingAmoraActionCard
          action={action}
          impactPreview={budgetImpactPreview}
          messageId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
          disabledReason={null}
          isApplying={false}
          onApply={vi.fn()}
          onDismiss={vi.fn()}
        />,
      );
    });
    await act(async () => Promise.resolve());

    expect(container.textContent).toContain("변경 영향");
    expect(container.textContent).toContain("총예산");
    expect(container.textContent).toContain("5,000만원 → 3,000만원");
    expect(container.textContent).toContain("기록 지출");
    expect(container.textContent).toContain("결제 완료를 뜻하지 않아요");
    expect(container.textContent).not.toContain("결제액");
  });

  // 2026-08-23 파운더 결정으로 두 사람 승인이 없어졌다. 여기 있던 여섯 개는
  // 1/2 표 세기·철회·만장일치 같은 정족수 기계장치였고, 그 화면 자체가 없어졌다.
  //
  // 그대로 남는 것 둘만 옮겨 적는다.
  //   1. 확인이 곧 반영이 아니라 **적용 리스를 먼저 잡는다** — 두 화면이 같은
  //      변경을 두 번 반영하지 못하게 하는 장치다. 승인과 무관하게 살아 있다.
  //   2. 승인 RPC(POST)를 **부르지 않는다** — 이제 DB가 single 정책에 대해
  //      `AMORA_SHARED_ACTION_COUPLE_APPROVAL_NOT_REQUIRED` 예외를 던지므로,
  //      실수로 부르면 확인 버튼이 통째로 죽는다.
  it("한 사람이 확인하면 승인 단계 없이 바로 적용으로 넘어간다", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      applicationGranted: true,
      retryAfterMs: 0,
    }), { status: 200 }));
    const onApply = vi.fn();

    await act(async () => {
      root.render(
        <PendingAmoraActionCard
          action={action}
          messageId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
          disabledReason={null}
          isApplying={false}
          onApply={onApply}
          onDismiss={vi.fn()}
        />,
      );
    });
    await act(async () => Promise.resolve());

    const confirm = container.querySelector<HTMLButtonElement>(
      'button[aria-label="확인한 내용을 이대로 적용"]',
    );
    expect(confirm).not.toBeNull();
    await act(async () => confirm?.click());
    await act(async () => Promise.resolve());

    expect(onApply).toHaveBeenCalledTimes(1);
    // 부른 요청은 적용 리스(PUT) 하나뿐이어야 한다. POST가 섞이면 DB가 거부한다.
    const methods = fetchMock.mock.calls.map(
      (call) => (call[1] as RequestInit | undefined)?.method,
    );
    expect(methods).toEqual(["PUT"]);
  });

  it("다른 화면이 이미 반영을 시작했으면 두 번 반영하지 않는다", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      applicationGranted: false,
      retryAfterMs: 30_000,
    }), { status: 200 }));
    const onApply = vi.fn();

    await act(async () => {
      root.render(
        <PendingAmoraActionCard
          action={action}
          messageId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
          disabledReason={null}
          isApplying={false}
          onApply={onApply}
          onDismiss={vi.fn()}
        />,
      );
    });
    await act(async () => Promise.resolve());

    const confirm = container.querySelector<HTMLButtonElement>(
      'button[aria-label="확인한 내용을 이대로 적용"]',
    );
    await act(async () => confirm?.click());
    await act(async () => Promise.resolve());

    expect(onApply).not.toHaveBeenCalled();
    expect(container.textContent).toContain("다른 화면에서 반영을 시작했어요");
    expect(container.textContent).toContain("30초 뒤");
  });
});

describe("pending action message boundary", () => {
  it("accepts only a structurally valid action on a shared AI message", () => {
    expect(getPendingAmoraAction(message())).toEqual(action);
    expect(getPendingAmoraAction(message({ visibility: "bride_private" }))).toBeNull();
    expect(getPendingAmoraAction(message({ sender_role: "bride" }))).toBeNull();
    expect(getPendingAmoraAction(message({
      metadata: { pending_amora_action: { ...action, actionId: "not-a-uuid" } },
    }))).toBeNull();
    expect(getPendingAmoraAction(message({
      metadata: { pending_amora_action: { ...action, confirmation: "" } },
    }))).toBeNull();
    expect(getPendingAmoraAction(message({
      metadata: { pending_amora_action: { ...action, input: [] as unknown as Record<string, unknown> } },
    }))).toBeNull();
    expect(getPendingAmoraAction(message({
      metadata: { pending_amora_action: { ...action, issuedAt: "2026-07-17T00:00:00.000Z" as unknown as number } },
    }))).toBeNull();
    expect(getPendingAmoraAction(message({
      metadata: { pending_amora_action: { ...action, expiresAt: action.expiresAt + 1 } },
    }))).toBeNull();
    expect(getPendingAmoraAction(message({
      metadata: { pending_amora_action: { ...action, inputDigest: "wrong" } },
    }))).toBeNull();
    expect(getPendingAmoraAction(message({
      metadata: { pending_amora_action: { ...action, operationKey: "wrong" } },
    }))).toBeNull();
  });

  it("accepts an impact preview only when action digest and journey revision match", () => {
    const validMessage = message({
      metadata: {
        pending_amora_action: action,
        pending_amora_action_journey_revision: 5,
        pending_amora_action_impact_preview: budgetImpactPreview,
      },
    });
    expect(getPendingAmoraBudgetImpactPreview(validMessage, action)).toEqual(
      budgetImpactPreview,
    );
    expect(getPendingAmoraBudgetImpactPreview(message({
      metadata: {
        ...validMessage.metadata,
        pending_amora_action_journey_revision: 6,
      },
    }), action)).toBeNull();
    expect(getPendingAmoraBudgetImpactPreview(message({
      metadata: {
        ...validMessage.metadata,
        pending_amora_action_impact_preview: {
          ...budgetImpactPreview,
          inputDigest: "b".repeat(64),
        },
      },
    }), action)).toBeNull();
  });

  it("uses the server expiry instant without a locale conversion", () => {
    expect(isPendingAmoraActionExpired(action, action.expiresAt - 1)).toBe(false);
    expect(isPendingAmoraActionExpired(action, action.expiresAt)).toBe(true);
  });

  it("disables an expired, superseded, or in-flight action", () => {
    const now = action.expiresAt - 1;
    expect(getPendingActionDisabledReason(action, now, true, false)).toBeNull();
    expect(getPendingActionDisabledReason(action, action.expiresAt, true, false)).toBe("expired");
    expect(getPendingActionDisabledReason(action, now, false, false)).toBe("not_latest");
    expect(getPendingActionDisabledReason(action, now, true, true)).toBe("busy");
  });

  /**
   * 방금 성공시킨 카드에 "적용할 수 없어요" 가 붙던 것.
   *
   * 카드를 누르면 새 메시지가 생기고, 그 순간 이 카드는 최신이 아니게 되어
   * `not_latest` 로 잠긴다. 2026-08-31 운영에서 재현했다 — 아모라가 "일정을
   * 추가했어요" 라고 말한 **바로 옆에** "새 대화가 이어져 이 제안은 적용할 수
   * 없어요" 가 함께 떠 있었다. 사용자는 성공과 실패를 나란히 보고 실패로 읽는다.
   *
   * 적용됨은 만료·최신여부보다 **먼저** 판정해야 한다. 시간이 지나도 이미 적용된
   * 것은 만료될 것이 없다.
   */
  it("이미 적용된 카드는 실패가 아니라 적용됨으로 말한다", () => {
    const now = action.expiresAt - 1;
    // 누른 직후: 최신이 아니게 됐지만 실패가 아니다.
    expect(getPendingActionDisabledReason(action, now, false, false, true)).toBe("applied");
    // 시간이 지나도 마찬가지다.
    expect(getPendingActionDisabledReason(action, action.expiresAt, false, false, true))
      .toBe("applied");
    // 답변이 흐르는 중이어도 마찬가지다.
    expect(getPendingActionDisabledReason(action, now, true, true, true)).toBe("applied");
  });

  it("적용되지 않았으면 예전 판정 그대로다", () => {
    // 새 갈래가 기존 동작을 덮어쓰지 않는지 본다.
    const now = action.expiresAt - 1;
    expect(getPendingActionDisabledReason(action, now, true, false, false)).toBeNull();
    expect(getPendingActionDisabledReason(action, now, false, false, false)).toBe("not_latest");
    expect(getPendingActionDisabledReason(action, action.expiresAt, true, false, false))
      .toBe("expired");
    expect(getPendingActionDisabledReason(action, now, true, true, false)).toBe("busy");
  });

  // 2026-08-22 운영 실측: 브라우저 시계가 서버보다 1.5초 느렸고, 그동안 갓 나온 카드가
  // "확인 시간이 지났어요"를 띄웠다. 시계가 크게 어긋난 기기라면 그 상태가 풀리지 않아
  // 사용자는 아모라가 제안한 어떤 변경도 확인할 수 없다.
  it("does not call a fresh proposal expired when this device's clock lags the server", () => {
    // 서버가 찍은 발급 시각이 이 기기의 '지금'보다 뒤에 있다 = 시계가 느리다.
    const laggingClock = action.issuedAt - 1_500;
    expect(laggingClock).toBeLessThan(action.expiresAt);

    expect(isPendingAmoraActionExpired(action, laggingClock)).toBe(false);
    // 버튼이 살아 있어야 한다. 정말 만료됐다면 서버가 거절한다.
    expect(getPendingActionDisabledReason(action, laggingClock, true, false)).toBeNull();
  });

  it("does not call a proposal expired before the clock has been read", () => {
    // ChatContent 는 nowMs 를 0 으로 시작하고 마운트 뒤 효과에서 처음 채운다.
    // 그 사이 모든 카드가 만료로 보이면 안 된다.
    expect(isPendingAmoraActionExpired(action, 0)).toBe(false);
    expect(isPendingAmoraActionExpired(action, Number.NaN)).toBe(false);
    expect(getPendingActionDisabledReason(action, 0, true, false)).toBeNull();
  });

  it("still expires once the clock is usable and the server instant has passed", () => {
    // 위 두 완화가 진짜 만료까지 열어버리면 안 된다.
    expect(isPendingAmoraActionExpired(action, action.expiresAt)).toBe(true);
    expect(isPendingAmoraActionExpired(action, action.expiresAt + 60_000)).toBe(true);
    expect(getPendingActionDisabledReason(action, action.expiresAt, true, false)).toBe("expired");
  });
});

/**
 * 이 카드는 공유 계획을 바꿀 때 "상대에게 바뀐 내용이 알림으로 가요" 라고 적는다.
 * 배우자가 아직 합류하지 않았으면 **없는 사람에 대한 약속**이다 — 베타에서 처음
 * 써 보는 사람은 대개 아직 혼자다(2026-08-25 적대적 검토).
 */
describe("배우자 합류 여부에 따른 알림 문구", () => {
  const NOTICE = "상대에게 바뀐 내용이 알림으로 가요";
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  async function renderWith(partnerLinked: boolean) {
    await act(async () => {
      root.render(
        <PendingAmoraActionCard
          action={action}
          messageId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
          disabledReason={null}
          isApplying={false}
          partnerLinked={partnerLinked}
          onApply={() => {}}
          onDismiss={() => {}}
        />,
      );
    });
  }

  it("합류했으면 알림이 간다고 알려준다", async () => {
    await renderWith(true);
    expect(container.textContent).toContain(NOTICE);
  });

  it("아직 혼자면 그 약속을 하지 않는다", async () => {
    await renderWith(false);
    expect(container.textContent).not.toContain(NOTICE);
  });

  it("빠뜨리면 약속하지 않는 쪽으로 틀린다", async () => {
    // 기본값이 false 인 이유. 없는 사람에게 알림이 간다고 말하는 것보다
    // 알려야 할 사람에게 안 알리는 편이 낫다.
    await act(async () => {
      root.render(
        <PendingAmoraActionCard
          action={action}
          messageId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
          disabledReason={null}
          isApplying={false}
          onApply={() => {}}
          onDismiss={() => {}}
        />,
      );
    });
    expect(container.textContent).not.toContain(NOTICE);
  });
});
