import { NextResponse } from "next/server";
import { log } from "@/utils/log";
import { createClientFromRequest } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  canonicalizeAmoraMemoryText,
  containsPotentialSensitiveData,
  type AmoraMemoryVisibility,
} from "@/lib/ai/amoraMemoryCompiler";
import { isAuxiliaryMemoryRuntimeEnabled } from "@/lib/ai/amoraMemoryQueue";
import {
  EMPTY_PURGE_PREVIEW,
  previewAmoraMemoryPurge,
} from "@/lib/ai/amoraMemoryPurgePreview";
import {
  AMORA_PROFILE_PROJECTION_QUERY_LIMIT,
  normalizeAmoraProfileProjectionRows,
  projectAmoraProfiles,
  toAmoraProfileApiRows,
} from "@/lib/ai/amoraProfileProjection";
import { isBodyTooLarge } from "@/utils/requestValidation";
import { checkRateLimit, rateLimitKey } from "@/utils/rateLimit";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";

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

/**
 * 상대에게 "같이 켜 달라"고 알리는 기능은 **뺐다.** 되살리려면 스키마를 먼저 고쳐야 한다.
 *
 * 2026-08-31 에 `couple_change_notifications` 로 넣었는데 **한 번도 나가지 않았다.**
 * 그 테이블의 `source_message_id` 와 `action_id` 가 **NOT NULL 이고 기본값이 없다**
 * (FK 는 없지만 값은 반드시 있어야 한다). 기억 동의에는 그 둘이 없으므로 INSERT 가
 * 매번 23502 로 죽었고, 나는 그 오류를 `console.warn` 으로 삼켰다. 운영 알림 41건에
 * `amora_memory_consent` 는 0건이었다.
 *
 * 지어낸 uuid 를 넣는 것은 하지 않는다 — 가리키는 것이 없는 id 를 남기는 것이다.
 *
 * 제대로 하려면 그 두 컬럼을 nullable 로 바꾸는 마이그레이션이 필요하다. 그건 별도
 * 결정이다. (2026-09-27 전에는 매니페스트 + 서명 핀 + Vercel 승인 env 까지 함께
 * 갱신해야 했지만, 그 운영 빌드 펜스는 2026-09-27 에 은퇴했다. 남은 규칙은 앱보다
 * DB 를 먼저 내보내는 순서다.)
 *
 * **왜 이 기능이 필요했나** — 공유 기억은 두 사람이 각각 켜야 시작되는데, 한 사람이
 * 켜도 상대는 알 길이 없다. 상대가 우연히 `설정 > 아모라가 기억하는 것` 에 들어가야만
 * "동의 대기 (1/2)" 를 본다. 파운더도 그 화면을 못 찾아 물었다.
 */

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
        .select("visibility, enabled, enabled_at, memory_reset_at, legacy_purged_at, updated_at")
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
      console.error("[amora-memory-api] read failed", {
        settings: settingsResult.error?.code,
        memories: memoriesResult.error?.code,
        consents: consentsResult.error?.code,
        couple: coupleResult.error?.code,
      });
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
        legacyPurgedAt: row?.legacy_purged_at ?? null,
      };
    });
    // 최초 활성화는 기존 자동 기억·대화 요약·프로필을 지운다. 켜기 전에 몇 개가
    // 사라지는지 화면이 말할 수 있어야 한다 — 지금까지는 아무도 말하지 않았다.
    const purgePreviews = await Promise.all(
      settings.map(async (setting) => {
        if (setting.legacyPurgedAt !== null) return EMPTY_PURGE_PREVIEW;
        return previewAmoraMemoryPurge(admin, {
          coupleId: context.coupleId,
          visibility: setting.visibility,
          legacyPurgedAt: setting.legacyPurgedAt,
        });
      }),
    );
    const settingsWithPurge = settings.map((setting, index) => ({
      ...setting,
      pendingPurge: purgePreviews[index] ?? EMPTY_PURGE_PREVIEW,
    }));
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
        profileNodesResult.error.code,
      );
    } else if (profileProjection.rejectedReason) {
      console.warn(
        "[amora-memory-api] profile projection failed closed",
        profileProjection.rejectedReason,
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
        settings: settingsWithPurge,
        memories,
        profiles: projectedProfiles,
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    log.error("api/amora/memory", error);
    console.error("[amora-memory-api] GET failed", error);
    return NextResponse.json({ error: "서버 오류가 발생했어요." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    if (!isTrustedMutationRequest(request)) {
      return NextResponse.json({ error: "잘못된 요청 출처입니다." }, { status: 403 });
    }
    if (isBodyTooLarge(request, MAX_BODY_BYTES)) {
      return NextResponse.json({ error: "요청 데이터가 너무 커요." }, { status: 413 });
    }
    const auth = await getAuthContext(request);
    if (!auth.ok) return auth.response;
    const { supabase, context } = auth;
    const limited = checkRateLimit(rateLimitKey("amora:memory", request, context.userId), {
      maxRequests: 30,
      windowMs: 60 * 1000,
    });
    if (limited) return limited;
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "요청 형식이 올바르지 않아요." }, { status: 400 });
    }
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
      const result = data as Record<string, unknown>;
      return NextResponse.json({ success: true, ...result });
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
    log.error("api/amora/memory", error);
    console.error("[amora-memory-api] PATCH failed", error);
    return NextResponse.json({ error: "기억 설정을 바꾸지 못했어요." }, { status: 500 });
  }
}
