// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import { withAddedAmoraAction } from "@/lib/amora/actions";
import { PATCH } from "../route";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const COUPLE_ID = "22222222-2222-4222-8222-222222222222";
const REQUEST_ID = "33333333-3333-4333-8333-333333333333";

const mocks = vi.hoisted(() => ({
  profileCoupleId: "22222222-2222-4222-8222-222222222222",
  currentProgress: {} as Record<string, unknown>,
  rpc: vi.fn(),
}));

function queryResult(data: unknown) {
  const query: Record<string, unknown> = {};
  query.select = vi.fn(() => query);
  query.eq = vi.fn(() => query);
  query.single = vi.fn(async () => ({ data, error: null }));
  return query;
}

vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: vi.fn(async () => ({
    auth: {
      getUser: vi.fn(async () => ({ data: { user: { id: USER_ID } } })),
    },
    from(table: string) {
      if (table === "profiles") return queryResult({ couple_id: mocks.profileCoupleId });
      if (table === "wedding_journeys") {
        return queryResult({ progress: mocks.currentProgress, state_revision: 7 });
      }
      throw new Error("Unexpected authenticated table");
    },
  })),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({ rpc: mocks.rpc })),
}));

vi.mock("@/utils/rateLimit", () => ({
  checkRateLimitPersistent: vi.fn(async () => null),
  rateLimitKey: vi.fn(() => "journey:independent-reserved-carry"),
}));

function request(progress: Record<string, unknown>) {
  return new Request("http://localhost/api/journey", {
    method: "PATCH",
    headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
    body: JSON.stringify({ expected_revision: 7, expected_couple_id: COUPLE_ID, progress }),
  });
}

function existingLegacyProgress(title: string) {
  const progress = withAddedAmoraAction({ custom: { note: "이전 메모" } }, {
    id: "legacy-carry-real-helper",
    title,
    description: "원본 포함 여부 확인",
    source: "chat",
    priority: "medium",
    createdAt: "2026-10-12T07:00:00.123456Z",
    updatedAt: "2026-10-12T07:00:00.123456Z",
  });
  // 실제 jsonb 저장처럼 undefined 속성을 제거한 뒤 DB 조회값으로 사용한다.
  return JSON.parse(JSON.stringify(progress)) as typeof progress;
}

type ReservedState = "absent" | "null" | "empty";

function progressWithReservedState(state: ReservedState, note: string): Record<string, unknown> {
  const progress: Record<string, unknown> = { custom: { note } };
  if (state === "null") progress.__amora_actions = null;
  if (state === "empty") progress.__amora_actions = [];
  return progress;
}

