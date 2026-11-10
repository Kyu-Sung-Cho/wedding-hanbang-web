// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import { GET, PATCH } from "../route";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClientFromRequest: vi.fn() }));
vi.mock("@/utils/trustedMutation", () => ({
  isTrustedMutationRequest: vi.fn(() => true),
}));
vi.mock("@/utils/rateLimit", () => ({
  checkRateLimit: vi.fn(() => null),
  rateLimitKey: vi.fn(() => "settings-test"),
}));

const USER_ID = "00000000-0000-4000-8000-000000000001";
const COUPLE_ID = "10000000-0000-4000-8000-000000000001";

const currentSettings = {
  user_id: USER_ID,
  couple_id: COUPLE_ID,
  name: "기존 이름",
  community_nickname: "기존 별명",
  role: "bride",
  wedding_date: "2027-05-01",
  venue: "기존 예식장",
  total_budget: 30_000_000,
  care_notifications_enabled: false,
  care_notifications_consented_at: null,
};

function mockAuth(user: Record<string, unknown> | null = {
  id: USER_ID,
  email_confirmed_at: "2026-07-17T00:00:00.000Z",
}) {
  vi.mocked(createClientFromRequest).mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user } }) },
  } as unknown as Awaited<ReturnType<typeof createClientFromRequest>>);
}

function mockAdmin(
  result: { data: unknown; error: unknown } = { data: currentSettings, error: null },
) {
  const rpc = vi.fn().mockResolvedValue(result);
  vi.mocked(createAdminClient).mockReturnValue({ rpc } as unknown as ReturnType<typeof createAdminClient>);
  return rpc;
}

