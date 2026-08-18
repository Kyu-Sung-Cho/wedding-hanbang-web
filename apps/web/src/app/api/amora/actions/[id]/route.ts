import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import {
  isAmoraActionStorageUnavailable,
  updateAmoraActionRecord,
  type AmoraActionUpdate,
} from "@/lib/amora/actionRepository";
import {
  getAmoraActions,
  withUpdatedAmoraAction,
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

async function getCoupleIdForUser(admin: ReturnType<typeof createAdminClient>, userId: string) {
  const { data: profile, error } = await admin
    .from("profiles")
    .select("couple_id")
    .eq("id", userId)
    .single();

  if (error) console.error("amora action profile read failed:", error.message);
  return typeof profile?.couple_id === "string" ? profile.couple_id : null;
}

function cleanHref(raw: unknown): string | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== "string") return "";
  const value = raw.trim().slice(0, 180);
  return value.startsWith("/") && !value.startsWith("//") ? value : "";
}

async function updateLegacyAmoraAction(
  admin: ReturnType<typeof createAdminClient>,
  coupleId: string,
  actionId: string,
  updates: AmoraActionUpdate
): Promise<AmoraActionItem | null> {
  const { data: journey, error } = await admin
    .from("wedding_journeys")
    .select("id, progress")
    .eq("couple_id", coupleId)
    .maybeSingle();

  if (error) throw error;
  if (!journey) return null;

  const currentProgress = (journey.progress ?? {}) as Record<string, unknown>;
  const currentActions = getAmoraActions(currentProgress);
  if (!currentActions.some((action) => action.id === actionId)) return null;

  const nextProgress = withUpdatedAmoraAction(currentProgress, actionId, updates);
  const nextActions = getAmoraActions(nextProgress);
  const updated = nextActions.find((action) => action.id === actionId) ?? null;
  if (!updated) return null;

  // 원자적 병합만 쓴다. 실패했을 때 이 요청이 읽어 둔 오래된 progress 전체로
  // 폴백하면 그 사이 파트너가 저장한 예산·일정·체크리스트를 지운다. 게다가 예전
  // 폴백은 error를 읽지 않아, 아무것도 저장되지 않았는데도 호출부가 성공으로
  // 받았다. 같은 무효식은 lib/ai/tools/progressTools.ts 에서 이미 닫혀 있다.
  const { error: patchError } = await admin.rpc("apply_journey_progress_patch", {
    p_couple_id: coupleId,
    p_patch: { __amora_actions: nextActions },
    p_remove_keys: [],
  });

  if (patchError) throw patchError;

  return updated;
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

    const admin = createAdminClient();
    const coupleId = await getCoupleIdForUser(admin, user.id);
    if (!coupleId) {
      return NextResponse.json({ error: "커플 정보가 없습니다." }, { status: 404 });
    }

    let action: AmoraActionItem | null = null;
    try {
      action = await updateAmoraActionRecord(admin, coupleId, id, updates);
    } catch (error) {
      if (!isAmoraActionStorageUnavailable(error)) throw error;
    }

    if (!action) {
      action = await updateLegacyAmoraAction(admin, coupleId, id, updates);
    }

    if (!action) {
      return NextResponse.json({ error: "아모라 행동을 찾지 못했습니다." }, { status: 404 });
    }

    return NextResponse.json({ action });
  } catch (error) {
    console.error("amora action update failed:", error);
    return NextResponse.json({ error: "아모라 행동을 수정하지 못했습니다." }, { status: 500 });
  }
}
