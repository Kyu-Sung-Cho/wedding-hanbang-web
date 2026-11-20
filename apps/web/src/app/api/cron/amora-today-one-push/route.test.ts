// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAdminClient } from "@/lib/supabase/admin";
import { readAmoraActionSnapshot } from "@/lib/amora/actionRepository";
import { isAmoraTodayOneEnabled } from "@/lib/features/amoraCareFlags";
import { sendAmoraPush } from "@/lib/amora/push/sendAmoraPush";
import { GET } from "./route";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/amora/actionRepository", () => ({ readAmoraActionSnapshot: vi.fn() }));
vi.mock("@/lib/features/amoraCareFlags", () => ({ isAmoraTodayOneEnabled: vi.fn(() => true) }));
vi.mock("@/lib/amora/push/sendAmoraPush", () => ({
  isAmoraAppPushEnabled: () => process.env.AMORA_APP_PUSH_ENABLED === "true",
  sendAmoraPush: vi.fn(async () => ({ sent: true, reason: "sent" })),
}));

const WITH_EVENT = "10000000-0000-4000-8000-000000000001";
const NOTHING = "10000000-0000-4000-8000-000000000002";
const COUPLE_EVENT = "20000000-0000-4000-8000-000000000001";
const COUPLE_NOTHING = "20000000-0000-4000-8000-000000000002";

function request(token = "cron-secret") {
  return new Request("http://localhost/api/cron/amora-today-one-push", { headers: { authorization: `Bearer ${token}` } });
}

function admin() {
  const journeys: Record<string, unknown> = {
    [COUPLE_EVENT]: {
      wedding_date: "2026-12-12",
      total_budget: null,
      state_revision: 4,
      progress: { __events: [{ id: "evt-1", date: "2026-11-21", time: "18:00", title: "상견례", momentType: "sanggyeonrye", status: "planned", createdAt: "2026-11-01T00:00:00.000Z", updatedAt: "2026-11-01T00:00:00.000Z" }] },
    },
    [COUPLE_NOTHING]: { wedding_date: null, total_budget: null, state_revision: 2, progress: {} },
  };
  const rpc = vi.fn(async () => ({
    data: [{ user_id: WITH_EVENT, couple_id: COUPLE_EVENT }, { user_id: NOTHING, couple_id: COUPLE_NOTHING }],
    error: null,
  }));
  const from = vi.fn(() => {
    let couple = "";
    const builder = {
      select: () => builder,
      eq: (_column: string, value: string) => { couple = value; return builder; },
      maybeSingle: async () => ({ data: journeys[couple] ?? null, error: null }),
    };
    return builder;
  });
  return { rpc, from };
}

describe("/api/cron/amora-today-one-push", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("CRON_SECRET", "cron-secret");
    vi.stubEnv("AMORA_APP_PUSH_ENABLED", "true");
    vi.mocked(isAmoraTodayOneEnabled).mockReturnValue(true);
    vi.mocked(readAmoraActionSnapshot).mockResolvedValue({ actions: [] } as never);
    vi.setSystemTime(new Date("2026-11-20T01:00:00.000Z")); // KST 10:00
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("크론 비밀값이 없으면 401", async () => {
    expect((await GET(request("wrong"))).status).toBe(401);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("스위치가 하나라도 꺼져 있거나 조용한 시간이면 DB 에 가지 않는다", async () => {
    vi.stubEnv("AMORA_APP_PUSH_ENABLED", "false");
    expect(await (await GET(request())).json()).toEqual({ ok: true, disabled: true });
    vi.stubEnv("AMORA_APP_PUSH_ENABLED", "true");
    vi.mocked(isAmoraTodayOneEnabled).mockReturnValue(false);
    expect(await (await GET(request())).json()).toEqual({ ok: true, disabled: true });
    vi.mocked(isAmoraTodayOneEnabled).mockReturnValue(true);
    vi.setSystemTime(new Date("2026-11-20T11:30:00.000Z")); // KST 20:30
    expect(await (await GET(request())).json()).toEqual({ ok: true, skipped: "quiet_hours" });
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(sendAmoraPush).not.toHaveBeenCalled();
  });

  it("오늘 고를 것이 있는 사람에게만 내용 없는 알림을 보낸다", async () => {
    const client = admin();
    vi.mocked(createAdminClient).mockReturnValue(client as never);
    const body = await (await GET(request())).json();
    expect(client.rpc).toHaveBeenCalledWith("list_amora_today_one_push_recipients", { p_limit: 50 });
    expect(sendAmoraPush).toHaveBeenCalledTimes(1);
    expect(sendAmoraPush).toHaveBeenCalledWith({ userId: WITH_EVENT, kind: "today_one", deepLink: "home" });
    expect(body).toEqual({ ok: true, recipients: 2, counts: { sent: 1, nothing_today: 1 } });
  });

  it("롤아웃 승인 전까지 Vercel 크론 목록에 넣지 않는다", () => {
    const vercel = JSON.parse(readFileSync(resolve(process.cwd(), "vercel.json"), "utf8")) as { crons?: { path: string }[] };
    const paths = (vercel.crons ?? []).map((cron) => cron.path.split("?")[0].replace(/\/+$/, ""));
    expect(paths).not.toContain("/api/cron/amora-today-one-push");
  });
});
