import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { getWeddingPlannerSystemPrompt } from "@/lib/ai/prompts";
import { executeTool } from "@/lib/ai/toolExecutor";
import type { ToolExecutionContext } from "@/lib/ai/tools/toolTypes";

/**
 * 아모라가 자기가 만든 예산 항목을 다음 턴에 모른다고 답했다.
 *
 *     사용자: 차량 이동 예산 50만원으로 잡아줘   → 카드 → 확인 → 저장됨
 *     사용자: 차량 이동 예산 얼마였지?
 *     아모라: 그 항목은 없는 것 같아요
 *
 * 그런데 **예산 화면에는 그 항목이 멀쩡히 보인다**(2026-08-24 감사).
 *
 * 원인은 읽는 쪽이었다. 프롬프트의 카테고리 현황도 `get_budget_summary` 도
 * 고정 20개(`CATEGORY_LABELS`)만 훑었다. 직접 추가한 항목은 `custom_...` 키에
 * 들어가는데 아무도 그 키를 보지 않았다.
 *
 * 키 형식이 둘이라는 점이 함정이다 — 아모라가 만들면 `custom_<md5 24자>`,
 * 예산 화면에서 만들면 `custom_<타임스탬프>`. 사용자에게는 똑같은 항목이므로
 * 둘 다 보여야 한다. 운영에 실제로 있는 1건이 후자 형식이다.
 */

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({ rpc: mocks.rpc, from: mocks.from })),
}));

const AMORA_MADE = "custom_0123456789abcdef01234567";
const SCREEN_MADE = "custom_1773727842937";

const PROGRESS: Record<string, unknown> = {
  venue: { category: "venue", status: "in_progress", budget: 20_000_000, spent: 5_000_000 },
  [AMORA_MADE]: { category: AMORA_MADE, label: "사진 촬영 공간", status: "in_progress", budget: 300_000 },
  [SCREEN_MADE]: { category: SCREEN_MADE, label: "차량 이동", status: "in_progress", budget: 500_000, spent: 200_000 },
};

function makeCtx(progress: Record<string, unknown>): ToolExecutionContext {
  return {
    coupleId: "00000000-0000-0000-0000-000000000000",
    requestKey: "chat:00000000-0000-4000-8000-000000000001:00000000-0000-4000-8000-000000000002",
    requestAttemptCount: 1,
    currentUserText: "",
    weddingContext: {
      weddingDate: null,
      budget: 50_000_000,
      venue: null,
      progress: progress as ToolExecutionContext["weddingContext"]["progress"],
    },
  };
}

function promptWith(progress: Record<string, unknown>): string {
  return getWeddingPlannerSystemPrompt({
    weddingDate: "2027-05-15",
    budget: 50_000_000,
    venue: null,
    progress,
    preparationStatus: null,
    brideName: "신부",
    groomName: "신랑",
    bookings: [],
    scheduleEvents: [],
    chatSummaries: [],
    pastConflicts: [],
    pastDecisions: [],
  } as never);
}

beforeEach(() => {
  mocks.rpc.mockReset();
  mocks.from.mockReset();
});

describe("직접 추가한 예산 항목을 아모라가 본다", () => {
  it("아모라가 만든 항목이 프롬프트에 실린다", () => {
    const prompt = promptWith(PROGRESS);
    expect(prompt).toContain("사진 촬영 공간");
    expect(prompt).toContain(AMORA_MADE);
  });

  it("예산 화면에서 만든 항목도 프롬프트에 실린다", () => {
    // 키 형식이 다르다는 이유로 빠지면 화면과 아모라가 다른 말을 한다.
    const prompt = promptWith(PROGRESS);
    expect(prompt).toContain("차량 이동");
    expect(prompt).toContain(SCREEN_MADE);
  });

  it("예산 화면에서 지운 항목은 실리지 않는다", () => {
    const shown = promptWith(PROGRESS);
    // 대조군: 지우지 않으면 실린다.
    expect(shown).toContain("차량 이동");
    const hidden = promptWith({ ...PROGRESS, __hidden: [SCREEN_MADE] });
    expect(hidden).not.toContain("차량 이동");
    // 다른 커스텀 항목은 그대로다.
    expect(hidden).toContain("사진 촬영 공간");
  });

  it("이름이 비어 있는 항목은 싣지 않는다", () => {
    const prompt = promptWith({
      ...PROGRESS,
      custom_9999999999999: { category: "custom_9999999999999", status: "in_progress" },
    });
    expect(prompt).not.toContain("custom_9999999999999");
  });
});

