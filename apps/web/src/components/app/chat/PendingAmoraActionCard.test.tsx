import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import PendingAmoraActionCard, {
  CONTINUED_PENDING_ACTION_COPY,
  PENDING_ACTION_HIDE_LABEL,
  QUEUED_CARD_SKIP_HINT,
  QUEUED_CARD_SKIP_LABEL,
  getPendingAmoraAction,
  getQueuedRemainingCopy,
  getPendingAmoraBudgetImpactPreview,
  getPendingActionDisabledReason,
  getQueuedRemainingCount,
  isPendingAmoraActionContinuedInMessage,
  isPendingAmoraActionExpired,
} from "./PendingAmoraActionCard";
import type { BudgetImpactPreview } from "@hanbang/shared";
import { CATEGORY_CHECKLISTS } from "@/constants/checklists";
import { PLANNING_CATEGORY_LABELS } from "@/constants/planningCategories";
import { SCREEN_CATEGORY_LABELS } from "@/lib/ai/tools/planningConstants";
import { BUDGET_CATEGORY_KEYS, WEDDING_TOOLS } from "@/lib/ai/tools";
import { extractAmoraPendingAction } from "@/lib/ai/amoraPendingAction";
import { buildAmoraBudgetImpactPreview } from "@/lib/ai/amoraBudgetImpactPreview";
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
    expect(buttons[0]?.getAttribute("aria-label")).toBe("변경 내용 확인하기");
    // 문구는 모바일과 같게 맞췄다. **접근성 이름이 보이는 글자를 담아야 한다** —
    // 예전에는 보이는 글자가 "이번 화면에서 숨기기" 인데 이름은 "…에서만 숨기기" 라
    // 음성으로 보이는 대로 불러도 그 버튼이 안 잡혔다(WCAG 2.5.3 Label in Name).
    const dismissText = buttons[1]?.textContent?.trim() ?? "";
    const dismissLabel = buttons[1]?.getAttribute("aria-label") ?? "";
    expect(dismissText).toContain("지금은 적용하지 않기");
    expect(dismissLabel).toBe("지금은 적용하지 않기");
    expect(dismissLabel, "접근성 이름이 보이는 글자를 담지 않는다").toContain(dismissText);

    await act(async () => buttons[0]?.click());
    expect(fetch).not.toHaveBeenCalled();
    expect(onApply).not.toHaveBeenCalled();
    const sheetConfirm = document.querySelector<HTMLButtonElement>('[role="dialog"] button[data-amora-confirm]');
    expect(sheetConfirm?.getAttribute("aria-label")).toBe("확인한 내용을 이대로 적용");
    await act(async () => sheetConfirm?.click());
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

  it("keeps an applied card visible without offering a later rejection", async () => {
    const onApply = vi.fn();
    const onDismiss = vi.fn();
    await act(async () => {
      root.render(
        <PendingAmoraActionCard
          action={action}
          messageId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
          disabledReason="applied"
          isApplying={false}
          onApply={onApply}
          onDismiss={onDismiss}
        />,
      );
    });

    expect(container.textContent).toContain("이 제안은 적용됐어요.");
    const review = container.querySelector<HTMLButtonElement>('button[aria-label="변경 내용 확인하기"]');
    const defer = container.querySelector<HTMLButtonElement>('button[aria-label="지금은 적용하지 않기"]');
    expect(review?.disabled).toBe(true);
    expect(defer?.disabled).toBe(true);
    await act(async () => {
      review?.click();
      defer?.click();
    });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(onApply).not.toHaveBeenCalled();
    expect(onDismiss).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("closes an open review when the same action is reported as applied", async () => {
    const onApply = vi.fn();
    const onDismiss = vi.fn();
    const renderCard = (applied: boolean) => (
      <PendingAmoraActionCard
        action={action}
        messageId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
        disabledReason={applied ? "applied" : null}
        isApplying={false}
        onApply={onApply}
        onDismiss={onDismiss}
      />
    );
    await act(async () => root.render(renderCard(false)));
    const review = container.querySelector<HTMLButtonElement>('button[aria-label="변경 내용 확인하기"]');
    await act(async () => review?.click());
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();

    await act(async () => root.render(renderCard(true)));

    expect(container.textContent).toContain("이 제안은 적용됐어요.");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(container.querySelector<HTMLButtonElement>('button[aria-label="지금은 적용하지 않기"]')?.disabled).toBe(true);
    expect(onApply).not.toHaveBeenCalled();
    expect(onDismiss).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["expired", "not_latest"] as const)("keeps an unapplied %s card dismissible without a server mutation", async (reason) => {
    const onApply = vi.fn();
    const onDismiss = vi.fn();
    await act(async () => {
      root.render(
        <PendingAmoraActionCard
          action={action}
          messageId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
          disabledReason={reason}
          isApplying={false}
          onApply={onApply}
          onDismiss={onDismiss}
        />,
      );
    });

    const apply = container.querySelector("button");
    expect(apply?.disabled).toBe(true);
    await act(async () => apply?.click());
    expect(onApply).not.toHaveBeenCalled();
    const defer = container.querySelector<HTMLButtonElement>('button[aria-label="지금은 적용하지 않기"]');
    expect(defer?.disabled).toBe(false);
    await act(async () => defer?.click());
    expect(onDismiss).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled();
  });

  /**
   * 2026-09-15: "응 적용해줘" 라고 치면 같은 카드가 최신 답변으로 옮겨지는데, 원래 자리의
   * 카드는 "새 대화가 이어져 이 제안은 적용할 수 없어요" 라고 했다. 아모라는 아래 카드를
   * 누르라고 하고, 위 카드는 안 된다고 했다.
   */
  it("points a card that moved to the newest reply at that card and offers no buttons of its own", async () => {
    const onApply = vi.fn();
    const onDismiss = vi.fn();
    await act(async () => {
      root.render(
        <PendingAmoraActionCard
          action={action}
          messageId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
          disabledReason="not_latest"
          isApplying={false}
          continuesInLatestReply
          onApply={onApply}
          onDismiss={onDismiss}
        />,
      );
    });

    const section = container.querySelector<HTMLElement>("section")!;
    expect(section.dataset.pendingActionContinued).toBe("true");
    expect(section.textContent).toContain(CONTINUED_PENDING_ACTION_COPY);
    expect(section.textContent).toContain(action.confirmation);
    expect(section.textContent).not.toContain("적용할 수 없어요");
    expect(container.querySelectorAll("button")).toHaveLength(0);
    // 상태 문장이 접근성 설명에도 이어져 있다.
    const status = section.querySelector('[role="status"]')!;
    expect(section.getAttribute("aria-describedby")).toContain(status.id);
    expect(onApply).not.toHaveBeenCalled();
    expect(onDismiss).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ["applied", "이 제안은 적용됐어요."],
    ["expired", "안전을 위해 확인 시간이 지났어요."],
  ] as const)("keeps the %s copy even when the same action also sits on the newest reply", async (reason, copy) => {
    await act(async () => {
      root.render(
        <PendingAmoraActionCard
          action={action}
          messageId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
          disabledReason={reason}
          isApplying={false}
          continuesInLatestReply
          onApply={vi.fn()}
          onDismiss={vi.fn()}
        />,
      );
    });
    const section = container.querySelector<HTMLElement>("section")!;
    expect(section.dataset.pendingActionContinued).toBeUndefined();
    expect(section.textContent).toContain(copy);
    expect(section.textContent).not.toContain(CONTINUED_PENDING_ACTION_COPY);
    expect(container.querySelector('button[aria-label="지금은 적용하지 않기"]')).not.toBeNull();
  });

  it("does not claim the card moved when the newest reply carries nothing", async () => {
    await act(async () => {
      root.render(
        <PendingAmoraActionCard
          action={action}
          messageId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
          disabledReason="not_latest"
          isApplying={false}
          onApply={vi.fn()}
          onDismiss={vi.fn()}
        />,
      );
    });
    const section = container.querySelector<HTMLElement>("section")!;
    expect(section.dataset.pendingActionContinued).toBeUndefined();
    expect(section.textContent).toContain("새 대화가 이어져 이 제안은 적용할 수 없어요.");
    expect(section.textContent).not.toContain(CONTINUED_PENDING_ACTION_COPY);
  });

  /**
   * 2026-09-18: 여러 변경 중 한 카드를 원치 않으면 적용하는 것 말고는 다음으로 갈 길이 없었다.
   * 대기열 카드에는 "이 항목 건너뛰기" 가 따로 나온다. "지금은 적용하지 않기" 는 그대로다.
   */
  const skipButton = () => [...container.querySelectorAll<HTMLButtonElement>("button")]
    .find(button => button.textContent?.trim() === QUEUED_CARD_SKIP_LABEL);
  const hideButton = () => [...container.querySelectorAll<HTMLButtonElement>("button")]
    .find(button => button.textContent?.trim() === PENDING_ACTION_HIDE_LABEL);
  const queuedLine = () => container.querySelector<HTMLElement>(
    `#pending-amora-action-${singleAction.actionId}-queued`,
  );

  it("offers a separate skip control on the latest queued card and sends nothing from the hide control", async () => {
    const onApply = vi.fn();
    const onDismiss = vi.fn();
    const onSkip = vi.fn();
    await act(async () => {
      root.render(
        <PendingAmoraActionCard
          action={singleAction}
          messageId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
          disabledReason={null}
          isApplying={false}
          queuedRemainingCount={1}
          onApply={onApply}
          onDismiss={onDismiss}
          onSkip={onSkip}
        />,
      );
    });

    const buttons = [...container.querySelectorAll<HTMLButtonElement>("button")];
    expect(buttons.map(button => button.getAttribute("aria-label"))).toEqual([
      "변경 내용 확인하기", "지금은 적용하지 않기", "이 항목 건너뛰기",
    ]);
    const skip = skipButton()!;
    // 보이는 글자와 접근성 이름이 같다(WCAG 2.5.3).
    expect(skip.getAttribute("aria-label")).toBe(skip.textContent?.trim());
    expect(skip.disabled).toBe(false);

    await act(async () => skip.click());
    expect(onSkip).toHaveBeenCalledOnce();
    expect(onSkip).toHaveBeenCalledWith(singleAction.actionId);
    expect(onDismiss).not.toHaveBeenCalled();
    expect(onApply).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();

    // 숨기기는 여전히 화면에서만 치운다.
    await act(async () => buttons[1]?.click());
    expect(onDismiss).toHaveBeenCalledOnce();
    expect(onSkip).toHaveBeenCalledOnce();
  });

  /**
   * 2026-09-18 재검사: 이 카드는 **몇 건을 걸고 있는지 한 번도 말하지 않았고**, 돌이킬 수 있는
   * 숨기기와 대기열을 앞으로 보내는 건너뛰기가 회색 테두리·흰 바탕·같은 굵기로 똑같이 생겼다.
   * 건수를 적고, 되돌릴 수 없는 쪽만 로즈로 무게를 올린다(DESIGN.md: 테두리 rose[600],
   * 글자 rose[700]). 색을 못 보는 사용자를 위해 차이를 글자로도 적는다.
   */
  it("says how many requests are at stake and does not dress the skip control like the hide control", async () => {
    await act(async () => {
      root.render(
        <PendingAmoraActionCard
          action={singleAction}
          messageId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
          disabledReason={null}
          isApplying={false}
          queuedRemainingCount={2}
          onApply={vi.fn()}
          onDismiss={vi.fn()}
          onSkip={vi.fn()}
        />,
      );
    });

    const queued = queuedLine()!;
    expect(queued.textContent).toContain(getQueuedRemainingCopy(2));
    expect(queued.textContent).toContain("2건");
    expect(queued.textContent).toContain(QUEUED_CARD_SKIP_HINT);
    // 두 버튼 이름이 모두 문장에 있어야 어느 쪽이 무엇인지 읽을 수 있다.
    expect(queued.textContent).toContain(QUEUED_CARD_SKIP_LABEL);
    expect(queued.textContent).toContain(PENDING_ACTION_HIDE_LABEL);
    // 남은 요청의 내용은 화면에 쓰지 않는다 — 건수만 센다.
    const section = container.querySelector<HTMLElement>("section")!;
    expect(section.getAttribute("aria-describedby")?.split(" ")).toContain(queued.id);

    const skip = skipButton()!;
    const hide = hideButton()!;
    expect(skip.className).not.toBe(hide.className);
    // 되돌릴 수 없는 쪽: rose[600] 테두리 · rose[700] 글자 · 연한 로즈 hover · 굵은 글자.
    expect(skip.className).toContain("border-[var(--amora-action)]");
    expect(skip.className).toContain("text-[var(--amora-rose-deep)]");
    expect(skip.className).toContain("hover:bg-[var(--amora-rose-pale)]");
    expect(skip.className).toContain("font-semibold");
    // rose[600] 은 채움·테두리 색이고 글자 색이 아니다(DESIGN.md 2026-09-16).
    expect(skip.className).not.toContain("text-[var(--amora-action)]");
    // 되돌릴 수 있는 쪽은 조용한 회색 선으로 남는다.
    expect(hide.className).toContain("border-[#D8C7BB]");
    expect(hide.className).toContain("font-medium");
    expect(hide.className).not.toContain("--amora-rose-deep");
  });

  it.each([
    ["a single card", { queuedRemainingCount: 0, disabledReason: null }],
    ["a card without a skip handler", { queuedRemainingCount: 1, disabledReason: null, withoutHandler: true }],
    ["an applied card", { queuedRemainingCount: 1, disabledReason: "applied" }],
    ["an older card", { queuedRemainingCount: 1, disabledReason: "not_latest" }],
    ["an expired card", { queuedRemainingCount: 1, disabledReason: "expired" }],
  ] as const)("does not offer skipping on %s", async (_name, options) => {
    const onSkip = vi.fn();
    await act(async () => {
      root.render(
        <PendingAmoraActionCard
          action={singleAction}
          messageId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
          disabledReason={options.disabledReason}
          isApplying={false}
          queuedRemainingCount={options.queuedRemainingCount}
          onApply={vi.fn()}
          onDismiss={vi.fn()}
          onSkip={"withoutHandler" in options ? undefined : onSkip}
        />,
      );
    });
    expect(skipButton()).toBeUndefined();
    expect(container.textContent).not.toContain(QUEUED_CARD_SKIP_LABEL);
    // 건너뛸 수 없는 카드에서는 건수 줄도 말하지 않는다 — 가리킬 버튼이 없다.
    expect(queuedLine()).toBeNull();
    expect(container.textContent).not.toContain("남은 요청이");
    expect(container.querySelector("section")!.getAttribute("aria-describedby"))
      .not.toContain("-queued");
  });

  it.each([
    ["while an answer is streaming", { disabledReason: "busy", isApplying: false }],
    ["while this card is being applied", { disabledReason: null, isApplying: true }],
  ] as const)("keeps the skip control visible but unusable %s", async (_name, options) => {
    const onSkip = vi.fn();
    await act(async () => {
      root.render(
        <PendingAmoraActionCard
          action={singleAction}
          messageId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
          disabledReason={options.disabledReason}
          isApplying={options.isApplying}
          queuedRemainingCount={2}
          onApply={vi.fn()}
          onDismiss={vi.fn()}
          onSkip={onSkip}
        />,
      );
    });
    const skip = skipButton()!;
    expect(skip.disabled).toBe(true);
    await act(async () => skip.click());
    expect(onSkip).not.toHaveBeenCalled();
    // 누를 수 없는 동안에도 몇 건이 걸려 있는지는 그대로 말한다.
    expect(queuedLine()?.textContent).toContain(getQueuedRemainingCopy(2));
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

  it.each(["canonical server proposal", "22-row layout stress"])("shows every allocation in the card and approval sheet: %s", async (scenario) => {
    const categories = scenario === "canonical server proposal"
      // 카드·확인 창·변경 영향은 예산 화면과 같은 이름을 쓴다(2026-09-15). AI 문맥 전용
      // 원명칭(예단·폐백)이 카드에 찍히면 예산 화면의 어느 줄인지 알 수 없다.
      ? BUDGET_CATEGORY_KEYS.map((key) => ({ key, label: SCREEN_CATEGORY_LABELS[key] }))
      : [...CATEGORY_CHECKLISTS, { key: "reserve", label: PLANNING_CATEGORY_LABELS.reserve }];
    const input = { total_budget: categories.length * 1_000_000, allocations: categories.map(({ key }) => ({ category: key, budget: 1_000_000 })), intake_summary: "사용자가 확인한 합성 배분안" };
    let plan: PendingAmoraAction = {
      ...action,
      tool: "apply_budget_plan",
      input,
      ...getAmoraToolOperationIdentity("apply_budget_plan", input),
      confirmation: "각 분야에 100만원씩 배정할까요?",
      issuedAt: Date.now(),
      expiresAt: Date.now() + 60_000,
    };
    let preview: BudgetImpactPreview = {
      ...budgetImpactPreview,
      tool: "apply_budget_plan",
      inputDigest: plan.inputDigest,
      categories: categories.map(({ key, label }) => ({
        key, label, currentBudget: 0, proposedBudget: 1_000_000,
        currentRecordedSpend: 0, proposedRecordedSpend: 0,
      })),
    };
    if (scenario === "canonical server proposal") {
      const parsed = extractAmoraPendingAction({
        text: `[pending_action]${JSON.stringify({ tool: "apply_budget_plan", input })}[/pending_action]`,
        allowedTools: WEDDING_TOOLS,
        now: Date.now(),
        createActionId: () => action.actionId,
      });
      expect(parsed.pendingAction).not.toBeNull();
      plan = parsed.pendingAction!;
      const generatedPreview = buildAmoraBudgetImpactPreview({
        action: plan,
        sourceRevision: 5,
        context: {
          coupleId: "10000000-0000-4000-8000-000000000001",
          requestKey: "chat:20000000-0000-4000-8000-000000000001:30000000-0000-4000-8000-000000000001",
          weddingContext: { weddingDate: null, budget: 0, venue: null, progress: {} },
        },
      });
      expect(generatedPreview).not.toBeNull();
      preview = generatedPreview!;
      expect(preview.categories).toHaveLength(BUDGET_CATEGORY_KEYS.length);
      expect(categories.find(({ key }) => key === "yedan")?.label).toBe("두 가족에게 드릴 선물");
      expect(categories.find(({ key }) => key === "pyebaek")?.label).toBe("결혼식 뒤 전통 인사");
      expect(plan.confirmation).not.toMatch(/예단|폐백/);
      for (const { label } of categories) expect(plan.confirmation).toContain(label);
    }
    const onApply = vi.fn();
    await act(async () => root.render(
      <PendingAmoraActionCard action={plan} impactPreview={preview}
        messageId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" disabledReason={null}
        isApplying={false} onApply={onApply} onDismiss={vi.fn()} />,
    ));
    const details = container.querySelector("details")!;
    await act(async () => details.querySelector("summary")!.click());
    expect(details.open).toBe(true);
    expect(details.querySelectorAll("li")).toHaveLength(categories.length);
    for (const { label } of categories) expect(details.textContent).toContain(label);
    expect(details.textContent).toContain(PLANNING_CATEGORY_LABELS.reserve);
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="변경 내용 확인하기"]')!.click());
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain(plan.confirmation);
    const sheetDetails = dialog.querySelector("details")!;
    await act(async () => sheetDetails.querySelector("summary")!.click());
    expect(sheetDetails.open).toBe(true);
    expect(sheetDetails.querySelectorAll("li")).toHaveLength(categories.length);
    for (const { label } of categories) expect(sheetDetails.textContent).toContain(label);
    expect([...sheetDetails.querySelectorAll("li")].map((row) => row.textContent))
      .toEqual([...details.querySelectorAll("li")].map((row) => row.textContent));
    expect(sheetDetails.textContent?.match(/배정 예산 0원 → 100만원/g)).toHaveLength(categories.length);
    expect(dialog.textContent).toContain("결제 완료를 뜻하지 않아요");
    expect(fetch).not.toHaveBeenCalled();
    expect(onApply).not.toHaveBeenCalled();
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ applicationGranted: true, retryAfterMs: 0 }), { status: 200 }));
    await act(async () => dialog.querySelector<HTMLButtonElement>("button[data-amora-confirm]")!.click());
    expect(fetch).toHaveBeenCalledExactlyOnceWith(`/api/amora/shared-actions/${plan.actionId}`,
      expect.objectContaining({ method: "PUT", body: JSON.stringify({ messageId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }) }));
    expect(onApply).toHaveBeenCalledExactlyOnceWith(plan.actionId);
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
      'button[aria-label="변경 내용 확인하기"]',
    );
    expect(confirm).not.toBeNull();
    await act(async () => confirm?.click());
    expect(fetchMock).not.toHaveBeenCalled();
    await act(async () => document.querySelector<HTMLButtonElement>('[role="dialog"] button[data-amora-confirm]')?.click());
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
      'button[aria-label="변경 내용 확인하기"]',
    );
    await act(async () => confirm?.click());
    await act(async () => document.querySelector<HTMLButtonElement>('[role="dialog"] button[data-amora-confirm]')?.click());
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

  it("counts a card as moved only when the newest shared reply carries the same action", () => {
    const carried = message({
      id: "ai-message-2",
      metadata: { pending_amora_action: action },
    });
    expect(isPendingAmoraActionContinuedInMessage(carried, action)).toBe(true);
    expect(isPendingAmoraActionContinuedInMessage(null, action)).toBe(false);
    expect(isPendingAmoraActionContinuedInMessage(undefined, action)).toBe(false);
    // 새 답변에 카드가 없다.
    expect(isPendingAmoraActionContinuedInMessage(message({ metadata: {} }), action)).toBe(false);
    // 다른 제안이다.
    expect(isPendingAmoraActionContinuedInMessage(message({
      metadata: { pending_amora_action: singleAction },
    }), action)).toBe(false);
    // 같은 id 인데 입력이 다르면 옮겨진 것이 아니다(서버는 입력을 바꿔 옮기지 않는다).
    const otherIdentity = getAmoraToolOperationIdentity("update_budget", { totalBudget: 40_000_000 });
    expect(isPendingAmoraActionContinuedInMessage(message({
      metadata: { pending_amora_action: {
        ...action,
        input: { totalBudget: 40_000_000 },
        inputDigest: otherIdentity.inputDigest,
        operationKey: otherIdentity.operationKey,
      } },
    }), action)).toBe(false);
    // 사용자 메시지·개인 레인 메시지는 카드를 들 수 없다.
    expect(isPendingAmoraActionContinuedInMessage(message({ sender_role: "bride" }), action)).toBe(false);
    expect(isPendingAmoraActionContinuedInMessage(message({ visibility: "bride_private" }), action)).toBe(false);
  });

  it("counts queued requests only for the queue that points at this card", () => {
    const queued = (remainingActions: unknown, currentActionId: unknown = action.actionId) => message({
      metadata: {
        pending_amora_action: action,
        pending_amora_action_queue: { version: 1, queueId: action.actionId, currentActionId, totalCount: 3, completedCount: 1, remainingActions },
      },
    });
    const item = { tool: "update_budget", input: { total_budget: 31_000_000 } };
    expect(getQueuedRemainingCount(queued([item]), action.actionId)).toBe(1);
    expect(getQueuedRemainingCount(queued([item, item]), action.actionId)).toBe(2);
    expect(getQueuedRemainingCount(queued([]), action.actionId)).toBe(0);
    // 다른 카드의 대기열·모양이 다른 값·대기열 없는 카드는 0 이다.
    expect(getQueuedRemainingCount(queued([item], singleAction.actionId), action.actionId)).toBe(0);
    expect(getQueuedRemainingCount(queued("1"), action.actionId)).toBe(0);
    expect(getQueuedRemainingCount(message(), action.actionId)).toBe(0);
    expect(getQueuedRemainingCount(message({ metadata: { pending_amora_action_queue: [item] } }), action.actionId)).toBe(0);
    // 사용자 메시지·개인 레인 메시지는 대기열을 들 수 없다.
    expect(getQueuedRemainingCount({ ...queued([item]), sender_role: "bride" }, action.actionId)).toBe(0);
    expect(getQueuedRemainingCount({ ...queued([item]), visibility: "bride_private" }, action.actionId)).toBe(0);
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
