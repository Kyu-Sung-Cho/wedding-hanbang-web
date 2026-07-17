import { createAdminClient as createPinnedAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import {
  cleanIntegerInRange,
  cleanOptionalIsoDate,
  cleanOptionalText,
  isBodyTooLarge,
  isRecord,
  sanitizeJsonObject,
} from "@/utils/requestValidation";

const MAX_BODY_BYTES = 128 * 1024;
const PROGRESS_REMOVE_KEY_RE = /^[a-zA-Z0-9_.:-]{1,80}$/;

function getAdminClient() {
  return createPinnedAdminClient();
}

export async function PATCH(request: Request) {
  try {
    if (isBodyTooLarge(request, MAX_BODY_BYTES)) {
      return NextResponse.json({ error: "요청 데이터가 너무 큽니다." }, { status: 413 });
    }

    const supabase = await createClientFromRequest(request);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }

    const admin = getAdminClient();
    const { data: profile } = await admin
      .from("profiles")
      .select("couple_id")
      .eq("id", user.id)
      .single();

    if (!profile?.couple_id) {
      return NextResponse.json({ error: "커플 정보가 없습니다." }, { status: 404 });
    }

    const body = await request.json();
    if (!isRecord(body)) {
      return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
    }

    const updates: Record<string, unknown> = {};
    const hasProgressPatch =
      body.progress_patch !== undefined || body.progress_remove_keys !== undefined;

    if (body.progress !== undefined && hasProgressPatch) {
      return NextResponse.json(
        { error: "progress와 progress_patch는 동시에 보낼 수 없습니다." },
        { status: 400 }
      );
    }

    if (body.wedding_date !== undefined) {
      const weddingDate = cleanOptionalIsoDate(body.wedding_date);
      if (weddingDate === undefined) {
        return NextResponse.json(
          { error: "결혼 예정일 형식이 올바르지 않습니다." },
          { status: 400 }
        );
      }
      updates.wedding_date = weddingDate;
    }

    if (body.total_budget !== undefined) {
      const totalBudget = cleanIntegerInRange(body.total_budget, 0, 1_000_000_000);
      if (totalBudget === undefined) {
        return NextResponse.json(
          { error: "예산은 0원 이상 10억원 이하의 정수여야 합니다." },
          { status: 400 }
        );
      }
      updates.total_budget = totalBudget;
    }

    if (body.venue !== undefined) {
      updates.venue = cleanOptionalText(body.venue, 120);
    }

    if (body.progress !== undefined) {
      const progress = sanitizeJsonObject(body.progress, {
        maxDepth: 8,
        maxArrayLength: 300,
        maxObjectKeys: 300,
        maxStringLength: 1500,
      });
      if (!progress) {
        return NextResponse.json(
          { error: "진행 데이터 형식이 올바르지 않습니다." },
          { status: 400 }
        );
      }
      updates.progress = progress;
    }

    let patchedProgress: unknown = null;
    if (hasProgressPatch) {
      const progressPatch = body.progress_patch === undefined
        ? {}
        : sanitizeJsonObject(body.progress_patch, {
            maxDepth: 8,
            maxArrayLength: 300,
            maxObjectKeys: 300,
            maxStringLength: 1500,
          });
      if (!progressPatch) {
        return NextResponse.json(
          { error: "진행 패치 데이터 형식이 올바르지 않습니다." },
          { status: 400 }
        );
      }

      const removeKeys = Array.isArray(body.progress_remove_keys)
        ? body.progress_remove_keys
            .filter((key): key is string => typeof key === "string" && PROGRESS_REMOVE_KEY_RE.test(key))
            .slice(0, 50)
        : [];

      const { data: mergedProgress, error: patchError } = await admin.rpc(
        "apply_journey_progress_patch",
        {
          p_couple_id: profile.couple_id,
          p_patch: progressPatch,
          p_remove_keys: removeKeys,
        }
      );

      if (patchError) {
        console.error("journey progress patch failed:", patchError);
        return NextResponse.json({ error: "진행 데이터 업데이트에 실패했습니다." }, { status: 500 });
      }

      patchedProgress = mergedProgress;
    }

    if (Object.keys(updates).length === 0 && !hasProgressPatch) {
      return NextResponse.json({ error: "수정할 항목이 없습니다." }, { status: 400 });
    }

    const journeyQuery = admin.from("wedding_journeys").select().eq("couple_id", profile.couple_id).single();
    const { data: journey, error } = Object.keys(updates).length > 0
      ? await admin
          .from("wedding_journeys")
          .update(updates)
          .eq("couple_id", profile.couple_id)
          .select()
          .single()
      : await journeyQuery;

    if (error) {
      console.error("journey update failed:", error);
      return NextResponse.json({ error: "업데이트에 실패했습니다." }, { status: 500 });
    }

    return NextResponse.json({
      journey: patchedProgress && journey
        ? { ...journey, progress: patchedProgress }
        : journey,
    });
  } catch (err) {
    console.error("Journey API error:", err);
    return NextResponse.json({ error: "서버 오류" }, { status: 500 });
  }
}
