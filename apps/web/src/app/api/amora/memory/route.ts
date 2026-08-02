import { NextResponse } from "next/server";
import { createClientFromRequest } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  canonicalizeAmoraMemoryText,
  containsPotentialSensitiveData,
  type AmoraMemoryVisibility,
} from "@/lib/ai/amoraMemoryCompiler";
import { isAuxiliaryMemoryRuntimeEnabled } from "@/lib/ai/amoraMemoryQueue";
import {
  AMORA_PROFILE_PROJECTION_QUERY_LIMIT,
  normalizeAmoraProfileProjectionRows,
  projectAmoraProfiles,
  toAmoraProfileApiRows,
} from "@/lib/ai/amoraProfileProjection";
import { isBodyTooLarge, readBoundedJsonValue } from "@/utils/requestValidation";
import { checkRateLimitPersistent, rateLimitKey } from "@/utils/rateLimit";
import { safeErrorDiagnostic } from "@/utils/safeErrorDiagnostic";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VISIBILITIES = new Set<AmoraMemoryVisibility>(["shared", "bride_private", "groom_private"]);
const PATCH_KEYS = new Set(["action", "visibility", "enabled", "memoryId", "title", "value"]);
const MAX_BODY_BYTES = 4 * 1024;

type AuthContext = {
  userId: string;
  coupleId: string;
  allowedVisibilities: AmoraMemoryVisibility[];
  memberIds: { bride: string | null; groom: string | null };
};

async function getAuthContext(request: Request): Promise<
  | { ok: true; supabase: Awaited<ReturnType<typeof createClientFromRequest>>; context: AuthContext }
  | { ok: false; response: NextResponse }
> {
  const supabase = await createClientFromRequest(request);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, response: NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 }) };
  }
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("couple_id, role")
    .eq("id", user.id)
    .single();
  if (error || !profile?.couple_id || (profile.role !== "bride" && profile.role !== "groom")) {
    return { ok: false, response: NextResponse.json({ error: "커플 연결이 필요합니다." }, { status: 403 }) };
  }
  const { data: couple, error: coupleError } = await supabase
    .from("couples")
    .select("bride_id, groom_id")
    .eq("id", profile.couple_id)
    .single();
  const actualRole = couple?.bride_id === user.id
    ? "bride"
    : couple?.groom_id === user.id
      ? "groom"
      : null;
  if (coupleError || !actualRole) {
    return { ok: false, response: NextResponse.json({ error: "커플 연결을 확인하지 못했어요." }, { status: 403 }) };
  }
  const privateVisibility = `${actualRole}_private` as AmoraMemoryVisibility;
  return {
    ok: true,
    supabase,
    context: {
      userId: user.id,
      coupleId: profile.couple_id,
      allowedVisibilities: ["shared", privateVisibility],
      memberIds: {
        bride: couple.bride_id ?? null,
        groom: couple.groom_id ?? null,
      },
    },
  };
}

function isAutomaticMemory(row: { memory_key?: unknown; metadata?: unknown }): boolean {
  if (typeof row.memory_key === "string" && row.memory_key.length > 0) return true;
  if (!row.metadata || typeof row.metadata !== "object" || Array.isArray(row.metadata)) return false;
  return typeof (row.metadata as { extracted_by?: unknown }).extracted_by === "string";
}

