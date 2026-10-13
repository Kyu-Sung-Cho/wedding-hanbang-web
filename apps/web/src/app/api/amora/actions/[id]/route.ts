import { NextResponse } from "next/server";
import { log } from "@/utils/log";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClientFromRequest } from "@/lib/supabase/server";
import {
  getManualAmoraActionFailure,
  getOwnAmoraActionView,
  patchOwnAmoraActionView,
  type AmoraActionUpdate,
} from "@/lib/amora/actionRepository";
import { isAmoraActionViewVersion, type AmoraActionPriority, type AmoraActionStatus } from "@/lib/amora/actions";
import { parseAmoraActionHref } from "@/lib/amora/actionHref";
import {
  cleanOptionalEnum,
  cleanOptionalText,
  isBodyTooLarge,
  isRecord,
  readBoundedUtf8Text,
} from "@/utils/requestValidation";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 24 * 1024;
const SAFE_ACTION_ID_RE = /^[a-zA-Z0-9_-]{4,120}$/;
const STATUS_VALUES = ["open", "done", "dismissed"] as const;
const PRIORITY_VALUES = ["high", "medium", "low"] as const;
class ActionProfileUnavailableError extends Error {}

async function getCoupleIdForUser(client: SupabaseClient, userId: string) {
  const { data: profile, error } = await client
    .from("profiles")
    .select("couple_id")
    .eq("id", userId)
    .single();

  if (error) {
    log.error("amora action profile read failed:", error.message);
    throw new ActionProfileUnavailableError();
  }
  return typeof profile?.couple_id === "string" ? profile.couple_id : null;
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
  try {
    const { id } = await context.params;
    if (!SAFE_ACTION_ID_RE.test(id)) return reply({ error: "잘못된 행동 ID입니다." }, 400);
    const client = await createClientFromRequest(request);
    const { data: { user } } = await client.auth.getUser();
    if (!user) return reply({ error: "인증이 필요합니다." }, 401);
    const coupleId = await getCoupleIdForUser(client, user.id);
    if (!coupleId) return reply({ error: "커플 정보가 없습니다." }, 404);
    const action = await getOwnAmoraActionView(client, coupleId, id);
    if (!action) return reply({ error: "아모라 행동을 찾지 못했습니다." }, 404);
    return reply({ action });
  } catch (error) {
    const failure = getManualAmoraActionFailure(error);
    if (failure) return reply({ error: failure.error, code: failure.code }, failure.status);
    if (error instanceof ActionProfileUnavailableError) return reply({ error: "준비 기록을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.", code: "AMORA_ACTION_UNAVAILABLE" }, 503);
    log.error("api/amora/actions/[id] read", error);
    return reply({ error: "아모라 행동을 불러오지 못했습니다." }, 500);
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    if (!isTrustedMutationRequest(request)) {
      return NextResponse.json({ error: "잘못된 요청 출처입니다." }, { status: 403 });
    }
    if (isBodyTooLarge(request, MAX_BODY_BYTES)) {
      return NextResponse.json({ error: "요청 데이터가 너무 큽니다." }, { status: 413 });
    }

    const { id } = await context.params;
    if (!SAFE_ACTION_ID_RE.test(id)) {
      return NextResponse.json({ error: "잘못된 행동 ID입니다." }, { status: 400 });
    }

    const supabase = await createClientFromRequest(request);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }

    const boundedBody = await readBoundedUtf8Text(request, MAX_BODY_BYTES);
    if (!boundedBody.ok) {
      return NextResponse.json({ error: boundedBody.reason === "too_large"
        ? "요청 데이터가 너무 큽니다." : "요청 내용을 읽지 못했어요. 내용을 다시 확인해 주세요." },
      { status: boundedBody.reason === "too_large" ? 413 : 400 });
    }
    let body: unknown;
    try {
      body = JSON.parse(boundedBody.text);
    } catch {
      return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
    }
    if (!isRecord(body)) {
      return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
    }
    if (body.expectedOwnerId !== user.id || typeof body.expectedCoupleId !== "string"
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.expectedCoupleId)) {
      return NextResponse.json({ error: "계정 또는 커플 연결이 바뀌었어요. 화면을 새로 열고 변경 내용을 다시 확인해 주세요.", code: "AMORA_ACTION_SCOPE_DENIED" }, { status: 403 });
    }
    if (!isAmoraActionViewVersion(body.expectedUpdatedAt)) {
      return NextResponse.json({ error: "최신 기록을 불러온 뒤 변경 내용을 다시 확인해 주세요.", code: "AMORA_ACTION_VERSION_REQUIRED" }, { status: 428 });
    }
    // 형식 오류를 빈 문자열로 바꾸면 저장된 설명 등이 의도치 않게 지워질 수 있다.
    for (const field of ["description", "due_date", "category_key"] as const) {
      if (body[field] !== undefined && body[field] !== null && typeof body[field] !== "string") {
        return NextResponse.json({ error: "변경 내용을 다시 확인해 주세요.", code: "AMORA_ACTION_INVALID_INPUT" }, { status: 400 });
      }
    }

    const updates: AmoraActionUpdate = {};
    if (body.title !== undefined) {
      const title = cleanOptionalText(body.title, 120);
      if (!title) return NextResponse.json({ error: "제목이 비어 있습니다." }, { status: 400 });
      updates.title = title;
    }
    if (body.description !== undefined) updates.description = cleanOptionalText(body.description, 500) ?? "";
    if (body.due_date !== undefined) updates.dueDate = cleanOptionalText(body.due_date, 40) ?? "";
    if (body.category_key !== undefined) updates.categoryKey = cleanOptionalText(body.category_key, 80) ?? "";
    if (body.priority !== undefined) {
      const priority = cleanOptionalEnum(body.priority, PRIORITY_VALUES) as AmoraActionPriority | null;
      if (!priority) return NextResponse.json({ error: "priority 값이 올바르지 않습니다." }, { status: 400 });
      updates.priority = priority;
    }
    if (body.status !== undefined) {
      const status = cleanOptionalEnum(body.status, STATUS_VALUES) as AmoraActionStatus | null;
      if (!status) return NextResponse.json({ error: "status 값이 올바르지 않습니다." }, { status: 400 });
      updates.status = status;
    }
    if (body.href !== undefined) {
      const link = parseAmoraActionHref(body.href);
      if (!link.ok) return NextResponse.json({ error: "준비 기록의 링크가 올바르지 않습니다.", code: "AMORA_ACTION_INVALID_INPUT" }, { status: 400 });
      updates.href = link.href ?? "";
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "수정할 항목이 없습니다." }, { status: 400 });
    }

    const client = supabase;
    const coupleId = await getCoupleIdForUser(client, user.id);
    if (!coupleId) {
      return NextResponse.json({ error: "커플 정보가 없습니다." }, { status: 404 });
    }
    if (body.expectedCoupleId !== coupleId) {
      return NextResponse.json({ error: "커플 연결이 바뀌었어요. 화면을 새로 열고 변경 내용을 다시 확인해 주세요.", code: "AMORA_ACTION_SCOPE_DENIED" }, { status: 403 });
    }

    // 저장소 선택과 버전 검사는 같은 DB 트랜잭션에서 끝낸다. 서버가 최신 token을
    // 대신 읽어 붙이거나 구 무버전 writer로 우회하지 않는다.
    const action = await patchOwnAmoraActionView(client, coupleId, id, body.expectedUpdatedAt, updates);

    if (!action) {
      return NextResponse.json({ error: "아모라 행동을 찾지 못했습니다." }, { status: 404 });
    }

    return NextResponse.json({ action });
  } catch (error) {
    const failure = getManualAmoraActionFailure(error);
    if (failure) return NextResponse.json({ error: failure.error, code: failure.code }, { status: failure.status });
    if (error instanceof ActionProfileUnavailableError) {
      return NextResponse.json({ error: "준비 기록의 저장 상태를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.", code: "AMORA_ACTION_UNAVAILABLE" }, { status: 503 });
    }
    log.error("api/amora/actions/[id]", error);
    return NextResponse.json({ error: "아모라 행동을 수정하지 못했습니다." }, { status: 500 });
  }
}
