import { NextResponse } from "next/server";

import { hasSignedDemoSessionFromCookieHeader } from "@/lib/demoSession";
import { createClientFromRequest } from "@/lib/supabase/server";
import {
  isBodyTooLarge,
  isRecord,
  isUuid,
  readBoundedUtf8Text,
} from "@/utils/requestValidation";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";
import { log } from "@/utils/log";

const MAX_BODY_BYTES = 4 * 1024;
const MAX_NOTIFICATION_IDS = 50;
const MAX_UNREAD_NOTIFICATIONS = 200;
const MAX_READ_HISTORY = 50;
const MAX_ACTIVE_PLAN_REQUESTS = 20;
const NOTIFICATION_COLUMNS =
  "id, event_kind, action_id, tool_name, title, message, href, read_at, created_at";
const PRIVATE_NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Authorization, Cookie, Origin, Sec-Fetch-Site",
};

function json(body: unknown, init?: { status?: number }) {
  return NextResponse.json(body, {
    ...init,
    headers: PRIVATE_NO_STORE_HEADERS,
  });
}

type ReadSelection =
  | { kind: "all" }
  | { kind: "ids"; ids: string[] };

async function readSelection(
  request: Request,
): Promise<ReadSelection | NextResponse> {
  if (isBodyTooLarge(request, MAX_BODY_BYTES)) {
    return json({ error: "요청 본문이 너무 큽니다." }, { status: 413 });
  }

  const result = await readBoundedUtf8Text(request, MAX_BODY_BYTES);
  if (!result.ok) {
    return json(
      {
        error:
          result.reason === "too_large"
            ? "요청 본문이 너무 큽니다."
            : "요청을 읽을 수 없습니다.",
      },
      { status: result.reason === "too_large" ? 413 : 400 },
    );
  }

  let body: unknown;
  try {
    body = JSON.parse(result.text) as unknown;
  } catch {
    body = null;
  }

  if (!isRecord(body) || Object.keys(body).length !== 1) {
    return json({ error: "읽음 요청 형식이 올바르지 않습니다." }, { status: 400 });
  }

  if (body.all === true) {
    return { kind: "all" };
  }

  if (
    !Array.isArray(body.ids)
    || body.ids.length < 1
    || body.ids.length > MAX_NOTIFICATION_IDS
    || !body.ids.every(isUuid)
  ) {
    return json({ error: "알림 ID가 올바르지 않습니다." }, { status: 400 });
  }

  return { kind: "ids", ids: [...new Set(body.ids)] };
}

export async function GET(request: Request) {
  try {
    const supabase = await createClientFromRequest(request);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      if (hasSignedDemoSessionFromCookieHeader(request.headers.get("cookie"))) {
        return json({ ownerId: null, notifications: [] });
      }
      return json({ error: "로그인이 필요합니다." }, { status: 401 });
    }

    const [unreadResult, historyResult, activePlanResult] = await Promise.all([
      supabase
        .from("couple_change_notifications")
        .select(NOTIFICATION_COLUMNS)
        .eq("recipient_user_id", user.id)
        .is("read_at", null)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(MAX_UNREAD_NOTIFICATIONS),
      supabase
        .from("couple_change_notifications")
        .select(NOTIFICATION_COLUMNS)
        .eq("recipient_user_id", user.id)
        .not("read_at", "is", null)
        .order("read_at", { ascending: false })
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(MAX_READ_HISTORY),
      supabase
        .from("couple_change_notifications")
        .select(NOTIFICATION_COLUMNS)
        .eq("recipient_user_id", user.id)
        .eq("tool_name", "manual_plan_change")
        .in("event_kind", ["approval_pending", "approval_requested"])
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(MAX_ACTIVE_PLAN_REQUESTS),
    ]);

    if (unreadResult.error || historyResult.error || activePlanResult.error) {
      return json(
        { error: "알림 기록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요." },
        { status: 503 },
      );
    }

    const ids = new Set<string>();
    const notifications = [
      ...(unreadResult.data ?? []),
      ...(activePlanResult.data ?? []),
      ...(historyResult.data ?? []),
    ]
      .filter((row) => {
        if (ids.has(row.id)) return false;
        ids.add(row.id);
        return true;
      })
      .sort((left, right) => {
        const createdOrder = right.created_at.localeCompare(left.created_at);
        return createdOrder !== 0
          ? createdOrder
          : right.id.localeCompare(left.id);
      });

    return json({ ownerId: user.id, notifications });
  } catch (err) {
    // 이 503 은 예전에 아무 흔적도 남기지 않았다. 알림 목록이 통째로 비어도
    // 사용자에게만 보이고 우리에게는 안 보인다 — 그래서 여기서 올린다.
    log.error("[notifications GET] 알림 기록 조회 실패", err);
    return json(
      { error: "알림 기록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요." },
      { status: 503 },
    );
  }
}

export async function POST(request: Request) {
  if (!isTrustedMutationRequest(request)) {
    return json({ error: "잘못된 요청 출처입니다." }, { status: 403 });
  }

  try {
    const supabase = await createClientFromRequest(request);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      if (hasSignedDemoSessionFromCookieHeader(request.headers.get("cookie"))) {
        return json({ ok: true });
      }
      return json({ error: "로그인이 필요합니다." }, { status: 401 });
    }

    const selection = await readSelection(request);
    if (selection instanceof NextResponse) return selection;

    const readAt = new Date().toISOString();
    const recipientUpdate = supabase
      .from("couple_change_notifications")
      .update({ read_at: readAt })
      .eq("recipient_user_id", user.id)
      .is("read_at", null);

    const { error } =
      selection.kind === "all"
        ? await recipientUpdate
        : await recipientUpdate.in("id", selection.ids);

    if (error) {
      log.error("[notifications POST] 읽음 상태 저장 실패", error);
      return json(
        { error: "알림 읽음 상태를 저장하지 못했습니다. 다시 시도해 주세요." },
        { status: 503 },
      );
    }

    return json({ ok: true });
  } catch (err) {
    log.error("[notifications POST] 읽음 처리 중 예외", err);
    return json(
      { error: "알림 읽음 상태를 저장하지 못했습니다. 다시 시도해 주세요." },
      { status: 503 },
    );
  }
}
