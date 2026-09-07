import { NextResponse } from "next/server";
import { log } from "@/utils/log";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClientFromRequest } from "@/lib/supabase/server";
import {
  isAmoraActionStorageUnavailable,
  amoraActionUpdatesToPayload,
  getManualAmoraActionFailure,
  mutateOwnAmoraActionRecord,
  type AmoraActionUpdate,
} from "@/lib/amora/actionRepository";
import {
  getAmoraActions,
  type AmoraActionItem,
  type AmoraActionPriority,
  type AmoraActionStatus,
} from "@/lib/amora/actions";
import {
  cleanOptionalEnum,
  cleanOptionalText,
  isBodyTooLarge,
  isRecord,
} from "@/utils/requestValidation";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 24 * 1024;
const SAFE_ACTION_ID_RE = /^[a-zA-Z0-9_-]{4,120}$/;
const STATUS_VALUES = ["open", "done", "dismissed"] as const;
const PRIORITY_VALUES = ["high", "medium", "low"] as const;
const LEGACY_UPDATE_ATTEMPTS = 3;

class LegacyActionConflictError extends Error {}
class LegacyActionUnavailableError extends Error {}

async function getCoupleIdForUser(client: SupabaseClient, userId: string) {
  const { data: profile, error } = await client
    .from("profiles")
    .select("couple_id")
    .eq("id", userId)
    .single();

  if (error) {
    log.error("amora action profile read failed:", error.message);
    throw new LegacyActionUnavailableError();
  }
  return typeof profile?.couple_id === "string" ? profile.couple_id : null;
}

function cleanHref(raw: unknown): string | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== "string") return "";
  const value = raw.trim().slice(0, 180);
  return value.startsWith("/") && !value.startsWith("//") ? value : "";
}

async function updateLegacyAmoraAction(
  client: SupabaseClient,
  coupleId: string,
  actionId: string,
  updates: AmoraActionUpdate
): Promise<AmoraActionItem | null> {
  for (let attempt = 0; attempt < LEGACY_UPDATE_ATTEMPTS; attempt += 1) {
    const { data: journey, error } = await client
      .from("wedding_journeys")
      .select("id, progress, state_revision")
      .eq("couple_id", coupleId)
      .maybeSingle();
    if (error) throw error;
    if (!journey) return null;
    if (
      !isRecord(journey.progress)
      || !Number.isSafeInteger(journey.state_revision)
      || journey.state_revision < 0
      || journey.state_revision >= Number.MAX_SAFE_INTEGER
    ) throw new LegacyActionUnavailableError();

    const currentProgress = journey.progress;
    const rawActions: unknown[] = Array.isArray(currentProgress.__amora_actions) ? currentProgress.__amora_actions : [];
    const index = rawActions.findIndex((item) => isRecord(item) && item.id === actionId && typeof item.title === "string");
    if (index === -1) return null;
    // 읽은 버전을 RPC에 결합한다. DB가 현재 배열에서 이 카드 하나만 바꾸므로
    // 다른 준비 필드와 원래 배열 항목을 클라이언트 값으로 덮어쓰지 않는다.
    const { data: saved, error: saveError } = await client.rpc("update_own_legacy_amora_action", {
      p_couple_id: coupleId, p_journey_id: journey.id, p_action_id: actionId,
      p_expected_revision: journey.state_revision, p_values: amoraActionUpdatesToPayload(updates),
    });
    if (saveError) throw saveError;
    if (!saved) continue;
    if (!isRecord(saved.progress) || saved.state_revision !== journey.state_revision + 1) throw new LegacyActionUnavailableError();
    const result = getAmoraActions(saved.progress).find((item) => item.id === actionId);
    if (!result) throw new LegacyActionUnavailableError();
    return result;
  }
  throw new LegacyActionConflictError();
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

    const body = await request.json();
    if (!isRecord(body)) {
      return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
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
    if (body.href !== undefined) updates.href = cleanHref(body.href);

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "수정할 항목이 없습니다." }, { status: 400 });
    }

    const client = supabase;
    const coupleId = await getCoupleIdForUser(client, user.id);
    if (!coupleId) {
      return NextResponse.json({ error: "커플 정보가 없습니다." }, { status: 404 });
    }

    let action: AmoraActionItem | null = null;
    try {
      action = await mutateOwnAmoraActionRecord(supabase, coupleId, id, "update", updates);
    } catch (error) {
      if (!isAmoraActionStorageUnavailable(error)) throw error;
    }

    if (!action) {
      action = await updateLegacyAmoraAction(client, coupleId, id, updates);
    }

    if (!action) {
      return NextResponse.json({ error: "아모라 행동을 찾지 못했습니다." }, { status: 404 });
    }

    return NextResponse.json({ action });
  } catch (error) {
    const failure = getManualAmoraActionFailure(error);
    if (failure) return NextResponse.json({ error: failure.error, code: failure.code }, { status: failure.status });
    if (error instanceof LegacyActionConflictError) {
      return NextResponse.json({ error: "다른 변경과 겹쳐 저장하지 못했어요. 최신 기록을 불러온 뒤 다시 시도해 주세요.", code: "AMORA_ACTION_CONFLICT" }, { status: 409 });
    }
    if (error instanceof LegacyActionUnavailableError) {
      return NextResponse.json({ error: "준비 기록의 저장 상태를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.", code: "AMORA_ACTION_UNAVAILABLE" }, { status: 503 });
    }
    log.error("api/amora/actions/[id]", error);
    return NextResponse.json({ error: "아모라 행동을 수정하지 못했습니다." }, { status: 500 });
  }
}
