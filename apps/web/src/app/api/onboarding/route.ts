import { createAdminClient } from "@/lib/supabase/admin";
import { NextResponse } from "next/server";

import {
  parseMembershipRpcResponse,
  type CoupleRole,
  type MembershipAction,
} from "@/lib/couples/membershipRpc";
import { createClientFromRequest } from "@/lib/supabase/server";
import { upsertMomentEvent } from "@/utils/scheduleEvents";
import { checkRateLimitPersistent, rateLimitKey } from "@/utils/rateLimit";
import { isRecord, readBoundedJsonValue } from "@/utils/requestValidation";
import { safeErrorDiagnostic } from "@/utils/safeErrorDiagnostic";

const ONBOARDING_JOIN_RATE = { maxRequests: 10, windowMs: 10 * 60 * 1000 };
const DEFAULT_TOTAL_BUDGET = 20_000_000;
const MAX_BODY_BYTES = 32 * 1024;

function getAdmin() {
  return createAdminClient();
}

type AdminClient = ReturnType<typeof getAdmin>;

class OnboardingPersistenceError extends Error {
  constructor(operation: string, cause?: unknown) {
    super(`Onboarding persistence failed: ${operation}`, { cause });
    this.name = "OnboardingPersistenceError";
  }
}

function asProgress(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function storedProgress(value: unknown): Record<string, unknown> {
  if (value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new OnboardingPersistenceError("journey progress validation");
  }

  return value as Record<string, unknown>;
}

function hasSanggyeonryeEvent(progress: Record<string, unknown>): boolean {
  const events = progress.__events;
  if (events === undefined) return false;
  if (!Array.isArray(events)) {
    throw new OnboardingPersistenceError("journey progress validation");
  }

  return events.some(
    (event) =>
      Boolean(event) &&
      typeof event === "object" &&
      (event as { momentType?: unknown }).momentType === "sanggyeonrye",
  );
}

async function ensureProfileExists(
  admin: AdminClient,
  user: { id: string; email?: string | null; user_metadata?: Record<string, unknown> },
) {
  const { data: profile, error: profileReadError } = await admin
    .from("profiles")
    .select("id")
    .eq("id", user.id)
    .maybeSingle();

  if (profileReadError) {
    throw new OnboardingPersistenceError("profile lookup", profileReadError);
  }

  if (profile) return;

  const metadataName =
    typeof user.user_metadata?.name === "string" ? user.user_metadata.name.trim() : "";
  const { error: profileInsertError } = await admin.from("profiles").insert({
    id: user.id,
    name: metadataName || user.email?.split("@")[0] || "사용자",
    email: user.email ?? null,
    onboarding_completed: false,
    onboarding_step: 0,
  });

  if (profileInsertError) {
    throw new OnboardingPersistenceError("profile creation", profileInsertError);
  }
}

async function completeProfile(
  admin: AdminClient,
  userId: string,
  coupleId: string,
) {
  const { data: profile, error } = await admin
    .from("profiles")
    .update({ onboarding_completed: true, onboarding_step: 5 })
    .eq("id", userId)
    .select("id, couple_id")
    .single();

  if (error || !profile || profile.couple_id !== coupleId) {
    throw new OnboardingPersistenceError("profile completion", error);
  }
}

type JourneyInput = {
  coupleId: string;
  weddingDate: string | null;
  venue: string | null;
  totalBudget: number | null;
  progress: Record<string, unknown>;
  sanggyeonryeDate: string | null;
};

async function readJourney(admin: AdminClient, coupleId: string) {
  const { data, error } = await admin
    .from("wedding_journeys")
    .select("id, progress")
    .eq("couple_id", coupleId)
    .maybeSingle();

  if (error) {
    throw new OnboardingPersistenceError("journey lookup", error);
  }

  if (data && typeof data.id !== "string") {
    throw new OnboardingPersistenceError("journey lookup validation");
  }

  return data;
}

async function ensureJourney(admin: AdminClient, input: JourneyInput) {
  let journey = await readJourney(admin, input.coupleId);

  if (!journey) {
    const { data: inserted, error: insertError } = await admin
      .from("wedding_journeys")
      .insert({
        couple_id: input.coupleId,
        wedding_date: input.weddingDate,
        venue: input.venue,
        total_budget: input.totalBudget ?? DEFAULT_TOTAL_BUDGET,
        progress: input.progress,
      })
      .select("id, progress")
      .single();

    if (!insertError && inserted) {
      if (typeof inserted.id !== "string") {
        throw new OnboardingPersistenceError("journey creation verification");
      }
      if (
        input.sanggyeonryeDate &&
        !hasSanggyeonryeEvent(storedProgress(inserted.progress))
      ) {
        throw new OnboardingPersistenceError("journey creation verification");
      }
      return;
    }

    // A lost-response retry or the partner can win the unique(couple_id)
    // insert race. Re-read that canonical row; every other failure is fatal.
    if (insertError?.code !== "23505") {
      throw new OnboardingPersistenceError("journey creation", insertError);
    }

    journey = await readJourney(admin, input.coupleId);
    if (!journey) {
      throw new OnboardingPersistenceError("journey creation race recovery", insertError);
    }
  }

  if (!input.sanggyeonryeDate) return;

  // Compare-and-swap the complete JSON value. `apply_journey_progress_patch`
  // is atomic for top-level keys but replaces the whole __events array, so a
  // simultaneous partner edit to that same array could be lost. The exact old
  // value predicate makes that race a zero-row update; we then re-read and
  // merge again without overwriting either writer.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const rawProgress = journey.progress;
    const existingProgress = storedProgress(rawProgress);
    if (hasSanggyeonryeEvent(existingProgress)) return;

    const { newProgress } = upsertMomentEvent(existingProgress, {
      momentType: "sanggyeonrye",
      date: input.sanggyeonryeDate,
      title: "상견례",
    });

    let update = admin
      .from("wedding_journeys")
      .update({ progress: newProgress })
      .eq("id", journey.id);
    update =
      rawProgress === null
        ? update.is("progress", null)
        : update.filter("progress", "eq", JSON.stringify(rawProgress));

    const { data: updated, error: updateError } = await update
      .select("progress")
      .maybeSingle();
    if (updateError) {
      throw new OnboardingPersistenceError("sanggyeonrye merge", updateError);
    }
    if (updated) {
      if (!hasSanggyeonryeEvent(storedProgress(updated.progress))) {
        throw new OnboardingPersistenceError("sanggyeonrye merge verification");
      }
      return;
    }

    const reloaded = await readJourney(admin, input.coupleId);
    if (!reloaded) {
      throw new OnboardingPersistenceError("journey disappeared during merge");
    }
    journey = reloaded;
  }

  throw new OnboardingPersistenceError("sanggyeonrye merge contention");
}

