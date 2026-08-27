import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CHECKLIST_MAP } from "@hanbang/shared/constants";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/navigation", () => ({
  usePathname: () => "/checklist",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/link", () => ({
  default: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));
vi.mock("@/components/app/schedule/CategoryChecklistModal", () => ({
  default: () => null,
}));

import ChecklistContent from "@/components/app/checklist/ChecklistContent";
import { useAuthStore } from "@/stores/authStore";

/**
 * 건너뛴 분야의 **카드**가 무엇을 보여주는가.
 *
 * 판정 함수만 검사하면 "판정은 맞는데 화면은 옛 모양"을 못 잡는다. 여기서 보는 것은
 * 두 가지다.
 *
 * 하나, 아무것도 저장하지 않은 커플에게 이 세 분야가 처음부터 "해당 없음"으로 보이는가.
 * 둘, 그 카드에서 예절 가이드 링크가 접히는가 — 진행률과 알림에서 뺐다면서 카드에는
 * 계속 읽을거리를 내밀면, 안 하기로 한 것이 화면에서는 안 없어진 것과 같다.
 */
describe("건너뛴 분야 카드", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    useAuthStore.setState({ journey: null } as never);
  });

  function drawWith(progress: Record<string, unknown>) {
    useAuthStore.setState({
      journey: {
        id: "j1",
        couple_id: "c1",
        wedding_date: null,
        total_budget: 0,
        venue: null,
        progress,
        created_at: "2026-08-01T00:00:00.000Z",
        updated_at: "2026-08-01T00:00:00.000Z",
      },
    } as never);
    act(() => { root.render(<ChecklistContent />); });
  }

  /** 그 분야 카드가 실제로 그린 글자. 다음 카드가 딸려 오지 않게 라벨 길이로 끊는다. */
  function cardText(label: string): string {
    const text = container.textContent ?? "";
    const at = text.indexOf(label);
    expect(at, `${label} 카드를 못 찾았다`).toBeGreaterThanOrEqual(0);
    return text.slice(at, at + label.length + 40);
  }

  const HOUSEWARMING = CHECKLIST_MAP.housewarming.label;

  it("화면이 실제로 그려진다", () => {
    // 아무것도 안 그려지면 아래 검사들이 빈 DOM 을 보며 늘 통과한다.
    drawWith({});
    expect(container.textContent).toContain(HOUSEWARMING);
  });

  it("아무것도 저장하지 않은 커플에게 처음부터 '해당 없음'이다", () => {
    drawWith({});
    expect(cardText(HOUSEWARMING)).toContain("진행률과 알림에서 제외됨");
  });

  it("건너뛴 카드에서는 예절 가이드 링크를 접는다", () => {
    drawWith({});
    expect(cardText(HOUSEWARMING)).not.toContain("관련 예절 가이드 보기");
    // 접는 것은 건너뛴 분야에서만이다. 진행 중인 분야에서 링크가 사라지면
    // 예절 편으로 가는 입구가 통째로 닫힌다.
    expect(cardText(CHECKLIST_MAP.venue.label)).toContain("관련 예절 가이드 보기");
  });

  it("되돌린 커플에게는 링크와 개수가 함께 돌아온다", () => {
    drawWith({
      housewarming: {
        status: "not_started",
        checklist: CHECKLIST_MAP.housewarming.items,
      },
    });
    const text = cardText(HOUSEWARMING);
    expect(text).toContain("0/1개 완료 · 시작 전");
    expect(text).toContain("관련 예절 가이드 보기");
  });
});
