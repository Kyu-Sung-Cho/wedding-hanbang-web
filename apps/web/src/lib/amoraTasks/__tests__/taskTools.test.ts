// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 맡은 일에서 쓰기 도구가 막혀 있는지를 세 겹으로 잰다(25장 갈래 4 "쓰기 도구가 계속 막히는 것을 시험으로 고정한다").
 *
 *   1. 맡은 일의 읽기 길(`executeAmoraTaskReadTool`)은 쓰기 도구 이름이면 실행기에 넘기지도 않는다.
 *   2. 그 길이 깨져 이름이 넘어가도, 실행기(`executeTool`)는 확인 카드 번호 없는 쓰기를 거절한다.
 *   3. 그것마저 깨져도, DB 의 도구 선점 함수는 `chat:` 모양이 아닌 요청 키(`task:`)를 거절한다.
 */

const executeToolMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/ai/toolExecutor", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/toolExecutor")>();
  return { ...actual, executeTool: executeToolMock };
});

import { MUTATING_TOOL_NAMES } from "@/lib/ai/mutationTools";
import {
  AMORA_TASK_READ_TOOLS,
  amoraTaskRequestKey,
  executeAmoraTaskReadTool,
  isAmoraTaskReadTool,
} from "../taskTools";

const COUPLE = "10000000-0000-4000-8000-000000000001";
const TASK = "20000000-0000-4000-8000-000000000001";
const context = {
  coupleId: COUPLE,
  taskId: TASK,
  runCount: 2,
  weddingContext: { weddingDate: "2027-05-08", budget: 30_000_000, venue: null, progress: {} },
};

beforeEach(() => {
  executeToolMock.mockReset();
  executeToolMock.mockResolvedValue({ toolName: "get_wedding_info", toolInput: {}, toolOutput: {}, success: true, displayMessage: "" });
});

describe("첫째 겹: 맡은 일의 읽기 길", () => {
  it("읽기 목록에 쓰기 도구가 하나도 없다", () => {
    const writes = new Set<string>(MUTATING_TOOL_NAMES);
    expect(AMORA_TASK_READ_TOOLS.filter((name) => writes.has(name))).toEqual([]);
  });

  it.each([...MUTATING_TOOL_NAMES, "offer_amora_task", "search_nearby_places", "create_booking", "no_such_tool"])(
    "%s 는 실행기에 넘기지 않는다",
    async (name) => {
      const result = await executeAmoraTaskReadTool(name, { total_budget: 0 }, context);
      expect(result.success).toBe(false);
      expect(result.toolOutput).toEqual({ error_code: "TASK_TOOL_NOT_ALLOWED" });
      expect(executeToolMock).not.toHaveBeenCalled();
      expect(isAmoraTaskReadTool(name)).toBe(false);
    },
  );

  it("읽기 도구는 카드 번호도 행위자도 없는 맡은 일 요청 키로만 부른다", async () => {
    await executeAmoraTaskReadTool("get_schedule_events", { from_date: "2026-11-21" }, context);
    expect(executeToolMock).toHaveBeenCalledTimes(1);
    const [name, input, executionContext] = executeToolMock.mock.calls[0];
    expect(name).toBe("get_schedule_events");
    expect(input).toEqual({ from_date: "2026-11-21" });
    expect(executionContext).toEqual({
      coupleId: COUPLE,
      requestKey: `task:${TASK}:2`,
      weddingContext: context.weddingContext,
    });
    expect(executionContext).not.toHaveProperty("pendingActionId");
    expect(executionContext).not.toHaveProperty("actorProfileId");
    expect(executionContext).not.toHaveProperty("requestAttemptCount");
  });
});

describe("둘째 겹: 실행기", () => {
  it("맡은 일 문맥으로는 어떤 쓰기 도구도 실행되지 않는다", async () => {
    const { executeTool } = await vi.importActual<typeof import("@/lib/ai/toolExecutor")>("@/lib/ai/toolExecutor");
    for (const name of MUTATING_TOOL_NAMES) {
      const result = await executeTool(name, { total_budget: 1 }, {
        coupleId: COUPLE,
        requestKey: amoraTaskRequestKey(TASK, 1),
        weddingContext: context.weddingContext,
      });
      expect(result.success, name).toBe(false);
      expect(["IDEMPOTENCY_CONTEXT_MISSING", "CONFIRMED_ACTION_REQUIRED", "legacy_schedule_delete_blocked"])
        .toContain((result.toolOutput as { error?: string }).error);
    }
  });
});

describe("셋째 겹: DB 의 도구 선점", () => {
  const migrations = resolve(process.cwd(), "../../supabase/migrations");
  const files = readdirSync(migrations).filter((name) => name.endsWith(".sql")).sort();

  function latestBodies(signature: string): string[] {
    const file = files.filter((name) => readFileSync(resolve(migrations, name), "utf8").includes(signature)).at(-1);
    expect(file, signature).toBeTruthy();
    const text = readFileSync(resolve(migrations, file!), "utf8");
    return text.split(signature).slice(1).map((chunk) => chunk.split("$function$;")[0]);
  }

  it("도구 선점 함수(두 판 모두)가 chat: 모양이 아닌 요청 키를 거절하고, 이 가지의 마이그레이션이 그것을 다시 정의하지 않는다", () => {
    const bodies = latestBodies("FUNCTION public.claim_amora_tool_execution(");
    expect(bodies.length).toBeGreaterThanOrEqual(2);
    for (const body of bodies) {
      const match = /p_request_key !~\* '([^']+)'/.exec(body);
      expect(match, "chat key check").not.toBeNull();
      const pattern = new RegExp(match![1], "i");
      expect(pattern.test(`chat:${COUPLE}:${TASK}`)).toBe(true);
      expect(pattern.test(amoraTaskRequestKey(TASK, 1))).toBe(false);
    }
    const tasksMigration = readFileSync(resolve(migrations, "20261120160000_amora_tasks.sql"), "utf8");
    expect(tasksMigration).not.toMatch(/claim_amora_tool_execution|apply_amora_atomic_tool_execution/);
  });
});