function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export async function POST(request: Request) {
  try {
    const supabase = await createClientFromRequest(request);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }

    const bodyResult = await readBoundedJsonValue(request, MAX_BODY_BYTES);
    if (!bodyResult.ok) {
      return NextResponse.json(
        { error: bodyResult.reason === "too_large" ? "요청 데이터가 너무 큽니다." : "요청 형식이 올바르지 않습니다." },
        { status: bodyResult.reason === "too_large" ? 413 : 400 },
      );
    }
    if (!isRecord(bodyResult.value)) {
      return NextResponse.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
    }
    const body = bodyResult.value;
    const {
      expectedUserId,
      role: rawRole,
      coupleAction: rawCoupleAction,
      partnerInviteCode,
      weddingDate: rawWeddingDate,
      venue: rawVenue,
      sanggyeonryeDate: rawSanggyeonryeDate,
      totalBudget: rawTotalBudget,
      progress,
    } = body;

    // The browser binds its draft to the identity that created it. If another
    // tab changes accounts before submit, never apply that draft to the new actor.
    // The field stays optional for the existing native client, whose onboarding
    // state is isolated by the OS app sandbox and Bearer-authenticated request.
    if (
      expectedUserId !== undefined &&
      (typeof expectedUserId !== "string" || expectedUserId !== user.id)
    ) {
      return NextResponse.json(
        { error: "로그인 계정이 변경되었습니다. 온보딩을 다시 확인해주세요." },
        { status: 409 },
      );
    }

    if (rawRole !== "bride" && rawRole !== "groom") {
      return NextResponse.json({ error: "유효하지 않은 역할입니다." }, { status: 400 });
    }
    const role: CoupleRole = rawRole;

    if (rawCoupleAction !== "create" && rawCoupleAction !== "join") {
      return NextResponse.json({ error: "유효하지 않은 커플 연결 방식입니다." }, { status: 400 });
    }
    const coupleAction: MembershipAction = rawCoupleAction;

    let normalizedInviteCode: string | null = null;
    if (coupleAction === "join") {
      const limited = await checkRateLimitPersistent(
        rateLimitKey("onboarding_couple_join", request, user.id),
        ONBOARDING_JOIN_RATE,
      );
      if (limited) return limited;

      if (typeof partnerInviteCode !== "string") {
        return NextResponse.json({ error: "파트너 초대 코드를 입력해주세요." }, { status: 400 });
      }

      normalizedInviteCode = partnerInviteCode.trim().toUpperCase();
      if (!/^WH-[A-Z0-9]{6,12}$/.test(normalizedInviteCode)) {
        return NextResponse.json({ error: "초대 코드 형식이 올바르지 않습니다." }, { status: 400 });
      }
    }

    const weddingDate = validDate(rawWeddingDate) ? rawWeddingDate : null;
    const venue =
      typeof rawVenue === "string" && rawVenue.trim()
        ? rawVenue.trim().slice(0, 100)
        : null;
    const budgetNumber = Number(rawTotalBudget);
    const totalBudget =
      Number.isFinite(budgetNumber) && budgetNumber > 0 && budgetNumber <= 10_000_000_000
        ? Math.round(budgetNumber)
        : null;
    const sanggyeonryeDate = validDate(rawSanggyeonryeDate)
      ? rawSanggyeonryeDate
      : null;
    const baseProgress = asProgress(progress);
    const journeyProgress = sanggyeonryeDate
      ? upsertMomentEvent(baseProgress, {
          momentType: "sanggyeonrye",
          date: sanggyeonryeDate,
          title: "상견례",
        }).newProgress
      : baseProgress;

    const admin = getAdmin();
    await ensureProfileExists(admin, user);

    const rpcResponse =
      coupleAction === "create"
        ? await supabase.rpc("create_couple_for_current_user", { p_role: role })
        : await supabase.rpc("join_couple", {
            p_invite_code: normalizedInviteCode,
            p_role: role,
          });

    if (rpcResponse.error) {
      console.error("[onboarding] membership RPC failed", safeErrorDiagnostic(rpcResponse.error));
      return NextResponse.json(
        { error: "커플 연결을 완료하지 못했습니다. 잠시 후 다시 시도해주세요." },
        { status: 500 },
      );
    }

    const membership = parseMembershipRpcResponse(rpcResponse.data, role, coupleAction);
    if (!membership.ok) {
      console.warn(`[onboarding ${coupleAction}] membership rejected`, { code: membership.errorCode });
      return NextResponse.json({ error: membership.message }, { status: membership.status });
    }

    try {
      await completeProfile(admin, user.id, membership.coupleId);
      await ensureJourney(admin, {
        coupleId: membership.coupleId,
        weddingDate,
        venue,
        totalBudget,
        progress: journeyProgress,
        sanggyeonryeDate,
      });
    } catch (error) {
      // The membership RPC is atomic and idempotent, so a retry finishes these
      // post-steps against the same couple instead of creating another couple.
      console.error("[onboarding] completion failed", safeErrorDiagnostic(error));
      return NextResponse.json(
        { error: "온보딩 저장을 완료하지 못했습니다. 잠시 후 다시 시도해주세요." },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      coupleId: membership.coupleId,
      inviteCode: membership.inviteCode,
      created: membership.changed,
      idempotent: membership.idempotent,
    });
  } catch (error) {
    console.error("[onboarding] unexpected error", safeErrorDiagnostic(error));
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다. 잠시 후 다시 시도해주세요." },
      { status: 500 },
    );
  }
}
