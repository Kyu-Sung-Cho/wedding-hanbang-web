import { beforeEach, describe, expect, it, vi } from "vitest";

import "@/test/supabaseDestinationEnv";

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  createClientFromRequest: vi.fn(),
  updateAmoraActionRecord: vi.fn(),
  isTrustedMutationRequest: vi.fn(() => true),
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: mocks.createClientFromRequest,
}));
vi.mock("@/utils/trustedMutation", () => ({
  isTrustedMutationRequest: mocks.isTrustedMutationRequest,
}));
vi.mock("@/lib/amora/actionRepository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/amora/actionRepository")>();
  return { ...actual, updateAmoraActionRecord: mocks.updateAmoraActionRecord };
});

import { PATCH } from "../route";

const COUPLE_ID = "00000000-0000-4000-8000-000000000001";
const ACTION_ID = "amora-action-legacy-1";
const JOURNEY_ID = "00000000-0000-4000-8000-0000000000ff";

const STORED_ACTION = {
  id: ACTION_ID,
  title: "예식장 계약서 확인",
  description: "",
  status: "open",
  priority: "medium",
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
};

// 이 요청이 읽어 둔 스냅샷. 파트너가 그 사이에 저장한 값은 여기에 없다.
const STALE_PROGRESS = {
  __amora_actions: [STORED_ACTION],
  venue: { category: "venue", status: "in_progress", budget: 20_000_000 },
};

function patchRequest() {
  return new Request(`https://hanbang.ai/api/amora/actions/${ACTION_ID}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status: "done" }),
  });
}

function routeContext() {
  return { params: Promise.resolve({ id: ACTION_ID }) };
}

/**
 * 레거시 progress 경로의 admin client 대역.
 * `progressPatchError`가 있으면 원자적 RPC가 실패하고,
 * `journeyUpdateError`가 있으면 그 뒤의 직접 UPDATE도 실패한다.
 */
function adminStub({
  progressPatchError = null,
  journeyUpdateError = null,
}: {
  progressPatchError?: { code: string; message: string } | null;
  journeyUpdateError?: { code: string; message: string } | null;
} = {}) {
  const journeyUpdateEq = vi.fn().mockResolvedValue({ error: journeyUpdateError });
  const journeyUpdate = vi.fn(() => ({ eq: journeyUpdateEq }));
  const rpc = vi.fn().mockResolvedValue({
    data: progressPatchError ? null : STALE_PROGRESS,
    error: progressPatchError,
  });

  const from = vi.fn((table: string) => {
    if (table === "profiles") {
      return {
        select: () => ({
          eq: () => ({
            single: () => Promise.resolve({ data: { couple_id: COUPLE_ID }, error: null }),
          }),
        }),
      };
    }
    if (table === "wedding_journeys") {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({
              data: { id: JOURNEY_ID, progress: STALE_PROGRESS },
              error: null,
            }),
          }),
        }),
        update: journeyUpdate,
      };
    }
    throw new Error(`unexpected table ${table}`);
  });

  return { client: { from, rpc }, rpc, journeyUpdate, journeyUpdateEq };
}

describe("PATCH /api/amora/actions/[id] legacy progress path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isTrustedMutationRequest.mockReturnValue(true);
    // 전용 amora_actions 테이블이 없어 레거시 progress 경로로 떨어지는 상황.
    mocks.updateAmoraActionRecord.mockResolvedValue(null);
    mocks.createClientFromRequest.mockResolvedValue({
      auth: {
        getUser: () => Promise.resolve({
          data: { user: { id: "00000000-0000-4000-8000-00000000000a" } },
        }),
      },
    });
  });

  it("applies the update through the atomic progress patch", async () => {
    const admin = adminStub();
    mocks.createAdminClient.mockReturnValue(admin.client);

    const response = await PATCH(patchRequest(), routeContext());

    expect(response.status).toBe(200);
    expect(admin.rpc).toHaveBeenCalledWith("apply_journey_progress_patch", expect.objectContaining({
      p_couple_id: COUPLE_ID,
    }));
    // 원자적 경로가 성공했으면 전체 덮어쓰기는 없어야 한다.
    expect(admin.journeyUpdate).not.toHaveBeenCalled();
  });

  // 이전 동작: RPC가 실패하면 이 요청이 읽어 둔 오래된 progress 전체를 그대로
  // UPDATE 했다. 그 사이 파트너가 저장한 예산·일정·체크리스트가 지워진다.
  // 같은 무효식은 이미 lib/ai/tools/progressTools.ts 에서 닫혀 있었다.
  it("does not overwrite the whole progress snapshot when the atomic patch fails", async () => {
    const admin = adminStub({
      progressPatchError: { code: "XX000", message: "transient database failure" },
    });
    mocks.createAdminClient.mockReturnValue(admin.client);

    const response = await PATCH(patchRequest(), routeContext());

    expect(admin.journeyUpdate).not.toHaveBeenCalled();
    expect(response.status).toBe(500);
  });

  // 이전 동작: 폴백 UPDATE의 error를 아예 읽지 않고 200 + action을 돌려줬다.
  // 아무것도 저장되지 않았는데 화면과 아모라는 반영됐다고 말한다.
  it("does not report success when nothing was persisted", async () => {
    const admin = adminStub({
      progressPatchError: { code: "XX000", message: "transient database failure" },
      journeyUpdateError: { code: "55000", message: "COUPLE_PLAN_CHANGE_APPROVAL_REQUIRED" },
    });
    mocks.createAdminClient.mockReturnValue(admin.client);

    const response = await PATCH(patchRequest(), routeContext());

    expect(response.status).not.toBe(200);
    const payload = await response.json();
    expect(payload.action).toBeUndefined();
  });
});
