// @vitest-environment node
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * 맡은 일 마이그레이션(20261120160000)을 그대로 실행해 권한·선점·한도를 잰다.
 *
 * 바탕 객체(couples, auth.uid(), 회원 판정, 탈퇴 작업, 글자 검사)는 그 모양만 흉내 낸다. 회원 판정은 운영의
 * `is_current_couple_member` 와 같은 뜻(그 커플의 신부·신랑 칸에 있는 사람)으로 둔다.
 * PGlite 는 연결이 하나라 진짜 동시 실행은 못 잰다. 동시성은 줄 잠금과 선점 토큰(펜싱)으로 지키고, 여기서는
 * "다른 일꾼이 다시 선점한 뒤 앞 일꾼의 쓰기가 거절되는지"를 순서대로 재현해 잰다.
 */

const MIGRATION = "20261120160000_amora_tasks.sql";
const sql = (name: string) => readFileSync(resolve(process.cwd(), "../../supabase/migrations", name), "utf8");

let db: PGlite;

async function asService<T>(query: string, params: unknown[] = []) {
  await db.exec("RESET ROLE");
  return db.query<T>(query, params);
}

async function asMember<T>(userId: string | null, query: string, params: unknown[] = []) {
  await db.exec("RESET ROLE");
  await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [userId ?? ""]);
  await db.exec(userId ? "SET ROLE authenticated" : "SET ROLE anon");
  try {
    return await db.query<T>(query, params);
  } finally {
    await db.exec("RESET ROLE");
  }
}

type Couple = { couple: string; bride: string; groom: string };

async function newCouple(): Promise<Couple> {
  const couple = randomUUID();
  const bride = randomUUID();
  const groom = randomUUID();
  await asService("INSERT INTO auth.users(id) VALUES ($1), ($2)", [bride, groom]);
  await asService("INSERT INTO public.couples(id, bride_id, groom_id) VALUES ($1, $2, $3)", [couple, bride, groom]);
  return { couple, bride, groom };
}

const requestKey = (user: string) => `chat:${user}:${randomUUID()}`;

async function offer(c: Couple, options: {
  kind?: string; key?: string; lane?: string; by?: string; claimLane?: string | null;
} = {}) {
  const by = options.by ?? c.bride;
  const key = options.key ?? requestKey(by);
  // 대화 라우트는 모델을 부르기 전에 그 턴을 선점한다. 그 기록의 레인을 DB 가 다시 본다.
  if (options.claimLane !== null) {
    await asService(
      "INSERT INTO public.amora_chat_request_claims(couple_id, request_key, user_id, visibility) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING",
      [c.couple, key, by, options.claimLane ?? "shared"],
    );
  }
  const { rows } = await asService<{ result: Record<string, unknown> }>(
    "SELECT public.offer_amora_task($1, $2, $3, $4, $5, $6, $7::jsonb, $8) AS result",
    [c.couple, by, options.lane ?? "shared", key, options.kind ?? "todo_deadlines",
      "할 일과 마감 정리", JSON.stringify({ horizon_days: 60 }), 86_400],
  );
  return rows[0].result;
}

async function start(taskId: unknown, actor: string, cap = 3) {
  const { rows } = await asService<{ result: Record<string, unknown> }>(
    "SELECT public.start_amora_task($1, $2, $3) AS result", [taskId, actor, cap],
  );
  return rows[0].result;
}

async function claim() {
  const { rows } = await asService<{ id: string; lease_token: string; status: string; failure_count: number }>(
    "SELECT id, lease_token, status, failure_count FROM public.claim_amora_task(120)",
  );
  return rows[0] ?? null;
}

async function reserve(taskId: string, token: string, usage: "model_step" | "web_search", caps: {
  task?: number; couple?: number; globalCost?: number; cost?: number;
} = {}) {
  const { rows } = await asService<{ result: { allowed: boolean; reason: string | null } }>(
    "SELECT public.reserve_amora_task_usage($1, $2, $3, $4, $5, $6, $7) AS result",
    [taskId, token, usage, caps.cost ?? (usage === "model_step" ? 7_920 : 0), caps.task ?? 16, caps.couple ?? 60,
      caps.globalCost ?? 10_000_000_000],
  );
  return rows[0].result;
}

