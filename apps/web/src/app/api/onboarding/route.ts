import { createClientFromRequest } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { upsertMomentEvent } from "@/utils/scheduleEvents";
import { checkRateLimit, rateLimitKey } from "@/utils/rateLimit";
import { isBodyTooLarge, isRecord } from "@/utils/requestValidation";

const MAX_BODY_BYTES = 64 * 1024;
const ONBOARDING_RATE = { maxRequests: 10, windowMs: 10 * 60 * 1000 };

function getJoinCoupleErrorMessage(error: string | undefined) {
  if (error === "Invite unavailable.") {
    return "초대 코드가 올바르지 않거나 이미 사용된 자리입니다.";
  }
  return "커플 연결을 완료할 수 없습니다.";
}

function getAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Supabase server configuration is unavailable");
  }
  return createAdminClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function normalizeDateOnly(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
    ? value
    : null;
}

export async function POST(request: Request) {
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

    const limited = checkRateLimit(rateLimitKey("onboarding", request, user.id), ONBOARDING_RATE);
    if (limited) return limited;

    const body = await request.json().catch(() => null);
    if (!isRecord(body)) {
      return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
    }

    const role = body.role;
    const coupleAction = body.coupleAction;
    if (role !== "bride" && role !== "groom") {
      return NextResponse.json({ error: "유효하지 않은 역할입니다." }, { status: 400 });
    }
    if (coupleAction !== "create" && coupleAction !== "join") {
      return NextResponse.json({ error: "유효하지 않은 커플 연결 방식입니다." }, { status: 400 });
    }

    const weddingDate = normalizeDateOnly(body.weddingDate);
    const sanggyeonryeDate = normalizeDateOnly(body.sanggyeonryeDate);
    const venue = typeof body.venue === "string" && body.venue.trim()
      ? body.venue.trim().slice(0, 100)
      : null;
    const rawBudget = Number(body.totalBudget);
    const totalBudget = Number.isFinite(rawBudget) && rawBudget > 0 && rawBudget <= 10_000_000_000
      ? Math.round(rawBudget)
      : 20_000_000;
    const baseProgress = isRecord(body.progress) ? body.progress : {};
    const journeyProgress = sanggyeonryeDate
      ? upsertMomentEvent(baseProgress, {
          momentType: "sanggyeonrye",
          date: sanggyeonryeDate,
          title: "상견례",
        }).newProgress
      : baseProgress;

    const admin = getAdmin();
    const displayName = typeof user.user_metadata?.name === "string"
      ? user.user_metadata.name.trim().slice(0, 100)
      : user.email?.split("@")[0]?.slice(0, 100) || "사용자";
    const { error: profileError } = await admin.from("profiles").upsert({
      id: user.id,
      name: displayName || "사용자",
      email: user.email ?? null,
      onboarding_completed: false,
      onboarding_step: 0,
    }, {
      onConflict: "id",
      ignoreDuplicates: true,
    });
    if (profileError) {
      console.error("[onboarding] profile ensure failed:", profileError.message);
      return NextResponse.json({ error: "프로필을 준비하지 못했습니다." }, { status: 500 });
    }

    if (coupleAction === "create") {
      const { data, error } = await admin.rpc("create_amora_couple_safely", {
        p_user_id: user.id,
        p_role: role,
        p_wedding_date: weddingDate,
        p_venue: venue ?? "",
        p_total_budget: totalBudget,
        p_progress: journeyProgress,
      });
      if (error) {
        console.error("[onboarding] atomic couple create failed:", error.message);
        const status = error.code === "55000" ? 409 : 500;
        return NextResponse.json({ error: "커플 정보를 생성할 수 없습니다." }, { status });
      }
      const result = data as { success?: boolean; couple_id?: string; invite_code?: string } | null;
      if (!result?.success || !result.couple_id || !result.invite_code) {
        return NextResponse.json({ error: "커플 정보 생성 결과를 확인하지 못했습니다." }, { status: 500 });
      }
      return NextResponse.json({
        success: true,
        coupleId: result.couple_id,
        inviteCode: result.invite_code,
      });
    }

    const inviteCode = typeof body.partnerInviteCode === "string"
      ? body.partnerInviteCode.trim().toUpperCase()
      : "";
    if (!/^WH-[A-Z0-9]{12}$/.test(inviteCode)) {
      return NextResponse.json({ error: "초대 코드 형식이 올바르지 않습니다." }, { status: 400 });
    }

    const { data, error } = await admin.rpc("join_couple_server", {
      p_user_id: user.id,
      p_invite_code: inviteCode,
      p_role: role,
      p_wedding_date: weddingDate,
      p_venue: venue ?? "",
      p_total_budget: totalBudget,
      p_progress: journeyProgress,
      p_sanggyeonrye_date: sanggyeonryeDate,
    });
    if (error) {
      console.error("[onboarding] atomic couple join failed:", error.message);
      return NextResponse.json({ error: "커플 연결에 실패했습니다." }, { status: 500 });
    }
    const result = data as {
      success?: boolean;
      error?: string;
      couple_id?: string;
      invite_code?: string;
    } | null;
    if (!result?.success || !result.couple_id) {
      return NextResponse.json(
        { error: getJoinCoupleErrorMessage(result?.error) },
        { status: 409 }
      );
    }

    return NextResponse.json({
      success: true,
      coupleId: result.couple_id,
      inviteCode: result.invite_code ?? inviteCode,
    });
  } catch (err) {
    console.error("[onboarding] unexpected error:", err);
    return NextResponse.json({ error: "온보딩을 완료하지 못했습니다." }, { status: 500 });
  }
}
