import { beforeEach, describe, expect, it, vi } from "vitest";
import { executeAddAmoraAction, executeUpdateAmoraAction } from "../tools/amoraActionTools";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAmoraActionRecord, insertAmoraActionRecord, updateAmoraActionRecord } from "@/lib/amora/actionRepository";
import { saveProgress } from "../tools/progressTools";
import type { ToolExecutionContext } from "../tools/toolTypes";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(() => ({})) }));
vi.mock("@/lib/amora/actionRepository", async (original) => ({
  ...await original<typeof import("@/lib/amora/actionRepository")>(),
  insertAmoraActionRecord: vi.fn(),
  getAmoraActionRecord: vi.fn(),
  updateAmoraActionRecord: vi.fn(),
  listAmoraActionRecords: vi.fn(async () => []),
}));
vi.mock("../tools/progressTools", () => ({ saveProgress: vi.fn(async () => undefined) }));

const makeContext = (): ToolExecutionContext => ({
  coupleId: "20000000-0000-4000-8000-000000000001",
  actorProfileId: "10000000-0000-4000-8000-000000000001",
  requestKey: "chat:10000000-0000-4000-8000-000000000001:40000000-0000-4000-8000-000000000001",
  requestAttemptCount: 1,
  weddingContext: { weddingDate: null, budget: 17, venue: null, progress: {} },
});

describe("승인된 atomic 실행 밖의 오래된 action mutator는 저장하지 않는다", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("add는 저장 장애를 가짜 성공으로 바꾸지 않고 admin/mirror 호출 없이 명시적으로 거절한다", async () => {
    vi.mocked(insertAmoraActionRecord).mockRejectedValueOnce(new Error("SYNTHETIC-STORAGE-FAILURE"));
    const context = makeContext();
    const before = structuredClone(context);
    const result = await executeAddAmoraAction({ title: "SYNTHETIC-UNAPPROVED-ADD" }, context);
    expect(result.success).toBe(false);
    expect(result.toolOutput).toEqual({ error_code: "AMORA_ACTION_NON_ATOMIC_MUTATION_RETIRED" });
    expect(result.displayMessage).not.toContain("저장했습니다");
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(insertAmoraActionRecord).not.toHaveBeenCalled();
    expect(saveProgress).not.toHaveBeenCalled();
    expect(context).toEqual(before);
  });

  it("update는 기존 할 일이 있어도 version 없는 admin UPDATE나 legacy mirror를 호출하지 않는다", async () => {
    const action = { id: "retired_action", title: "SYNTHETIC-EXISTING", priority: "medium" as const,
      status: "open" as const, source: "manual" as const,
      createdAt: "2026-01-01T00:00:00.123456Z", updatedAt: "2026-01-01T00:00:00.123456Z" };
    vi.mocked(getAmoraActionRecord).mockResolvedValueOnce(action);
    vi.mocked(updateAmoraActionRecord).mockResolvedValueOnce({ ...action, title: "SYNTHETIC-UNAPPROVED-UPDATE" });
    const context = makeContext(), before = structuredClone(context);
    const result = await executeUpdateAmoraAction({ action_id: action.id, title: "SYNTHETIC-UNAPPROVED-UPDATE" }, context);
    expect(result.success).toBe(false);
    expect(result.toolOutput).toEqual({ error_code: "AMORA_ACTION_NON_ATOMIC_MUTATION_RETIRED" });
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(getAmoraActionRecord).not.toHaveBeenCalled();
    expect(updateAmoraActionRecord).not.toHaveBeenCalled();
    expect(saveProgress).not.toHaveBeenCalled();
    expect(context).toEqual(before);
  });

  it.each(["add", "update"] as const)("%s에 pending ID나 provider 번호를 넘겨도 retired 함수가 승인 경로로 둔갑하지 않는다", async (kind) => {
    const context = { ...makeContext(), pendingActionId: "50000000-0000-4000-8000-000000000001", providerCallIndex: 1 };
    const before = structuredClone(context);
    const run = kind === "add" ? executeAddAmoraAction : executeUpdateAmoraAction;
    const result = await run({ title: "SYNTHETIC-RETIRED", action_id: "retired_action", confirmed: true }, context);
    expect(result.success).toBe(false);
    expect(result.toolOutput).toEqual({ error_code: "AMORA_ACTION_NON_ATOMIC_MUTATION_RETIRED" });
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(insertAmoraActionRecord).not.toHaveBeenCalled();
    expect(updateAmoraActionRecord).not.toHaveBeenCalled();
    expect(saveProgress).not.toHaveBeenCalled();
    expect(context).toEqual(before);
  });
});