describe("independent reserved-action whole-progress carry boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.profileCoupleId = COUPLE_ID;
    mocks.currentProgress = {};
    mocks.rpc.mockResolvedValue({
      data: {
        requestId: REQUEST_ID,
        status: "applied",
        requiredCount: 1,
        acceptedCount: 1,
        journey: { couple_id: COUPLE_ID, state_revision: 8, progress: {} },
      },
      error: null,
    });
  });

  it.each([
    ["ordinary title", "원본 포함 여부 확인"],
    ["original repeated spaces", "원본  포함 여부 확인"],
    ["plain angle-bracket text", "<필수> 원본 포함 여부 확인"],
  ])("carries an unchanged real-helper legacy card: %s", async (_label, title) => {
    const current = existingLegacyProgress(title);
    expect(current.__amora_actions[0].title).toBe(title);
    mocks.currentProgress = current;

    const response = await PATCH(request({ ...current, custom: { note: "새 메모" } }));

    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("submit_couple_plan_change", expect.objectContaining({
      p_couple_id: COUPLE_ID,
      p_actor_user_id: USER_ID,
      p_expected_revision: 7,
      p_changes: { progress_patch: { custom: { note: "새 메모" } }, progress_remove_keys: [] },
    }));
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(current.__amora_actions[0].title).toBe(title);
  });

  it("still rejects an explicitly changed raw card even when sanitization would make it equal", async () => {
    const current = existingLegacyProgress("원본  포함 여부 확인");
    mocks.currentProgress = current;

    const response = await PATCH(request({
      ...current,
      __amora_actions: [{ ...current.__amora_actions[0], title: "원본 포함 여부 확인" }],
      custom: { note: "새 메모" },
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: "AMORA_ACTION_VIEW_REQUIRED" });
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each([
    "원본  포함 여부 확인",
    "<필수> 원본 포함 여부 확인",
  ])("rejects a newly changed raw title even when sanitized text would equal the ordinary original: %s", async (title) => {
    const current = existingLegacyProgress("원본 포함 여부 확인");
    mocks.currentProgress = current;

    const response = await PATCH(request({
      ...current,
      __amora_actions: [{ ...current.__amora_actions[0], title }],
      custom: { note: "새 메모" },
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: "AMORA_ACTION_VIEW_REQUIRED" });
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("still rejects removal of a preserved legacy card", async () => {
    mocks.currentProgress = existingLegacyProgress("<필수> 원본 포함 여부 확인");

    const response = await PATCH(request({ custom: { note: "새 메모" } }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: "AMORA_ACTION_VIEW_REQUIRED" });
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("does not turn unchanged carry into authority for a different couple", async () => {
    const current = existingLegacyProgress("원본 포함 여부 확인");
    mocks.currentProgress = current;
    mocks.profileCoupleId = "55555555-5555-4555-8555-555555555555";

    const response = await PATCH(request({ ...current, custom: { note: "새 메모" } }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: "PLAN_CHANGE_IDENTITY_CHANGED" });
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("allows only object-key reordering of a preserved raw legacy card", async () => {
    const current = existingLegacyProgress("<필수> 원본  포함 여부 확인");
    mocks.currentProgress = current;
    const reordered = Object.fromEntries(Object.entries(current.__amora_actions[0]).reverse());
    expect(Object.keys(reordered)).not.toEqual(Object.keys(current.__amora_actions[0]));
    expect(reordered).toEqual(current.__amora_actions[0]);

    const response = await PATCH(request({
      ...current,
      __amora_actions: [reordered],
      custom: { note: "새 메모" },
    }));

    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("submit_couple_plan_change", expect.objectContaining({
      p_changes: { progress_patch: { custom: { note: "새 메모" } }, progress_remove_keys: [] },
    }));
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["absent", "null"],
    ["absent", "empty"],
    ["null", "absent"],
    ["null", "empty"],
    ["empty", "absent"],
    ["empty", "null"],
  ] as const)("does not merge reserved presence/value %s into %s", async (currentState, nextState) => {
    mocks.currentProgress = progressWithReservedState(currentState, "이전 메모");

    const response = await PATCH(request(progressWithReservedState(nextState, "새 메모")));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: "AMORA_ACTION_VIEW_REQUIRED" });
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each(["absent", "null", "empty"] as const)("allows a normal field change with identical reserved state %s", async (state) => {
    mocks.currentProgress = progressWithReservedState(state, "이전 메모");

    const response = await PATCH(request(progressWithReservedState(state, "새 메모")));

    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("submit_couple_plan_change", expect.objectContaining({
      p_changes: { progress_patch: { custom: { note: "새 메모" } }, progress_remove_keys: [] },
    }));
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });

  it("still sanitizes an unrelated normal field without rewriting the preserved raw card", async () => {
    const current = existingLegacyProgress("<필수> 원본  포함 여부 확인");
    mocks.currentProgress = current;

    const response = await PATCH(request({
      ...current,
      custom: { note: "  <b>새</b>    메모  " },
    }));

    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("submit_couple_plan_change", expect.objectContaining({
      p_changes: { progress_patch: { custom: { note: "새 메모" } }, progress_remove_keys: [] },
    }));
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(current.__amora_actions[0].title).toBe("<필수> 원본  포함 여부 확인");
  });
});
