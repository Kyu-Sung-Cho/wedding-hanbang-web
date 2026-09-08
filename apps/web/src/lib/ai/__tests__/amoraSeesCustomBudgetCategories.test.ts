import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  AMORA_MAX_TOOL_CALLS_PER_TURN,
  AMORA_MAX_TOOL_FEEDBACK_CHARS_PER_TURN,
} from "@/lib/ai/amoraRequestPolicy";
import {
  AMORA_SYSTEM_PROMPT_MAX_CHARS,
  buildAmoraSystemPrompt,
} from "@/lib/ai/amoraPromptComposer";
import { isMutatingTool } from "@/lib/ai/mutationTools";
import { BETA_SAFE_TOOLS } from "@/lib/ai/tools";
import { CATEGORY_LABELS } from "@/lib/ai/tools/planningConstants";
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

const PRODUCTION_ENABLED_TOOL_NAMES = BETA_SAFE_TOOLS
  .filter((tool) => !isMutatingTool(tool.name))
  .map((tool) => tool.name);

function promptContext(progress: Record<string, unknown>) {
  return {
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
  } as never;
}

function promptWith(progress: Record<string, unknown>): string {
  return getWeddingPlannerSystemPrompt(promptContext(progress));
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

  it("사용자 항목은 고정 분야용 숨김 표시가 남아 있어도 프롬프트에 실린다", () => {
    const shown = promptWith(PROGRESS);
    // 대조군: 지우지 않으면 실린다.
    expect(shown).toContain("차량 이동");
    const hidden = promptWith({ ...PROGRESS, __hidden: [SCREEN_MADE] });
    expect(hidden).toContain("차량 이동");
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

  it("사용자 항목은 고정 분야용 숨김 표시가 남아 있어도 요약에 들어간다", async () => {
    const result = await executeTool(
      "get_budget_summary",
      {},
      makeCtx({ ...PROGRESS, __hidden: [SCREEN_MADE] }),
    );
    const out = result.toolOutput as {
      total_spent: number;
      categories: Array<{ key: string }>;
    };
    expect(out.categories.some((c) => c.key === SCREEN_MADE)).toBe(true);
    expect(out.total_spent).toBe(5_200_000);
  });
});

describe("직접 추가한 항목을 고칠 수 있되 슬롯을 지어내지는 못한다", () => {
  // 커스텀 키는 두 형식으로 만들어지는데 DB 는 31자 해시만 받았다. 그래서
  // 예산 화면에서 만든 항목은 아모라가 손댈 수 없었다(운영 1건이 그 경우).
  //
  // 규칙을 넓히되 **새 슬롯을 임의 키로 만드는 길은 계속 막아야 한다.**
  // 그 경계가 사라지면 모델이 아무 키나 지목할 수 있게 된다.
  //
  // 이 검사는 SQL 을 실행하지 않는다 — 조건이 파일에 남아 있는지만 본다.
  // 그래서 **주석은 먼저 걷어낸다.** 걷어내지 않으면 분기를 통째로 주석 처리해도
  // 통과한다(2026-08-24 적대적 검토에서 지적됨). 실제 동작은 스테이징·운영에서
  // 경우별로 실측했고 그 표는 마이그레이션 머리말에 있다.
  const MIGRATIONS_DIR = join(process.cwd(), "..", "..", "supabase", "migrations");

  function latestMigrationDefining(signature: string): string {
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((name) => name.endsWith(".sql"))
      .filter((name) => readFileSync(join(MIGRATIONS_DIR, name), "utf8").includes(signature))
      .sort();
    if (files.length === 0) throw new Error(`정의를 찾지 못했다: ${signature}`);
    return files[files.length - 1];
  }

  function activeSql(file: string): string {
    return readFileSync(join(MIGRATIONS_DIR, file), "utf8")
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");
  }

  // **마지막으로 재정의한 파일**을 디렉토리에서 계산해 고른다.
  //
  // 처음에는 20260824140000 을 손으로 박았는데, 20260824150000 이 같은 함수를
  // 다시 정의하면서 그 파일이 죽은 정의가 됐다. 그래서 살아 있는 정의에서 키
  // 규칙을 통째로 지워도 가드가 초록이었다(2026-08-24 적대적 검토가 재현).
  // 다음번 재정의에도 가드가 따라가게 계산해서 고른다.
  const keyRuleSql = activeSql(latestMigrationDefining(
    "CREATE OR REPLACE FUNCTION public.apply_amora_atomic_tool_execution_pre_shared_revision",
  ));
  const labelRuleSql = activeSql(
    "20260824150000_amora_custom_category_label_match.sql",
  );

  it("새로 만들 때는 라벨에서 유도한 해시 키만 받는다", () => {
    expect(keyRuleSql).toContain(
      "(char_length(v_key) = 31 AND v_key ~ '^custom_[0-9a-f]{24}$')",
    );
  });

  it("기존 슬롯은 CAS 로 존재가 확인될 때만 연다", () => {
    expect(keyRuleSql).toContain("v_expected_present");
    expect(keyRuleSql).toContain("v_key ~ '^custom_[0-9A-Za-z_-]{1,48}$'");
  });

  it("최신 판은 이름을 TS 와 같은 규칙으로 대조한다", () => {
    // 정확 일치로 되돌리면 화면에서 만든 "차량  이동"(공백 두 칸)을 고칠 수 없다.
    expect(labelRuleSql).toContain("lower(regexp_replace(");
    expect(labelRuleSql).toContain("btrim(v_expected ->> 'label')");
    expect(labelRuleSql).toContain("btrim(v_value ->> 'label')");
    expect(labelRuleSql).not.toContain("v_expected ->> 'label' = v_value ->> 'label'");
  });

  it("두 마이그레이션 모두 원장에 등록돼 있다", () => {
    const manifest = JSON.parse(
      readFileSync(
        join(
          process.cwd(), "..", "..", "supabase", "release-manifests",
          "vendor-disclosure-v2-20260718.json",
        ),
        "utf8",
      ),
    ) as { expandMigrations: { file: string }[] };
    const files = new Set(manifest.expandMigrations.map((entry) => entry.file));
    expect(files.has("20260824140000_amora_can_change_custom_budget_categories.sql")).toBe(true);
    expect(files.has("20260824150000_amora_custom_category_label_match.sql")).toBe(true);
  });
});

describe("안내가 모델이 실제로 받는 프롬프트에 있다", () => {
  // 원본 프롬프트를 보면 안 된다. `removeLegacyOperationalInstructions` 가
  // `## 도구 사용 핵심 규칙` 을 통째로 지우기 때문에, 거기 쓴 안내는 원본에는
  // 있고 **모델이 받는 것에는 없다**. 실제로 그 자리에 썼다가 운영에서
  // 아모라가 삭제를 거절하면서도 어디서 지우는지 말하지 않았다(2026-08-24).
  const delivered = buildAmoraSystemPrompt(promptContext(PROGRESS), {
    // **운영이 실제로 넘기는 집합을 쓴다.**
    // 쓰기 도구는 `availableTools = runnableTools.filter((t) => !isMutatingTool(t.name))`
    // 에서 걸러져 enabledToolNames 에 오지 않는다. 예전에는 여기에 손으로
    // `add_custom_category` 를 넣어서, 그 이름으로 건 안내가 운영에서 한 번도
    // 나가지 않는데도 테스트는 초록이었다(2026-08-24 적대적 검토가 잡음).
    enabledToolNames: PRODUCTION_ENABLED_TOOL_NAMES,
    requestKind: "chat",
    persistenceMode: "durable",
  });

  it("커스텀 항목은 add_custom_category 로 고치라고 알려준다", () => {
    expect(delivered).toContain("`update_category_budget`으로 바꿀 수 없습니다");
    expect(delivered).toContain("`add_custom_category`를 호출하세요");
  });

  it("없앨 수 없다는 사실과 갈 곳을 같이 알려준다", () => {
    expect(delivered).toContain("없애 달라는 요청은 지금 도구로 할 수 없습니다");
    expect(delivered).toContain("어디서 할 수 있는지 같은 답에서 알려주세요");
    expect(delivered).toContain("예산 화면에서 그 항목의 삭제 버튼으로 직접 지울 수 있습니다");
  });

  it("0원으로 바꾸는 것이 삭제가 아니라고 못 박는다", () => {
    expect(delivered).toContain("0원으로 바꾸는 것은 항목을 없애는 것이 아닙니다");
  });

  it("커스텀 항목 목록도 전달본에 살아 있다", () => {
    // 목록은 `## 커플 상황` 이라 살아남는다 — 대조군이다.
    expect(delivered).toContain("차량 이동");
  });

  it("없애는 도구가 켜지면 그 안내는 저절로 빠진다", () => {
    const withDelete = buildAmoraSystemPrompt(promptContext(PROGRESS), {
      enabledToolNames: ["get_budget_summary", "add_custom_category", "delete_category"],
      requestKind: "chat",
      persistenceMode: "durable",
    });
    expect(withDelete).not.toContain("없애 달라는 요청은 지금 도구로 할 수 없습니다");
  });
});

describe("예산 요약이 모델 상한 안에 들어간다", () => {
  // 도구 결과는 턴당 4,000자에서 잘린다. 넘으면 배열이 통째로 버려지고 앞뒤
  // 조각만 남아 고정 카테고리가 모델 시야에서 사라진다. 고정 22개만으로 이미
  // 3,576자라, 커스텀을 그냥 이어 붙이면 3개에서 넘는다(2026-08-24 실측).
  const CAP = Math.floor(
    AMORA_MAX_TOOL_FEEDBACK_CHARS_PER_TURN / AMORA_MAX_TOOL_CALLS_PER_TURN,
  );

  function crowded(customCount: number): Record<string, unknown> {
    const progress: Record<string, unknown> = {};
    for (const key of Object.keys(CATEGORY_LABELS)) {
      progress[key] = { category: key, status: "in_progress", budget: 12_345_678, spent: 2_345_678 };
    }
    for (let i = 0; i < customCount; i += 1) {
      const key = `custom_${String(1_773_727_842_937 + i)}`;
      progress[key] = {
        category: key,
        label: `직접 추가한 항목 ${i}`,
        status: "in_progress",
        budget: 1_234_567,
        spent: 234_567,
      };
    }
    return progress;
  }

  it.each([3, 5, 20, 60])("커스텀 %i개여도 상한을 넘지 않는다", async (n) => {
    const result = await executeTool("get_budget_summary", {}, makeCtx(crowded(n)));
    expect(JSON.stringify(result.toolOutput).length).toBeLessThanOrEqual(CAP);
  });

  it("고정 카테고리는 하나도 밀려나지 않는다", async () => {
    const result = await executeTool("get_budget_summary", {}, makeCtx(crowded(20)));
    const out = result.toolOutput as { categories: Array<{ key: string }> };
    const shown = new Set(out.categories.map((c) => c.key));
    for (const key of Object.keys(CATEGORY_LABELS)) expect(shown.has(key)).toBe(true);
  });

  it("생략했으면 개수를 밝히고 합계에는 그대로 넣는다", async () => {
    const result = await executeTool("get_budget_summary", {}, makeCtx(crowded(20)));
    const out = result.toolOutput as { custom_categories_omitted: number; total_spent: number };
    expect(out.custom_categories_omitted).toBeGreaterThan(0);
    // 합계는 생략과 무관하게 전부 센다 — 화면 상단 숫자와 같아야 한다.
    expect(out.total_spent).toBe(2_345_678 * Object.keys(CATEGORY_LABELS).length + 234_567 * 20);
    expect(result.displayMessage).toContain("예산 화면에서 확인");
  });

  it("넉넉할 때는 생략하지 않는다", async () => {
    const result = await executeTool("get_budget_summary", {}, makeCtx(crowded(1)));
    const out = result.toolOutput as { custom_categories_omitted: number; categories: Array<{ key: string }> };
    expect(out.custom_categories_omitted).toBe(0);
    expect(out.categories.some((c) => c.key.startsWith("custom_"))).toBe(true);
  });
});

describe("항목이 아주 많아도 대화가 죽지 않는다", () => {
  // 커스텀 목록은 `## 커플 상황` 안이라 절단 불가 영역으로 떼어진다. 그 영역만으로
  // 48,000자를 넘으면 컴포저가 예외를 던져 대화가 통째로 죽는다. journey API 는
  // progress 키를 300개까지 받으므로 사용자가 스스로 그 상태를 만들 수 있다.
  function many(n: number): Record<string, unknown> {
    const progress: Record<string, unknown> = {};
    for (let i = 0; i < n; i += 1) {
      const key = `custom_${String(1_773_727_842_937 + i)}`;
      progress[key] = {
        category: key,
        label: `아주 긴 이름을 가진 직접 추가 항목 ${String(i).padStart(3, "0")} 어쩌구저쩌구`,
        status: "in_progress",
        budget: 1_234_567,
      };
    }
    return progress;
  }

  const build = (n: number) =>
    buildAmoraSystemPrompt(promptContext(many(n)), {
      enabledToolNames: ["get_budget_summary", "add_custom_category"],
      requestKind: "chat",
      persistenceMode: "durable",
    });

  it.each([100, 300])("커스텀 %i개여도 프롬프트가 한도 안에 있다", (n) => {
    // 상한이 없으면 300개에서 74,902자까지 자란다(2026-08-24 실측).
    // 이 목록은 절단 불가 영역이라 48,000자 한도가 조용히 뚫린다.
    expect(build(n).length).toBeLessThanOrEqual(AMORA_SYSTEM_PROMPT_MAX_CHARS);
  });

  it("항목이 늘어도 프롬프트가 같이 자라지 않는다", () => {
    // 차이는 "N개가 더 있음" 의 자릿수뿐이어야 한다. 상한이 없으면 항목 수에
    // 비례해 자란다(100개 53,702자 → 300개 74,902자).
    expect(build(300).length - build(100).length).toBeLessThan(20);
  });

  it("실리지 않은 개수를 밝히고 화면을 가리킨다", () => {
    const prompt = promptWith(many(100));
    expect(prompt).toContain("개가 더 있음");
    expect(prompt).toContain("예산 화면에서 확인");
  });

  // 라벨이 길어도 한도 안에 있다.
  //
  // 처음 상한은 **개수**(40개)였다. 그런데 라벨은 최대 60자까지 실리고
  // (`promptData(label, 60)`) 키도 `custom_` + 24자가 될 수 있어서 한 줄이 90자일 수도
  // 150자일 수도 있다 — 개수로는 길이를 못 묶는다. 위 두 검사가 쓰는 라벨 하나로만
  // 재면 그 사실이 안 보인다. **가장 긴 경우를 따로 잰다.**
  function worstCase(n: number): Record<string, unknown> {
    const progress: Record<string, unknown> = {};
    for (let i = 0; i < n; i += 1) {
      const suffix = String(i);
      const key = `custom_${"0123456789abcdef01234567".slice(0, 24 - suffix.length)}${suffix}`;
      progress[key] = {
        category: key,
        // promptData 가 60자로 자르므로 그보다 길게 줘서 상한값을 그대로 쓰게 한다.
        label: "가".repeat(200),
        status: "in_progress",
        budget: 1_234_567,
        spent: 999_999,
      };
    }
    return progress;
  }

  it("라벨과 키가 가장 길어도 한도 안에 있다", () => {
    const length = buildAmoraSystemPrompt(promptContext(worstCase(300)), {
      enabledToolNames: ["get_budget_summary", "add_custom_category"],
      requestKind: "chat",
      persistenceMode: "durable",
    }).length;
    expect(length).toBeLessThanOrEqual(AMORA_SYSTEM_PROMPT_MAX_CHARS);
  });

  // 넘쳤을 때 **무엇을 잃는지**를 못 박는다.
  //
  // 넘겨도 예외가 나지는 않는다 — 컴포저가 선택 영역을 줄 단위로 자른다
  // (`amoraPromptComposer.ts:654-662`). 그래서 실패가 조용하다. 2026-08-26 실측:
  // 커스텀 34개부터 한도를 넘었고, 잘려 나간 것은 **후속 질문(`[suggestions]`) 계약
  // 18줄 전부**였다. 그 커플에게는 제안 칩이 이유 없이 사라졌고 아무도 볼 수 없었다.
  //
  // 길이만 재면 이걸 못 잡는다 — 운영 경로는 잘라서라도 한도를 맞추기 때문에 늘 통과한다.
  // 그래서 **운영과 같은 호출**(maxChars 를 넘김)로 계약이 남아 있는지 본다.
  it("항목이 많아도 후속 질문 계약이 잘려 나가지 않는다", () => {
    const production = (progress: Record<string, unknown>) =>
      buildAmoraSystemPrompt(promptContext(progress), {
        enabledToolNames: ["get_budget_summary", "add_custom_category"],
        requestKind: "chat",
        persistenceMode: "durable",
        maxChars: AMORA_SYSTEM_PROMPT_MAX_CHARS,
      });

    // 측정기 자가검증 — 빈 상태에서도 없으면 아래 대조가 아무것도 증명하지 않는다.
    expect(production({}), "빈 상태에서도 제안 계약이 없다 — 이 검사가 죽어 있다")
      .toContain("[suggestions]");
    expect(production(worstCase(300)), "항목이 많으면 제안 계약이 잘려 나간다")
      .toContain("[suggestions]");
  });
  it("적을 때는 전부 싣고 생략 문구도 없다", () => {
    const prompt = promptWith(many(3));
    expect(prompt).not.toContain("개가 더 있음");
    expect(prompt).toContain("항목 002");
  });
});

describe("배정 합계를 아모라가 더하지 않게 한다", () => {
  // 예전에는 total_allocated 가 없어서 아모라가 카테고리를 하나씩 더했는데,
  // 운영에서 실제로 항목 하나를 빠뜨렸다 — 실제 3,445만원인데 3,045만원이라고
  // 답했다(2026-08-24). 나열한 항목의 합과도, DB 와도 다른 숫자였다.
  const PROGRESS_WITH_MANY: Record<string, unknown> = {
    venue: { category: "venue", status: "not_started", budget: 22_000_000 },
    ring: { category: "ring", status: "not_started", budget: 4_000_000 },
    studio: { category: "studio", status: "not_started", budget: 3_000_000 },
    dress: { category: "dress", status: "not_started", budget: 2_000_000 },
    makeup: { category: "makeup", status: "not_started", budget: 1_500_000 },
    custom_1787536365775x: { category: "custom_1787536365775x", label: "테스트A3", status: "not_started", budget: 950_000 },
    custom_2dc1411117df5674e3eee3b6: { category: "custom_2dc1411117df5674e3eee3b6", label: "차량 이동", status: "in_progress", budget: 700_000 },
    custom_1787543270831: { category: "custom_1787543270831", label: "예단 운반", status: "not_started", budget: 300_000 },
  };
  const TRUTH = 34_450_000;

  it("배정 합계를 직접 준다", async () => {
    const result = await executeTool("get_budget_summary", {}, makeCtx(PROGRESS_WITH_MANY));
    const out = result.toolOutput as { total_allocated: number; unallocated: number };
    expect(out.total_allocated).toBe(TRUTH);
    expect(out.unallocated).toBe(50_000_000 - TRUTH);
  });

  it("목록에서 생략된 항목도 합계에는 들어간다", async () => {
    const crowded: Record<string, unknown> = { ...PROGRESS_WITH_MANY };
    for (const key of Object.keys(CATEGORY_LABELS)) {
      crowded[key] = { category: key, status: "in_progress", budget: 12_345_678, spent: 2_345_678 };
    }
    for (let i = 0; i < 30; i += 1) {
      const key = `custom_extra_${i}`;
      crowded[key] = { category: key, label: `추가 항목 ${i}`, status: "in_progress", budget: 1_000_000 };
    }
    const result = await executeTool("get_budget_summary", {}, makeCtx(crowded));
    const out = result.toolOutput as {
      total_allocated: number;
      custom_categories_omitted: number;
      categories: { key: string; allocated: number | null }[];
    };
    expect(out.custom_categories_omitted).toBeGreaterThan(0);
    // 실린 것만 더한 값보다 커야 한다 — 생략된 것도 합계에 있다는 뜻이다.
    const shownSum = out.categories.reduce((sum, c) => sum + (c.allocated ?? 0), 0);
    expect(out.total_allocated).toBeGreaterThan(shownSum);
  });

  it("자리가 남으면 생략하지 않는다", async () => {
    // 운영에서 3,728자(상한 4,000)인데도 커스텀 2개가 잘렸다 — 여유가 과했다.
    const result = await executeTool("get_budget_summary", {}, makeCtx(PROGRESS_WITH_MANY));
    const out = result.toolOutput as {
      custom_categories_omitted: number;
      categories: { key: string }[];
    };
    expect(out.custom_categories_omitted).toBe(0);
    for (const key of ["custom_1787536365775x", "custom_2dc1411117df5674e3eee3b6", "custom_1787543270831"]) {
      expect(out.categories.some((c) => c.key === key)).toBe(true);
    }
  });
});

describe("자리를 아껴 커스텀 항목이 밀려나지 않게 한다", () => {
  // 고정 22개에 `legacy_amount_unclassified: false` 를 다 실으면 770자인데,
  // 이 도구는 턴당 4,000자에서 잘린다. 그 자리를 직접 추가한 항목이 써야 한다.
  // 운영 실측(2026-08-24): 3,936자 → 3,196자, 생략 1개 → 0개.
  it("거짓인 legacy 플래그는 싣지 않는다", async () => {
    const result = await executeTool("get_budget_summary", {}, makeCtx({
      venue: { category: "venue", status: "in_progress", budget: 20_000_000 },
    }));
    expect(JSON.stringify(result.toolOutput)).not.toContain("legacy_amount_unclassified");
  });

  it("참일 때는 그대로 싣는다", async () => {
    const result = await executeTool("get_budget_summary", {}, makeCtx({
      venue: { category: "venue", status: "in_progress", cost: 15_000_000 },
    }));
    const out = result.toolOutput as { categories: { key: string; legacy_amount_unclassified?: boolean }[] };
    expect(out.categories.find((c) => c.key === "venue")?.legacy_amount_unclassified).toBe(true);
    expect(result.displayMessage).toContain("용도 미확인");
  });

  it("실제 커플 모양에서 커스텀이 하나도 밀려나지 않는다", async () => {
    // 고정 5개 + 커스텀 4개 — 운영 스모크 커플의 실제 모양이다.
    const result = await executeTool("get_budget_summary", {}, makeCtx({
      venue: { category: "venue", status: "not_started", budget: 22_000_000 },
      ring: { category: "ring", status: "not_started", budget: 4_000_000 },
      studio: { category: "studio", status: "not_started", budget: 3_000_000 },
      dress: { category: "dress", status: "not_started", budget: 2_000_000 },
      makeup: { category: "makeup", status: "not_started", budget: 1_500_000 },
      custom_a1: { category: "custom_a1", label: "차량 이동", status: "in_progress", budget: 1_200_000 },
      custom_a2: { category: "custom_a2", label: "테스트A3", status: "not_started", budget: 950_000 },
      custom_a3: { category: "custom_a3", label: "예단 운반", status: "not_started", budget: 300_000 },
      custom_a4: { category: "custom_a4", label: "테스트B", status: "not_started" },
    }));
    const out = result.toolOutput as { custom_categories_omitted: number; categories: { key: string }[] };
    expect(out.custom_categories_omitted).toBe(0);
    expect(out.categories.filter((c) => c.key.startsWith("custom_"))).toHaveLength(4);
  });
});

describe("합계는 도구가 준 값을 그대로 쓴다", () => {
  // 2026-08-24 운영: 도구가 total_allocated 를 정확히 줬는데도 모델이 한 번
  // 직접 더해 다른 숫자를 말했다(실제 3,495만원 → 3,945만원). 이후 6회는
  // 정확했으니 흔하지는 않지만, 사용자에게는 화면과 다른 금액으로 보인다.
  //
  // 두 겹으로 줄인다 — 표시 문구에 그 숫자를 넣고(모델이 가장 잘 되받는다),
  // 직접 더하지 말라고 도구 계약에 적는다.
  it("표시 문구가 배정 합계와 미배정을 말한다", async () => {
    const result = await executeTool("get_budget_summary", {}, makeCtx({
      venue: { category: "venue", status: "in_progress", budget: 20_000_000 },
      custom_a1: { category: "custom_a1", label: "차량 이동", status: "in_progress", budget: 1_200_000 },
    }));
    // 5,000만 총예산 · 배정 2,120만 · 미배정 2,880만
    expect(result.displayMessage).toContain("항목 배정 2,120만원");
    expect(result.displayMessage).toContain("미배정 2,880만원");
  });

  it("배정이 총예산을 넘어도 죽지 않는다", async () => {
    // formatWon 은 음수에서 RangeError 를 던진다. 배정 초과는 정상 상태이고
    // 예산 화면에도 초과 표시가 있으므로, 여기서 던지면 요약 자체가 실패한다.
    const result = await executeTool("get_budget_summary", {}, makeCtx({
      venue: { category: "venue", status: "in_progress", budget: 60_000_000 },
      custom_a1: { category: "custom_a1", label: "차량 이동", status: "in_progress", budget: 1_200_000 },
    }));
    expect(result.success).toBe(true);
    const out = result.toolOutput as { total_allocated: number; unallocated: number };
    expect(out.total_allocated).toBe(61_200_000);
    expect(out.unallocated).toBe(-11_200_000);
    expect(result.displayMessage).toContain("배정이 총예산보다 1,120만원 많음");
  });
  it("총예산을 안 넣었으면 초과라고 단정하지 않는다", async () => {
    // 총예산 미설정이면 total 이 0 이라 미배정이 음수가 된다. 사용자가 정한 적
    // 없는 총액을 기준으로 "초과"라고 말하면 안 된다 — 예산 화면은 그때 아무
    // 말도 하지 않는다(hasTotalBudget).
    const ctx = makeCtx({
      venue: { category: "venue", status: "in_progress", budget: 20_000_000 },
    });
    ctx.weddingContext.budget = 0;
    const result = await executeTool("get_budget_summary", {}, ctx);
    expect(result.success).toBe(true);
    const out = result.toolOutput as { total_allocated: number; unallocated: number | null };
    expect(out.total_allocated).toBe(20_000_000);
    expect(out.unallocated).toBeNull();
    expect(result.displayMessage).not.toContain("초과");
    expect(result.displayMessage).not.toContain("많음");
    expect(result.displayMessage).toContain("총예산");
  });
  it("직접 더하지 말라고 도구 계약에 적혀 있다", () => {
    const delivered = buildAmoraSystemPrompt(promptContext(PROGRESS), {
      enabledToolNames: ["get_budget_summary", "add_custom_category"],
      requestKind: "chat",
      persistenceMode: "durable",
    });
    expect(delivered).toContain("카테고리 금액을 직접 더하지 마세요");
    expect(delivered).toContain("`total_allocated`");
  });

  it("예산 도구가 없으면 그 규칙도 빠진다", () => {
    const delivered = buildAmoraSystemPrompt(promptContext(PROGRESS), {
      enabledToolNames: ["get_schedule_summary"],
      requestKind: "chat",
      persistenceMode: "durable",
    });
    expect(delivered).not.toContain("카테고리 금액을 직접 더하지 마세요");
  });
});