export async function GET(request: Request) {
  try {
    const auth = await getAuthContext(request);
    if (!auth.ok) return auth.response;
    const { supabase, context } = auth;
    const admin = createAdminClient();
    const [settingsResult, memoriesResult, profileNodesResult, consentsResult, coupleResult] = await Promise.all([
      supabase
        .from("amora_memory_settings")
        .select("visibility, enabled, enabled_at, memory_reset_at, updated_at")
        .eq("couple_id", context.coupleId)
        .in("visibility", context.allowedVisibilities),
      supabase
        .from("decision_nodes")
        .select("id, visibility, memory_key, category, decision_type, title, chosen_value, reasoning, confidence, source_message_id, user_confirmed_at, metadata, created_at, updated_at")
        .eq("couple_id", context.coupleId)
        .in("visibility", context.allowedVisibilities)
        .is("superseded_at", null)
        .order("updated_at", { ascending: false })
        .limit(200),
      supabase
        .from("decision_nodes")
        .select("id, couple_id, visibility, memory_key, title, chosen_value, reasoning, confidence, source_message_id, source_actor_role, superseded_at, metadata, created_at, updated_at, source_message:chat_messages!decision_nodes_source_message_id_fkey(id, couple_id, visibility, sender_id, sender_type, role, metadata)")
        .eq("couple_id", context.coupleId)
        .in("visibility", context.allowedVisibilities)
        .not("memory_key", "is", null)
        .is("superseded_at", null)
        .order("updated_at", { ascending: false })
        .limit(AMORA_PROFILE_PROJECTION_QUERY_LIMIT),
      admin
        .from("amora_memory_consents")
        .select("visibility, user_id")
        .eq("couple_id", context.coupleId)
        .in("visibility", context.allowedVisibilities),
      admin
        .from("couples")
        .select("bride_id, groom_id")
        .eq("id", context.coupleId)
        .single(),
    ]);
    if (settingsResult.error || memoriesResult.error || consentsResult.error || coupleResult.error) {
      console.error(
        "[amora-memory-api] read failed",
        safeErrorDiagnostic(
          settingsResult.error
          ?? memoriesResult.error
          ?? consentsResult.error
          ?? coupleResult.error,
        ),
      );
      return NextResponse.json({ error: "기억을 불러오지 못했어요." }, { status: 503 });
    }
    const members = [...new Set(
      [coupleResult.data?.bride_id, coupleResult.data?.groom_id]
        .filter((value): value is string => typeof value === "string"),
    )];
    const settings = context.allowedVisibilities.map((visibility) => {
      const row = settingsResult.data?.find((item) => item.visibility === visibility);
      const consentedIds = new Set(
        (consentsResult.data ?? [])
          .filter((item) => item.visibility === visibility)
          .map((item) => item.user_id),
      );
      const requiredCount = visibility === "shared" ? 2 : 1;
      const consentedCount = visibility === "shared"
        ? members.filter((id) => consentedIds.has(id)).length
        : Number(consentedIds.has(context.userId));
      const effectiveEnabled = row?.enabled === true
        && consentedCount === requiredCount
        && (visibility !== "shared" || members.length === 2);
      return {
        visibility,
        enabled: effectiveEnabled,
        consentedByMe: consentedIds.has(context.userId),
        consentedCount,
        requiredCount,
        enabledAt: row?.enabled_at ?? null,
        memoryResetAt: row?.memory_reset_at ?? null,
      };
    });
    const enabledProfileVisibilities = settings
      .filter((setting) => setting.enabled)
      .map((setting) => setting.visibility);
    const profileProjection = profileNodesResult.error
      ? { profiles: [], rejectedReason: null }
      : projectAmoraProfiles(
          normalizeAmoraProfileProjectionRows(profileNodesResult.data ?? []),
          {
            coupleId: context.coupleId,
            memberIds: context.memberIds,
            allowedVisibilities: enabledProfileVisibilities,
          },
        );
    if (profileNodesResult.error) {
      console.warn(
        "[amora-memory-api] profile projection source query failed",
        safeErrorDiagnostic(profileNodesResult.error),
      );
    } else if (profileProjection.rejectedReason) {
      console.warn(
        "[amora-memory-api] profile projection failed closed",
        { code: profileProjection.rejectedReason },
      );
    }
    const projectedProfiles = toAmoraProfileApiRows(profileProjection.profiles);
    const memories = (memoriesResult.data ?? [])
      .filter(isAutomaticMemory)
      .map((row) => ({
        id: row.id,
        visibility: row.visibility,
        memoryKey: row.memory_key,
        category: row.category,
        decisionType: row.decision_type,
        kind: (row.metadata as { memory_kind?: string } | null)?.memory_kind ?? "legacy",
        title: row.title,
        value: (row.chosen_value as { value?: unknown } | null)?.value ?? null,
        reasoning: row.reasoning,
        confidence: row.confidence,
        userConfirmedAt: row.user_confirmed_at,
        userCorrected: (row.metadata as { user_corrected?: unknown } | null)?.user_corrected === true,
        sourceMessageId: row.source_message_id,
        updatedAt: row.updated_at,
      }));
    return NextResponse.json(
      {
        runtimeEnabled: isAuxiliaryMemoryRuntimeEnabled(),
        settings,
        memories,
        profiles: projectedProfiles,
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    console.error("[amora-memory-api] GET failed", safeErrorDiagnostic(error));
    return NextResponse.json({ error: "서버 오류가 발생했어요." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    if (isBodyTooLarge(request, MAX_BODY_BYTES)) {
      return NextResponse.json({ error: "요청 데이터가 너무 커요." }, { status: 413 });
    }
    const auth = await getAuthContext(request);
    if (!auth.ok) return auth.response;
    const { supabase, context } = auth;
    const limited = await checkRateLimitPersistent(rateLimitKey("amora:memory", request, context.userId), {
      maxRequests: 30,
      windowMs: 60 * 1000,
    });
    if (limited) return limited;
    const bodyResult = await readBoundedJsonValue(request, MAX_BODY_BYTES);
    if (!bodyResult.ok) {
      if (bodyResult.reason === "too_large") {
        return NextResponse.json({ error: "요청 데이터가 너무 커요." }, { status: 413 });
      }
      return NextResponse.json({ error: "요청 형식이 올바르지 않아요." }, { status: 400 });
    }
    const body = bodyResult.value;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "요청 형식이 올바르지 않아요." }, { status: 400 });
    }
    const record = body as Record<string, unknown>;
    if (Object.keys(record).some((key) => !PATCH_KEYS.has(key))) {
      return NextResponse.json({ error: "허용되지 않은 항목이 있어요." }, { status: 400 });
    }
    const visibility = record.visibility;
    if (typeof visibility !== "string" || !VISIBILITIES.has(visibility as AmoraMemoryVisibility)) {
      return NextResponse.json({ error: "기억 범위가 올바르지 않아요." }, { status: 400 });
    }
    if (!context.allowedVisibilities.includes(visibility as AmoraMemoryVisibility)) {
      return NextResponse.json({ error: "이 기억 범위에 접근할 수 없어요." }, { status: 403 });
    }
    const admin = createAdminClient();

    if (record.action === "toggle") {
      if (typeof record.enabled !== "boolean") {
        return NextResponse.json({ error: "설정 값이 올바르지 않아요." }, { status: 400 });
      }
      if (record.enabled && !isAuxiliaryMemoryRuntimeEnabled()) {
        return NextResponse.json(
          { error: "기억 기능을 안전하게 준비하고 있어요. 잠시 후 다시 확인해주세요." },
          { status: 503 },
        );
      }
      const { data, error } = await admin.rpc("set_amora_memory_consent", {
        p_couple_id: context.coupleId,
        p_visibility: visibility,
        p_user_id: context.userId,
        p_consented: record.enabled,
      });
      if (error) throw new Error("MEMORY_SETTING_WRITE_FAILED");
      if (!data || typeof data !== "object" || Array.isArray(data)) {
        throw new Error("MEMORY_SETTING_RESULT_INVALID");
      }
      return NextResponse.json({ success: true, ...(data as Record<string, unknown>) });
    }

    if (record.action === "update_memory" || record.action === "delete_memory") {
      if (typeof record.memoryId !== "string" || !UUID_PATTERN.test(record.memoryId)) {
        return NextResponse.json({ error: "기억 식별자가 올바르지 않아요." }, { status: 400 });
      }
      const { data: memory, error: lookupError } = await supabase
        .from("decision_nodes")
        .select("id, visibility, memory_key, category, title, metadata")
        .eq("id", record.memoryId)
        .eq("couple_id", context.coupleId)
        .eq("visibility", visibility)
        .is("superseded_at", null)
        .maybeSingle();
      if (lookupError || !memory || !isAutomaticMemory(memory)) {
        return NextResponse.json({ error: "기억을 찾을 수 없어요." }, { status: 404 });
      }
      if (record.action === "delete_memory") {
        const { data, error } = await admin.rpc("delete_amora_memory_node", {
          p_couple_id: context.coupleId,
          p_visibility: visibility,
          p_memory_id: memory.id,
          p_user_id: context.userId,
        });
        if (error || data !== true) throw new Error("MEMORY_DELETE_FAILED");
        return NextResponse.json({ success: true });
      }
      if (typeof record.value !== "string") {
        return NextResponse.json({ error: "기억 내용은 1~160자로 입력해주세요." }, { status: 400 });
      }
      const nextValue = canonicalizeAmoraMemoryText(record.value);
      if (nextValue.length === 0 || nextValue.length > 160) {
        return NextResponse.json({ error: "기억 내용은 정리 후 1~160자로 입력해주세요." }, { status: 400 });
      }
      if (record.title !== undefined && typeof record.title !== "string") {
        return NextResponse.json({ error: "기억 제목은 1~60자로 입력해주세요." }, { status: 400 });
      }
      const nextTitle = typeof record.title === "string"
        ? canonicalizeAmoraMemoryText(record.title)
        : typeof memory.title === "string" && memory.title.trim().length > 0
          ? canonicalizeAmoraMemoryText(memory.title)
          : "기억";
      if (nextTitle.length === 0 || nextTitle.length > 60) {
        return NextResponse.json({ error: "기억 제목은 정리 후 1~60자로 입력해주세요." }, { status: 400 });
      }
      const sensitiveCandidate = [
        typeof memory.memory_key === "string" ? memory.memory_key : "",
        typeof memory.category === "string" ? memory.category : "",
        nextTitle,
        nextValue,
      ].join("\n");
      if (containsPotentialSensitiveData(sensitiveCandidate)) {
        return NextResponse.json(
          { error: "연락처·계좌·정확한 주소·건강정보 같은 민감정보는 기억에 저장할 수 없어요." },
          { status: 400 },
        );
      }
      const { data, error } = await admin.rpc("update_amora_memory_node", {
        p_couple_id: context.coupleId,
        p_visibility: visibility,
        p_memory_id: memory.id,
        p_user_id: context.userId,
        p_title: nextTitle,
        p_value: nextValue,
      });
      if (error || typeof data !== "string" || !UUID_PATTERN.test(data)) {
        throw new Error("MEMORY_UPDATE_FAILED");
      }
      return NextResponse.json({ success: true });
    }

    if (record.action === "clear_scope") {
      const { data, error } = await admin.rpc("clear_amora_memory_scope", {
        p_couple_id: context.coupleId,
        p_visibility: visibility,
        p_user_id: context.userId,
      });
      if (
        error
        || !data
        || typeof data !== "object"
        || Array.isArray(data)
        || (data as { cleared?: unknown }).cleared !== true
      ) {
        throw new Error("MEMORY_CLEAR_FAILED");
      }
      return NextResponse.json({ success: true, enabled: false });
    }

    return NextResponse.json({ error: "지원하지 않는 작업이에요." }, { status: 400 });
  } catch (error) {
    console.error("[amora-memory-api] PATCH failed", safeErrorDiagnostic(error));
    return NextResponse.json({ error: "기억 설정을 바꾸지 못했어요." }, { status: 500 });
  }
}