function patchRequest(body: unknown) {
  return new Request("http://localhost/api/settings/wedding-profile", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function validPatch(overrides: Record<string, unknown> = {}) {
  return {
    expected_couple_id: COUPLE_ID,
    changes: {
      name: "새 이름",
      community_nickname: "새 별명",
      wedding_date: null,
      venue: null,
      total_budget: 0,
    },
    expected: {
      name: "기존 이름",
      community_nickname: "기존 별명",
      wedding_date: "2027-05-01",
      venue: "기존 예식장",
      total_budget: 30_000_000,
    },
    ...overrides,
  };
}

describe("/api/settings/wedding-profile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("AMORA_CARE_OUTBOUND_ENABLED", "true");
    mockAuth();
  });

  it("loads one consistent private settings snapshot through one service RPC", async () => {
    const rpc = mockAdmin();

    const response = await GET(new Request("http://localhost/api/settings/wedding-profile"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      settings: currentSettings,
      careAvailability: { outboundEnabled: true, proactiveChatEnabled: false, emailVerified: true },
    });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("get_wedding_settings_snapshot", {
      p_user_id: USER_ID,
    });
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("rejects unauthenticated access before creating a service client", async () => {
    mockAuth(null);

    const response = await GET(new Request("http://localhost/api/settings/wedding-profile"));

    expect(response.status).toBe(401);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("commits profile, nickname, and journey changes through one atomic RPC", async () => {
    const rpc = mockAdmin({
      data: {
        ...currentSettings,
        name: "새 이름",
        community_nickname: "새 별명",
        wedding_date: null,
        venue: null,
        total_budget: 0,
      },
      error: null,
    });

    const response = await PATCH(patchRequest(validPatch()));

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("patch_wedding_settings_atomic", {
      p_user_id: USER_ID,
      p_expected_couple_id: COUPLE_ID,
      p_expected_couple_id_provided: true,
      p_name: "새 이름",
      p_name_provided: true,
      p_expected_name: "기존 이름",
      p_community_nickname: "새 별명",
      p_community_nickname_provided: true,
      p_expected_community_nickname: "기존 별명",
      p_wedding_date: null,
      p_wedding_date_provided: true,
      p_expected_wedding_date: "2027-05-01",
      p_venue: null,
      p_venue_provided: true,
      p_expected_venue: "기존 예식장",
      p_total_budget: 0,
      p_total_budget_provided: true,
      p_expected_total_budget: 30_000_000,
    });
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("sends only a changed journey field while retaining the couple fence", async () => {
    const rpc = mockAdmin();
    const response = await PATCH(patchRequest({
      expected_couple_id: COUPLE_ID,
      changes: { total_budget: 0 },
      expected: { total_budget: 30_000_000 },
    }));

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith(
      "patch_wedding_settings_atomic",
      expect.objectContaining({
        p_expected_couple_id: COUPLE_ID,
        p_name: null,
        p_name_provided: false,
        p_community_nickname: null,
        p_community_nickname_provided: false,
        p_wedding_date: null,
        p_wedding_date_provided: false,
        p_venue: null,
        p_venue_provided: false,
        p_total_budget: 0,
        p_total_budget_provided: true,
      }),
    );
  });

  it.each([
    ["an impossible date", { changes: { wedding_date: "2027-02-29" }, expected: { wedding_date: "2027-05-01" } }],
    ["a year-zero date", { changes: { wedding_date: "0000-01-01" }, expected: { wedding_date: "2027-05-01" } }],
    ["an implicit empty date clear", { changes: { wedding_date: "" }, expected: { wedding_date: "2027-05-01" } }],
    ["a parseInt-style budget", { changes: { total_budget: "12abc" }, expected: { total_budget: 30_000_000 } }],
    ["a fractional budget", { changes: { total_budget: 1.5 }, expected: { total_budget: 30_000_000 } }],
    ["a budget over ten hundred million won", { changes: { total_budget: 1_000_000_001 }, expected: { total_budget: 30_000_000 } }],
    ["an overlong venue", { changes: { venue: "가".repeat(121) }, expected: { venue: "기존 예식장" } }],
    ["a control character in a name", { changes: { name: "새\n이름" }, expected: { name: "기존 이름" } }],
    ["a control character in a venue", { changes: { venue: "새\t예식장" }, expected: { venue: "기존 예식장" } }],
    ["an unknown mutation field", { changes: { venue: "새 장소", admin: true }, expected: { venue: "기존 예식장", admin: null } }],
    ["a missing expected old value", { changes: { venue: "새 장소" }, expected: {} }],
    ["an extra expected old value", { changes: { venue: "새 장소" }, expected: { venue: "기존 예식장", name: "기존 이름" } }],
  ])("rejects %s before the database call", async (_label, fields) => {
    const rpc = mockAdmin();

    const response = await PATCH(patchRequest({
      expected_couple_id: COUPLE_ID,
      ...fields,
    }));

    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("requires an explicit loaded couple id fence even when it is null", async () => {
    const rpc = mockAdmin();

    const response = await PATCH(patchRequest({
      changes: { name: "새 이름" },
      expected: { name: "기존 이름" },
    }));

    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects a no-op field bundled beside a real change", async () => {
    const rpc = mockAdmin();

    const response = await PATCH(patchRequest({
      expected_couple_id: COUPLE_ID,
      changes: { name: "새 이름", venue: "기존 예식장" },
      expected: { name: "기존 이름", venue: "기존 예식장" },
    }));

    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("maps a locked stale-field or changed-couple fence to a retryable 409", async () => {
    const rpc = mockAdmin({ data: null, error: { message: "WEDDING_SETTINGS_CONFLICT" } });

    const response = await PATCH(patchRequest(validPatch()));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "SETTINGS_CHANGED",
      error: expect.stringContaining("다시 불러"),
    });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("fails closed with a pointer to the plan-change screen on legacy plan-field edits", async () => {
    const rpc = mockAdmin({
      data: null,
      error: { message: "COUPLE_PLAN_CHANGE_APPROVAL_REQUIRED" },
    });

    const response = await PATCH(patchRequest(validPatch()));

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.code).toBe("PLAN_CHANGE_REQUEST_REQUIRED");
    // 사람이 실제로 갈 수 있는 곳을 가리켜야 한다.
    expect(body.error).toContain("예산 화면");
    // 예전 문구는 두 가지를 틀리게 말했다 — 파트너가 없는 사람에게도 "파트너 확인이
    // 필요해요"라고 했고, 앱에도 있는 화면을 두고 "웹의"라고 했다.
    expect(body.error).not.toContain("웹의");
    expect(body.error).not.toMatch(/파트너 확인이 필요/u);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("does not promise two-person approval when a legacy plan-field edit is refused", async () => {
    // 2026-08-23 부터 한 사람이 저장하면 바로 반영되고, 연결된 파트너에게는 변경 알림만 간다.
    // 이 거절 문장이 "변경을 요청해 주세요 … 두 분이 확인한 뒤에 반영돼요" 라고 하면
    // 받은 사람은 있지도 않은 승인을 기다리게 된다.
    mockAdmin({
      data: null,
      error: { message: "COUPLE_PLAN_CHANGE_APPROVAL_REQUIRED" },
    });

    const response = await PATCH(patchRequest(validPatch()));

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.code).toBe("PLAN_CHANGE_REQUEST_REQUIRED");
    expect(body.error).not.toMatch(/두 분이 확인|확인한 뒤에 반영|변경을 요청/u);
    expect(body.error).toContain("바로 반영");
    expect(body.error).toContain("알림");
  });

  it("points each plan field at a screen that can change it", async () => {
    // 앱의 예산 화면에는 총 예산만 있고 예식일·식장을 고치는 칸이 없다. 예식일과 식장은
    // 2026-08-23 부터 앱의 설정 화면이 계획 변경 경로로 따로 보낸다(fe3893e94).
    // 이 거절을 만나는 것은 세 값을 옛 방식으로 보내는 그 전 앱뿐이다. 세 값을 모두 예산 화면으로
    // 보내면 두 값은 고칠 수 없는 곳을 가리키게 된다.
    mockAdmin({
      data: null,
      error: { message: "COUPLE_PLAN_CHANGE_APPROVAL_REQUIRED" },
    });

    const response = await PATCH(patchRequest(validPatch()));

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error).toMatch(/총 예산은 예산 화면에서/u);
    expect(body.error).toMatch(/결혼 예정일과 식장은[^.]*설정에서/u);
    expect(body.error).not.toMatch(/식장·총 예산은 예산 화면/u);
  });

  it("maps nickname uniqueness races without attempting a second write", async () => {
    const rpc = mockAdmin({
      data: null,
      error: {
        code: "23505",
        message: "duplicate key violates nickname_key",
        details: "community_profiles nickname_key",
      },
    });

    const response = await PATCH(patchRequest(validPatch()));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining("이미 사용") });
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
