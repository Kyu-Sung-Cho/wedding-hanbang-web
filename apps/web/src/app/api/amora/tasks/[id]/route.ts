import { after } from "next/server";
import { AMORA_TASK_ID_PATTERN } from "@hanbang/shared/amora-tasks";
import { defaultAmoraTaskAdapters } from "@/lib/amoraTasks/adapters";
import { AMORA_TASK_LIMITS, isAmoraTasksEnabled } from "@/lib/amoraTasks/config";
import { amoraTaskFailure } from "@/lib/amoraTasks/report";
import { resolveTaskViewer, taskJson, taskOffResponse, toTaskDetail } from "@/lib/amoraTasks/taskApi";
import { AMORA_TASK_KICK_BUDGET, runAmoraTaskWorkerOnce } from "@/lib/amoraTasks/taskRuntime";
import {
  createSupabaseAmoraTaskStore,
  getAmoraTaskForMember,
  isAmoraTaskStorageUnavailable,
} from "@/lib/amoraTasks/taskStore";
import { createAdminClient } from "@/lib/supabase/admin";
import { log } from "@/utils/log";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

type RouteContext = { params: Promise<{ id: string }> };

async function readId(context: RouteContext): Promise<string | null> {
  const { id } = await context.params;
  return typeof id === "string" && AMORA_TASK_ID_PATTERN.test(id) ? id.toLowerCase() : null;
}

/** 맡은 일 하나(결과 화면, 대화 카드의 지금 상태). */
export async function GET(request: Request, context: RouteContext) {
  try {
    const auth = await resolveTaskViewer(request, "amora-tasks:detail", 120);
    if (!auth.ok) return auth.response;
    if (!isAmoraTasksEnabled()) return taskOffResponse("disabled");
    const id = await readId(context);
    if (!id) return taskJson({ error: "맡은 일을 찾지 못했어요.", code: "AMORA_TASK_NOT_FOUND" }, 404);
    const row = await getAmoraTaskForMember(auth.viewer.supabase, id);
    if (!row) return taskJson({ error: "맡은 일을 찾지 못했어요.", code: "AMORA_TASK_NOT_FOUND" }, 404);
    return taskJson({ enabled: true, available: true, task: toTaskDetail(row) });
  } catch (error) {
    if (isAmoraTaskStorageUnavailable(error)) return taskOffResponse("unavailable");
    log.error("[amora-tasks] detail failed", amoraTaskFailure("AMORA_TASK_READ_FAILED", error));
    return taskJson({ error: "맡은 일을 불러오지 못했어요.", code: "AMORA_TASK_READ_FAILED" }, 503);
  }
}

const ACTIONS = new Set(["start", "cancel", "resume"]);

const STATUS_BY_CODE: Record<string, number> = {
  not_found: 404,
  daily_task_limit: 429,
  offer_expired: 409,
  offer_closed: 409,
  not_resumable: 409,
  deletion_pending: 409,
  closed: 409,
};

/**
 * 카드를 누르는 일: 맡기기(start), 그만하기(cancel), 이어서 하기(resume). 쓰기는 service_role 함수가 하고,
 * 그 함수가 누른 사람이 그 커플 회원인지 다시 본다. 맡기기 전에 문지기를 지난다(D-89, 갈래 1 자리).
 * 맡기기가 되면 일꾼을 한 번 바로 돌린다. 응답은 기다리지 않는다(이미 시작한 약속을 after 에 넘긴다).
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    if (!isTrustedMutationRequest(request)) {
      return taskJson({ error: "잘못된 요청 출처입니다.", code: "AMORA_TASK_ORIGIN_REJECTED" }, 403);
    }
    const auth = await resolveTaskViewer(request, "amora-tasks:action", 20);
    if (!auth.ok) return auth.response;
    if (!isAmoraTasksEnabled()) return taskOffResponse("disabled");
    const id = await readId(context);
    if (!id) return taskJson({ error: "맡은 일을 찾지 못했어요.", code: "AMORA_TASK_NOT_FOUND" }, 404);
    let body: unknown;
    try {
      const raw = await request.text();
      if (raw.length > 512) throw new Error("too_large");
      body = JSON.parse(raw);
    } catch {
      return taskJson({ error: "요청 형식이 올바르지 않아요.", code: "AMORA_TASK_BAD_REQUEST" }, 400);
    }
    const action = body && typeof body === "object" ? (body as { action?: unknown }).action : null;
    if (typeof action !== "string" || !ACTIONS.has(action)) {
      return taskJson({ error: "요청 형식이 올바르지 않아요.", code: "AMORA_TASK_BAD_REQUEST" }, 400);
    }
    const { userId } = auth.viewer;
    const admin = createAdminClient();
    const store = createSupabaseAmoraTaskStore(admin);

    if (action === "start") {
      const { data: task, error } = await admin
        .from("amora_tasks")
        .select("title, input, couple_id")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      if (!task || task.couple_id !== auth.viewer.coupleId) {
        return taskJson({ ok: false, code: "not_found" }, 404);
      }
      const inputText = task.input && typeof task.input === "object"
        ? Object.values(task.input as Record<string, unknown>).filter((value): value is string => typeof value === "string")
        : [];
      const gate = await defaultAmoraTaskAdapters().checkGate({
        text: [task.title, ...inputText].join("\n"),
        surface: "amora_task_request",
        userId,
        coupleId: task.couple_id,
      });
      if (!gate.allowed) {
        return taskJson({ ok: false, code: "gate_blocked", reply: gate.reply }, 409);
      }
      const result = await store.start(id, userId, AMORA_TASK_LIMITS.dailyTasks);
      if (result.ok && result.code === "started") {
        const run = runAmoraTaskWorkerOnce(AMORA_TASK_KICK_BUDGET);
        try {
          after(run);
        } catch {
          // 요청 문맥 밖이면 그냥 둔다. 일은 이미 대기열에 있고 크론이 잇는다.
        }
      }
      return taskJson({ ok: result.ok, code: result.code, status: result.status }, result.ok ? 200 : STATUS_BY_CODE[result.code] ?? 409);
    }

    const result = action === "cancel" ? await store.cancel(id, userId) : await store.resume(id, userId);
    if (result.ok && action === "resume") {
      const run = runAmoraTaskWorkerOnce(AMORA_TASK_KICK_BUDGET);
      try {
        after(run);
      } catch {
        // 크론이 잇는다.
      }
    }
    return taskJson({ ok: result.ok, code: result.code, status: result.status }, result.ok ? 200 : STATUS_BY_CODE[result.code] ?? 409);
  } catch (error) {
    if (isAmoraTaskStorageUnavailable(error)) return taskOffResponse("unavailable");
    log.error("[amora-tasks] action failed", amoraTaskFailure("AMORA_TASK_ACTION_FAILED", error));
    return taskJson({ error: "지금은 처리하지 못했어요. 잠시 뒤에 다시 눌러 주세요.", code: "AMORA_TASK_ACTION_FAILED" }, 503);
  }
}
