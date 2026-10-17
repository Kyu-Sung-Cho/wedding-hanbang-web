// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CATEGORY_CHECKLISTS } from "@hanbang/shared/constants";
import BudgetContent from "@/components/app/budget/BudgetContent";
import { formatWeddingBudgetCeiling } from "@/lib/weddingBudget";
import { useAuthStore } from "@/stores/authStore";
import type { WeddingJourney } from "@/types/database.types";

/**
 * **누른 것이 사라지거나 두 번 들어가지 않는지** 본다.
 *
 * 감사에서 나온 같은 종류의 네 건이다. 셋은 화면이 조용한 것이고, 하나는 조용한 것보다
 * 나쁜 것 — 같은 하객이 두 줄로 남아 정산이 어긋난다.
 *
 * 문구가 아니라 배선을 본다. 문구만 보면 죽은 코드가 남아 있어도 통과한다.
 */

const web = (...parts: string[]) => resolve(process.cwd(), "src", ...parts);

/** 주석을 지우고 읽는다 — 설명문이 검사를 통과시키면 안 된다. */
function read(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
}

describe("총 예산 저장이 조용히 끝나지 않는다", () => {
  let container: HTMLDivElement;
  let root: Root;
  let original: ReturnType<typeof useAuthStore.getState>;
  const updateJourney = vi.fn<ReturnType<typeof useAuthStore.getState>["updateJourney"]>();
  const journey: WeddingJourney = {
    id: "synthetic-input-journey", couple_id: "synthetic-input-couple",
    wedding_date: null, venue: null, total_budget: 33_000_001, progress: {},
    state_revision: 1, created_at: "2026-10-17T00:00:00Z", updated_at: "2026-10-17T00:00:00Z",
  };

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    original = useAuthStore.getState();
    useAuthStore.setState({ journey, isDemo: true, updateJourney });
    updateJourney.mockResolvedValue({ status: "applied", journey });
    container = document.createElement("div"); document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    useAuthStore.setState(original); container.remove(); vi.clearAllMocks();
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: false });
  });

  async function submit(value: string) {
    await act(async () => root.render(createElement(BudgetContent)));
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="총 예산 수정"]')?.click());
    const input = container.querySelector<HTMLInputElement>('input[aria-label="총 예산 (만원)"]');
    expect(input, "총 예산 편집기가 열리지 않았다").not.toBeNull();
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => container.querySelector<HTMLButtonElement>('button[title="총 예산 저장"]')?.click());
    return input!;
  }

  it.each(["", "0", "-1", "100000.0001", "3300.12345"])("조건에 안 맞는 %s 입력은 이유를 보여주고 입력과 편집기를 유지한다", async (value) => {
    const input = await submit(value);
    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent?.trim().length, "거절 이유가 화면에 없다").toBeGreaterThan(10);
    expect(alert?.textContent).toContain(formatWeddingBudgetCeiling());
    expect(alert?.textContent).toContain("만원");
    expect(updateJourney, "잘못된 금액이 저장됐다").not.toHaveBeenCalled();
    expect(container.contains(input), "거절 뒤 편집기가 닫혔다").toBe(true);
    expect(input.value, "거절 뒤 입력을 잃었다").toBe(value);
  });

  it("정상 소수 입력은 원 단위로 정확히 저장한 뒤 편집기를 닫는다", async () => {
    const input = await submit("3300.1234");
    expect(updateJourney).toHaveBeenCalledExactlyOnceWith({ total_budget: 33_001_234 });
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.contains(input)).toBe(false);
    expect(container.querySelector('button[aria-label="총 예산 수정"]')).not.toBeNull();
  });
});

describe("축의금이 두 번 저장되지 않는다", () => {
  const money = read(web("app", "(app)", "money", "page.tsx"));

  it("저장 중이면 다시 받지 않는다", () => {
    // 예식장 로비처럼 회선이 느린 곳에서 실제로 두 번 눌린다. 같은 하객이 두 줄로
    // 남으면 정산이 어긋나고, 사용자는 그것을 나중에야 발견한다.
    const fn = money.slice(
      money.indexOf("const handleSubmit"),
      money.indexOf("const handleEdit"),
    );
    expect(fn.length, "제출 함수를 못 찾았다").toBeGreaterThan(200);
    const guardAt = fn.indexOf("if (saving) return;");
    const writeAt = Math.min(
      ...["addMoney(", "updateMoney("].map((s) => {
        const at = fn.indexOf(s);
        return at === -1 ? Number.MAX_SAFE_INTEGER : at;
      }),
    );
    expect(guardAt, "진행 중 가드가 없다").toBeGreaterThan(-1);
    expect(guardAt, "가드가 저장보다 뒤에 있다").toBeLessThan(writeAt);
    // 실패해도 풀려야 한다 — 안 그러면 한 번 실패한 뒤 영영 못 넣는다.
    expect(fn).toContain("setSaving(false)");
    expect(fn).toContain("} finally {");
  });

  it("저장 중인 것이 화면에 보인다", () => {
    expect(money).toContain("aria-busy={saving}");
    expect(money).toContain('saving ? "저장 중..."');
  });
});

describe("검색이 가이드 제목까지 본다", () => {
  const checklist = read(
    web("components", "app", "checklist", "ChecklistContent.tsx"),
  );

  it("가이드 제목이 검색 대상에 들어간다", () => {
    // 없을 때는 "이바지" 처럼 항목 라벨에 없는 말을 별칭에 억지로 박아야 했고,
    // 그러다 엉뚱한 분야로 보냈다 — 「이바지·답례품 예절」을 여는 것은 예단이
    // 아니라 선물 분야다.
    expect(checklist).toContain("${guide?.title ?? \"\"}");
  });

  it("억지 별칭을 지웠다", () => {
    // 순서가 중요하다. 가이드 제목을 넣기 전에 별칭을 빼면 검색이 0건이 된다.
    const aliases = checklist.slice(
      checklist.indexOf("CATEGORY_SEARCH_ALIASES"),
      checklist.indexOf("};", checklist.indexOf("CATEGORY_SEARCH_ALIASES")),
    );
    expect(aliases.length).toBeGreaterThan(50);
    expect(aliases, "예단 별칭에 이바지가 남아 있다").not.toContain("이바지");
  });
});

describe("확정일자 note 가 잔금과의 선후를 말한다", () => {
  it("남은 금액과 견주라고 말한다", () => {
    const registration = CATEGORY_CHECKLISTS.find((c) => c.key === "registration");
    const note = registration?.items.find((i) => i.label.includes("확정일자"))?.note;
    expect(note, "확정일자 항목을 못 찾았다").toBeTruthy();
    // 이 파일은 "잔금" 이 아니라 "남은 금액" 을 쓴다(일상어 규칙).
    expect(note).toContain("남은 금액");
    expect(note!.length, "note 상한 80자를 넘었다").toBeLessThanOrEqual(80);
  });
});