/** 다른 커플의 남은 일이 선점을 가로채지 않게 이 커플 것만 열어 두고 선점한다. */
async function claimFor(c: Couple) {
  await asService(
    "UPDATE public.amora_tasks SET available_at = now() + interval '1 day' WHERE couple_id <> $1 AND status IN ('queued','searching','organizing') AND lease_token IS NULL",
    [c.couple],
  );
  return claim();
}

beforeAll(async () => {
  db = await PGlite.create();
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth;
    GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
    GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
    CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE TABLE public.couples(id uuid PRIMARY KEY, bride_id uuid REFERENCES auth.users ON DELETE SET NULL, groom_id uuid REFERENCES auth.users ON DELETE SET NULL);
    CREATE TABLE public.account_deletion_jobs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, status text NOT NULL);
    CREATE TABLE public.amora_chat_request_claims(couple_id uuid REFERENCES public.couples ON DELETE CASCADE, request_key text, user_id uuid, visibility text, PRIMARY KEY(couple_id, request_key));
    CREATE FUNCTION public.is_current_couple_member(p_user uuid, p_couple uuid) RETURNS boolean
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
      SELECT p_user IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.couples WHERE id = p_couple AND p_user IN (bride_id, groom_id)) $$;
    CREATE FUNCTION public.is_couple_member(p_couple uuid) RETURNS boolean
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
      SELECT public.is_current_couple_member(auth.uid(), p_couple) $$;
    GRANT EXECUTE ON FUNCTION public.is_couple_member(uuid) TO authenticated, service_role;
    CREATE FUNCTION public.couple_plan_change_has_unsafe_display_text(p_value text) RETURNS boolean
      LANGUAGE sql IMMUTABLE STRICT AS $$ SELECT p_value ~ '[[:cntrl:]]' $$;
  `);
  await db.exec(sql(MIGRATION));
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe("권한", () => {
  it("회원은 자기 커플 줄의 화면 칸만 읽는다", async () => {
    const a = await newCouple();
    const b = await newCouple();
    const mine = await offer(a);
    await offer(b);
    const { rows } = await asMember<{ id: string; title: string }>(a.groom, "SELECT id, title FROM public.amora_tasks");
    expect(rows.map((row) => row.id)).toEqual([mine.task_id]);
    for (const column of ["input", "progress", "lease_token", "cost_microusd", "error_code", "source_request_key", "requested_by"]) {
      await expect(asMember(a.bride, `SELECT ${column} FROM public.amora_tasks`)).rejects.toThrow(/permission denied/);
    }
  });

  it("로그아웃은 표를 읽지 못하고, 회원도 쓰거나 함수를 부르지 못한다", async () => {
    const a = await newCouple();
    const task = await offer(a);
    await expect(asMember(null, "SELECT id FROM public.amora_tasks")).rejects.toThrow(/permission denied/);
    await expect(asMember(a.bride, "UPDATE public.amora_tasks SET status = 'done' WHERE id = $1", [task.task_id])).rejects.toThrow(/permission denied/);
    await expect(asMember(a.bride, "DELETE FROM public.amora_tasks WHERE id = $1", [task.task_id])).rejects.toThrow(/permission denied/);
    await expect(asMember(a.bride, "INSERT INTO public.amora_tasks(couple_id, kind, title, source_lane, source_request_key, offer_expires_at) VALUES ($1, 'todo_deadlines', 'x', 'shared', $2, now())", [a.couple, requestKey(a.bride)])).rejects.toThrow(/permission denied/);
    await expect(asMember(a.bride, "SELECT public.start_amora_task($1, $2, 3)", [task.task_id, a.bride])).rejects.toThrow(/permission denied/);
    await expect(asMember(a.bride, "SELECT * FROM public.claim_amora_task(120)")).rejects.toThrow(/permission denied/);
    await expect(asMember(a.bride, "SELECT * FROM public.amora_task_daily_usage")).rejects.toThrow(/permission denied/);
    await expect(asMember(a.bride, "SELECT * FROM public.amora_task_global_daily_usage")).rejects.toThrow(/permission denied/);
  });
});

describe("카드", () => {
  it("공유 대화에서만, 회원만, 요청 키 주인만 카드를 만든다", async () => {
    const a = await newCouple();
    const outsider = randomUUID();
    await asService("INSERT INTO auth.users(id) VALUES ($1)", [outsider]);
    expect(await offer(a, { lane: "bride_private" })).toMatchObject({ ok: false, code: "shared_lane_only" });
    expect(await offer(a, { by: outsider })).toMatchObject({ ok: false, code: "not_member" });
    await expect(offer(a, { key: requestKey(a.groom) })).rejects.toThrow(/AMORA_TASK_OFFER_INVALID/);
  });

  it("앱이 공유 대화라고 해도 그 턴의 선점 기록이 개인 대화면 카드를 만들지 않는다", async () => {
    const a = await newCouple();
    expect(await offer(a, { claimLane: "bride_private" })).toMatchObject({ ok: false, code: "shared_lane_only" });
    expect(await offer(a, { claimLane: null })).toMatchObject({ ok: false, code: "request_not_found" });
    const { rows } = await asService<{ count: number }>("SELECT count(*)::int AS count FROM public.amora_tasks WHERE couple_id = $1", [a.couple]);
    expect(rows[0].count).toBe(0);
  });

  it("같은 턴을 다시 보내도 카드는 하나다", async () => {
    const a = await newCouple();
    const key = requestKey(a.bride);
    const first = await offer(a, { key });
    const second = await offer(a, { key });
    expect(second).toMatchObject({ ok: true, code: "existing", task_id: first.task_id });
    const { rows } = await asService<{ count: number }>("SELECT count(*)::int AS count FROM public.amora_tasks WHERE couple_id = $1", [a.couple]);
    expect(rows[0].count).toBe(1);
  });

  it("열린 카드는 커플당 다섯 장까지다", async () => {
    const a = await newCouple();
    for (let index = 0; index < 5; index += 1) expect((await offer(a)).ok).toBe(true);
    expect(await offer(a)).toMatchObject({ ok: false, code: "too_many_offers" });
  });
});

describe("맡기기", () => {
  it("상대도 누를 수 있고, 두 번 눌러도 한 번만 센다", async () => {
    const a = await newCouple();
    const task = await offer(a);
    expect(await start(task.task_id, a.groom)).toMatchObject({ ok: true, code: "started", status: "queued" });
    expect(await start(task.task_id, a.bride)).toMatchObject({ ok: true, code: "already_started" });
    const { rows } = await asService<{ tasks_started: number; day_matches: boolean }>(
      "SELECT tasks_started, usage_day = (now() AT TIME ZONE 'Asia/Seoul')::date AS day_matches FROM public.amora_task_daily_usage WHERE couple_id = $1",
      [a.couple],
    );
    expect(rows).toEqual([{ tasks_started: 1, day_matches: true }]);
  });

  it("커플 밖 사람은 카드를 찾지 못한다", async () => {
    const a = await newCouple();
    const b = await newCouple();
    const task = await offer(a);
    expect(await start(task.task_id, b.bride)).toMatchObject({ ok: false, code: "not_found" });
  });

  it("하루에 맡길 수 있는 수를 넘기면 거절한다", async () => {
    const a = await newCouple();
    const tasks = [];
    for (let index = 0; index < 4; index += 1) tasks.push(await offer(a));
    for (const task of tasks.slice(0, 3)) expect((await start(task.task_id, a.bride)).ok).toBe(true);
    expect(await start(tasks[3].task_id, a.bride)).toMatchObject({ ok: false, code: "daily_task_limit" });
    const { rows } = await asService<{ status: string }>("SELECT status FROM public.amora_tasks WHERE id = $1", [tasks[3].task_id]);
    expect(rows[0].status).toBe("offered");
  });

  it("닫힌 카드는 맡길 수 없고 닫힘으로 표시한다", async () => {
    const a = await newCouple();
    const task = await offer(a);
    await asService("UPDATE public.amora_tasks SET offer_expires_at = now() - interval '1 second' WHERE id = $1", [task.task_id]);
    expect(await start(task.task_id, a.bride)).toMatchObject({ ok: false, code: "offer_expired" });
    const { rows } = await asService<{ status: string }>("SELECT status FROM public.amora_tasks WHERE id = $1", [task.task_id]);
    expect(rows[0].status).toBe("expired");
  });

  it("탈퇴가 진행 중인 커플은 새로 맡기지 못하고 일꾼도 잡지 않는다", async () => {
    const a = await newCouple();
    const queued = await offer(a);
    await start(queued.task_id, a.bride);
    const fresh = await offer(a);
    await asService("INSERT INTO public.account_deletion_jobs(user_id, status) VALUES ($1, 'deleting')", [a.groom]);
    expect(await start(fresh.task_id, a.bride)).toMatchObject({ ok: false, code: "deletion_pending" });
    const claimed = await claimFor(a);
    expect(claimed?.id).not.toBe(queued.task_id);
  });
});

describe("일꾼 선점", () => {
  it("선점하면 찾는 중이 되고, 같은 커플의 다른 일은 앞 일이 끝날 때까지 기다린다", async () => {
    const a = await newCouple();
    const first = await offer(a);
    const second = await offer(a);
    await start(first.task_id, a.bride);
    await start(second.task_id, a.bride);
    const claimed = await claimFor(a);
    expect(claimed).toMatchObject({ id: first.task_id, status: "searching" });
    expect(await claimFor(a)).toBeNull();
  });

  it("선점 토큰이 바뀌면 앞 일꾼의 저장·예약·끝내기를 모두 거절한다", async () => {
    const a = await newCouple();
    const task = await offer(a);
    await start(task.task_id, a.bride);
    const first = await claimFor(a);
    await asService("UPDATE public.amora_tasks SET leased_until = now() - interval '1 second' WHERE id = $1", [first!.id]);
    const second = await claimFor(a);
    expect(second?.id).toBe(first!.id);
    expect(second?.lease_token).not.toBe(first!.lease_token);
    expect(second?.failure_count).toBe(1);

    const saved = await asService<{ ok: boolean }>(
      "SELECT public.save_amora_task_progress($1, $2, 'organizing', '{}'::jsonb, '정리 중이에요', 0, 0, 0, 120) AS ok",
      [first!.id, first!.lease_token],
    );
    expect(saved.rows[0].ok).toBe(false);
    expect(await reserve(first!.id, first!.lease_token, "model_step")).toEqual({ allowed: false, reason: "lease_lost" });
    const finished = await asService<{ ok: boolean }>(
      "SELECT public.finish_amora_task($1, $2, 'done', NULL, '{}'::jsonb, NULL, NULL) AS ok",
      [first!.id, first!.lease_token],
    );
    expect(finished.rows[0].ok).toBe(false);

    const current = await asService<{ ok: boolean }>(
      "SELECT public.save_amora_task_progress($1, $2, 'organizing', '{}'::jsonb, '정리 중이에요', 10, 5, 3, 120) AS ok",
      [second!.id, second!.lease_token],
    );
    expect(current.rows[0].ok).toBe(true);
  });

  it("앞 일꾼이 세 번 사라지면 확인해 주세요(실패)로 넘긴다", async () => {
    const a = await newCouple();
    const task = await offer(a);
    await start(task.task_id, a.bride);
    for (let index = 0; index < 3; index += 1) {
      const claimed = await claimFor(a);
      expect(claimed?.id).toBe(task.task_id);
      await asService("UPDATE public.amora_tasks SET leased_until = now() - interval '1 second' WHERE id = $1", [task.task_id]);
    }
    expect(await claimFor(a)).toBeNull();
    const { rows } = await asService<{ status: string; review_reason: string; error_code: string }>(
      "SELECT status, review_reason, error_code FROM public.amora_tasks WHERE id = $1", [task.task_id],
    );
    expect(rows[0]).toEqual({ status: "needs_review", review_reason: "failed", error_code: "LEASE_EXHAUSTED" });
  });

  it("그만하면 일꾼의 다음 저장이 거절된다", async () => {
    const a = await newCouple();
    const task = await offer(a);
    await start(task.task_id, a.bride);
    const claimed = await claimFor(a);
    const { rows } = await asService<{ result: Record<string, unknown> }>(
      "SELECT public.cancel_amora_task($1, $2) AS result", [task.task_id, a.groom],
    );
    expect(rows[0].result).toMatchObject({ ok: true, code: "cancelled" });
    const saved = await asService<{ ok: boolean }>(
      "SELECT public.save_amora_task_progress($1, $2, 'organizing', '{}'::jsonb, NULL, 0, 0, 0, 120) AS ok",
      [claimed!.id, claimed!.lease_token],
    );
    expect(saved.rows[0].ok).toBe(false);
  });

  it("쉬는 동안은 다시 잡지 않는다", async () => {
    const a = await newCouple();
    const task = await offer(a);
    await start(task.task_id, a.bride);
    const claimed = await claimFor(a);
    const released = await asService<{ ok: boolean }>(
      "SELECT public.release_amora_task($1, $2, 300) AS ok", [claimed!.id, claimed!.lease_token],
    );
    expect(released.rows[0].ok).toBe(true);
    expect(await claimFor(a)).toBeNull();
  });
});

describe("한도", () => {
  async function running(c: Couple) {
    const task = await offer(c);
    await start(task.task_id, c.bride);
    const claimed = await claimFor(c);
    return claimed!;
  }

  it("일 하나의 모델 걸음 상한을 넘기지 않는다", async () => {
    const a = await newCouple();
    const task = await running(a);
    expect(await reserve(task.id, task.lease_token, "model_step", { task: 2 })).toEqual({ allowed: true, reason: null });
    expect(await reserve(task.id, task.lease_token, "model_step", { task: 2 })).toEqual({ allowed: true, reason: null });
    expect(await reserve(task.id, task.lease_token, "model_step", { task: 2 })).toEqual({ allowed: false, reason: "task_step_limit" });
  });

  it("커플의 하루 모델 걸음과 인터넷 찾기는 맡은 일 여러 개를 합쳐 센다", async () => {
    const a = await newCouple();
    const first = await running(a);
    expect(await reserve(first.id, first.lease_token, "model_step", { couple: 2 })).toMatchObject({ allowed: true });
    expect(await reserve(first.id, first.lease_token, "web_search", { couple: 1 })).toMatchObject({ allowed: true });
    await asService(
      "SELECT public.finish_amora_task($1, $2, 'done', NULL, '{}'::jsonb, NULL, NULL)", [first.id, first.lease_token],
    );
    const second = await running(a);
    expect(await reserve(second.id, second.lease_token, "model_step", { couple: 2 })).toMatchObject({ allowed: true });
    expect(await reserve(second.id, second.lease_token, "model_step", { couple: 2 })).toEqual({ allowed: false, reason: "daily_step_limit" });
    expect(await reserve(second.id, second.lease_token, "web_search", { couple: 1 })).toEqual({ allowed: false, reason: "daily_search_limit" });
  });

  it("서비스 전체의 하루 금액 상한을 넘기는 걸음은 예약하지 않는다", async () => {
    const a = await newCouple();
    const task = await running(a);
    const { rows } = await asService<{ reserved: string }>(
      "SELECT COALESCE((SELECT reserved_cost_microusd FROM public.amora_task_global_daily_usage WHERE usage_day = public.amora_task_kst_day(now())), 0)::text AS reserved",
    );
    const reserved = Number(rows[0].reserved);
    expect(await reserve(task.id, task.lease_token, "model_step", { cost: 5_000, globalCost: reserved + 9_999 })).toMatchObject({ allowed: true });
    expect(await reserve(task.id, task.lease_token, "model_step", { cost: 5_000, globalCost: reserved + 9_999 })).toEqual({ allowed: false, reason: "background_budget" });
    const counters = await asService<{ model_steps: number }>("SELECT model_steps FROM public.amora_tasks WHERE id = $1", [task.id]);
    expect(counters.rows[0].model_steps).toBe(1);
  });
});

describe("끝내기와 알림", () => {
  it("끝나면 알림 대기가 되고, 알림은 한 번만 잡힌다", async () => {
    const a = await newCouple();
    const task = await offer(a);
    await start(task.task_id, a.bride);
    const claimed = await claimFor(a);
    const result = { summary: "정리했어요.", columns: ["할 일"], rows: [], sources: [], nextActions: [] };
    const finished = await asService<{ ok: boolean }>(
      "SELECT public.finish_amora_task($1, $2, 'done', NULL, $3::jsonb, NULL, '정리를 마쳤어요') AS ok",
      [claimed!.id, claimed!.lease_token, JSON.stringify(result)],
    );
    expect(finished.rows[0].ok).toBe(true);
    const first = await asService<{ task_id: string }>("SELECT task_id FROM public.claim_amora_task_notifications(50)");
    expect(first.rows.map((row) => row.task_id)).toContain(task.task_id);
    const again = await asService<{ task_id: string }>("SELECT task_id FROM public.claim_amora_task_notifications(50)");
    expect(again.rows.map((row) => row.task_id)).not.toContain(task.task_id);
    const sent = await asService<{ ok: boolean }>("SELECT public.finish_amora_task_notification($1, 'sent', 'sent') AS ok", [task.task_id]);
    expect(sent.rows[0].ok).toBe(true);
    const member = await asMember<{ status: string; steps: { label: string }[] }>(a.groom, "SELECT status, steps FROM public.amora_tasks WHERE id = $1", [task.task_id]);
    expect(member.rows[0].status).toBe("done");
    expect(member.rows[0].steps.map((step) => step.label)).toEqual(["맡았어요", "정리를 마쳤어요"]);
  });

  it("걸음 기록은 서른 개까지만 남긴다", async () => {
    const a = await newCouple();
    const task = await offer(a);
    await start(task.task_id, a.bride);
    const claimed = await claimFor(a);
    for (let index = 0; index < 35; index += 1) {
      await asService(
        "SELECT public.save_amora_task_progress($1, $2, 'searching', '{}'::jsonb, $3, 0, 0, 0, 120)",
        [claimed!.id, claimed!.lease_token, `${index + 1}번째 걸음이에요`],
      );
    }
    const { rows } = await asService<{ steps: { label: string }[] }>("SELECT steps FROM public.amora_tasks WHERE id = $1", [claimed!.id]);
    expect(rows[0].steps).toHaveLength(30);
    expect(rows[0].steps.at(-1)?.label).toBe("35번째 걸음이에요");
  });

  it("이어서 하기는 한도·일시 문제로 멈춘 일만 받는다", async () => {
    const a = await newCouple();
    const limited = await offer(a);
    await start(limited.task_id, a.bride);
    const claimed = await claimFor(a);
    await asService(
      "SELECT public.finish_amora_task($1, $2, 'needs_review', 'daily_step_limit', NULL, NULL, NULL)",
      [claimed!.id, claimed!.lease_token],
    );
    const resumed = await asService<{ result: Record<string, unknown> }>("SELECT public.resume_amora_task($1, $2) AS result", [limited.task_id, a.groom]);
    expect(resumed.rows[0].result).toMatchObject({ ok: true, code: "resumed" });

    const blocked = await offer(a);
    await start(blocked.task_id, a.bride);
    await asService("UPDATE public.amora_tasks SET available_at = now() + interval '1 day' WHERE id = $1", [limited.task_id]);
    const second = await claimFor(a);
    expect(second?.id).toBe(blocked.task_id);
    await asService(
      "SELECT public.finish_amora_task($1, $2, 'needs_review', 'gate_blocked', NULL, NULL, NULL)",
      [second!.id, second!.lease_token],
    );
    const refused = await asService<{ result: Record<string, unknown> }>("SELECT public.resume_amora_task($1, $2) AS result", [blocked.task_id, a.bride]);
    expect(refused.rows[0].result).toMatchObject({ ok: false, code: "not_resumable" });
  });
});
