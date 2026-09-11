import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CATEGORY_CHECKLISTS } from "@hanbang/shared/constants";

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
 * 분야 한 줄이 **상황마다 맞는 말을 하는지**를 화면에서 본다.
 *
 * 판정 함수만 검사하면 "판정은 맞는데 화면은 옛 문구"를 못 잡는다. 실제로 그런 일이
 * 있었다 — `resolvePlanningChecklistStatus` 는 옳게 답하는데 화면이 개수와 상태를
 * 나란히 써서 **`0/9개 완료 · 완료`** 가 됐고, 파운더가 "체크를 다 안 했는데 완료라고
 * 뜬다"고 제보했다(2026-08-22).
 *
 * 그래서 여기서는 문자열이 아니라 **그려진 DOM 의 글자**를 본다.
 */
describe("분야 한 줄이 상황마다 하는 말", () => {
  const category = CATEGORY_CHECKLISTS.find((c) => c.items.length >= 3)!;
  const total = category.items.length;

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

  /** 그 분야 카드가 실제로 그린 한 줄. */
  function lineForCategory(): string {
    const card = container.querySelector(`button[aria-label="${category.label} 체크리스트 열기"]`);
    expect(card, `${category.label} 카드를 못 찾았다`).not.toBeNull();
    const statusLineId = card?.getAttribute("aria-describedby");
    const statusLine = statusLineId ? document.getElementById(statusLineId) : null;
    expect(statusLine, "카드의 상태 설명이 연결되어 있어야 한다").not.toBeNull();
    // 시안에서 개수와 상태가 좌우 열로 나뉘어도, 그 카드의 문구만 판정한다.
    return Array.from(statusLine?.children ?? []).map((child) => child.textContent).join(" · ");
  }

  const items = (doneCount: number) =>
    category.items.map((item, index) => ({
      id: item.id,
      label: item.label,
      done: index < doneCount,
    }));

  it("화면이 실제로 그려진다", () => {
    // 아무것도 안 그려지면 아래 검사들이 빈 DOM 을 보며 늘 통과한다.
    drawWith({});
    expect(container.textContent).toContain(category.label);
  });

  it("아무것도 안 한 분야 — 개수와 상태를 함께 쓴다", () => {
    drawWith({});
    expect(lineForCategory()).toContain(`0/${total}개 완료 · 시작 전`);
  });

  it("항목을 일부 체크 — 개수가 실제와 같다", () => {
    drawWith({ [category.key]: { status: "in_progress", checklist: items(2) } });
    expect(lineForCategory()).toContain(`2/${total}개 완료 · 준비 중`);
  });

  it("항목을 다 체크 — 완료라고 말해도 개수가 뒷받침한다", () => {
    drawWith({ [category.key]: { status: "completed", checklist: items(total) } });
    expect(lineForCategory()).toContain(`${total}/${total}개 완료 · 완료`);
  });

  it("온보딩이 분야만 완료로 표시 — 개수를 쓰지 않고 이유를 말한다", () => {
    // **파운더가 제보한 그 상황이다.** 항목 기록이 없으므로 개수는 0인데, 예전에는
    // `0/N개 완료 · 완료` 라고 써서 고장난 것처럼 읽혔다.
    drawWith({ [category.key]: { status: "completed" } });
    const line = lineForCategory();
    expect(line).toContain("완료로 표시함 · 항목은 확인 전");
    expect(line, "개수를 함께 쓰면 다시 모순으로 읽힌다").not.toContain(`0/${total}개 완료`);
  });

  it("온보딩이 분야만 준비 중으로 표시 — 같은 방식으로 말한다", () => {
    drawWith({ [category.key]: { status: "in_progress" } });
    expect(lineForCategory()).toContain("준비 중으로 표시함 · 항목은 확인 전");
  });

  it("\"안 해요\"로 끈 분야 — 표시함이 아니라 제외됨이라고 말한다", () => {
    drawWith({ [category.key]: { status: "not_applicable" } });
    const line = lineForCategory();
    expect(line).toContain("진행률과 알림에서 제외됨");
    expect(line).not.toContain("표시함");
  });

  it("다 체크한 뒤 항목이 늘어난 분야 — 완료라고 말하지 않는다", () => {
    // 옛 항목만 저장된 상태를 흉내 낸다. 상태는 completed 로 남아 있지만 병합하면
    // 새 항목이 미완이다. 여기서 "완료" 라고 말하면 그 항목이 영영 숨는다.
    const saved = category.items.slice(0, -1).map((item) => ({
      id: item.id,
      label: item.label,
      done: true,
    }));
    drawWith({ [category.key]: { status: "completed", checklist: saved } });
    const line = lineForCategory();
    expect(line).toContain(`${total - 1}/${total}개 완료 · 준비 중`);
    expect(line).not.toContain("· 완료");
  });
});