describe("예산 요약이 화면과 같은 숫자를 말한다", () => {
  it("직접 추가한 항목이 요약에 들어간다", async () => {
    const result = await executeTool("get_budget_summary", {}, makeCtx(PROGRESS));
    expect(result.success).toBe(true);
    const out = result.toolOutput as {
      total_spent: number;
      categories: Array<{ key: string; label: string; allocated: number | null; spent: number }>;
    };

    const car = out.categories.find((c) => c.key === SCREEN_MADE);
    expect(car?.label).toBe("차량 이동");
    expect(car?.allocated).toBe(500_000);

    const studio = out.categories.find((c) => c.key === AMORA_MADE);
    expect(studio?.label).toBe("사진 촬영 공간");
    expect(studio?.allocated).toBe(300_000);
  });

  it("합계에도 그 항목의 지출이 들어간다", async () => {
    const result = await executeTool("get_budget_summary", {}, makeCtx(PROGRESS));
    const out = result.toolOutput as { total_spent: number };
    // venue 500만 + 차량 이동 20만. 커스텀을 빼면 500만으로 나온다.
    expect(out.total_spent).toBe(5_200_000);
  });

  it("지운 항목은 요약에서도 빠진다", async () => {
    const result = await executeTool(
      "get_budget_summary",
      {},
      makeCtx({ ...PROGRESS, __hidden: [SCREEN_MADE] }),
    );
    const out = result.toolOutput as {
      total_spent: number;
      categories: Array<{ key: string }>;
    };
    expect(out.categories.some((c) => c.key === SCREEN_MADE)).toBe(false);
    expect(out.total_spent).toBe(5_000_000);
  });
});

describe("직접 추가한 항목을 고칠 수 있되 슬롯을 지어내지는 못한다", () => {
  // 커스텀 키는 두 형식으로 만들어지는데 DB 는 31자 해시만 받았다. 그래서
  // 예산 화면에서 만든 항목은 아모라가 손댈 수 없었다(운영 1건이 그 경우).
  //
  // 규칙을 넓히되 **새 슬롯을 임의 키로 만드는 길은 계속 막아야 한다.**
  // 그 경계가 사라지면 모델이 아무 키나 지목할 수 있게 된다.
  const sql = readFileSync(
    join(
      process.cwd(),
      "..",
      "..",
      "supabase",
      "migrations",
      "20260824140000_amora_can_change_custom_budget_categories.sql",
    ),
    "utf8",
  );

  it("새로 만들 때는 라벨에서 유도한 해시 키만 받는다", () => {
    expect(sql).toContain("char_length(v_key) = 31");
    expect(sql).toContain("v_key ~ '^custom_[0-9a-f]{24}$'");
  });

  it("기존 슬롯은 CAS 로 존재가 확인될 때만 연다", () => {
    expect(sql).toContain("v_expected_present");
  });

  it("저장된 이름이 그대로일 때만 연다 — 다른 항목 덮어쓰기 금지", () => {
    expect(sql).toContain("v_expected ->> 'label' = v_value ->> 'label'");
  });
});

describe("항목을 없애 달라는 말에 되는 척하지 않는다", () => {
  // 아모라에게는 예산 항목을 없애는 도구가 없다(delete_category 는 베타에서
  // 꺼져 있다). 그런데 그 사실을 어디에서도 알려주지 않아, 모델이 금액을 0원으로
  // 바꾸고 지웠다고 말할 여지가 있었다 — 화면에는 0원짜리 항목이 그대로 남는다.
  //
  // 지우는 길은 예산 화면에 실제로 있다(BudgetContent 의 __hidden).
  const prompt = promptWith(PROGRESS);

  it("없앨 수 없다는 사실이 프롬프트에 있다", () => {
    expect(prompt).toContain("없애 달라는 요청은 아모라가 못 합니다");
  });

  it("대신 갈 곳을 알려준다", () => {
    expect(prompt).toContain("예산 화면에서 지울 수 있다고 안내하세요");
  });

  it("0원으로 바꾸는 것이 삭제가 아니라고 못 박는다", () => {
    expect(prompt).toContain("0원으로 바꾸는 것은 항목을 없애는 것이 아닙니다");
  });

  it("직접 추가한 항목은 add_custom_category 로 고치라고 알려준다", () => {
    expect(prompt).toContain("add_custom_category");
    expect(prompt).toContain("update_category_budget으로 바꿀 수 없습니다");
  });
});
