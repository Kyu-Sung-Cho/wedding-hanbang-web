import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";
import { verifyMutationActorFence } from "@/lib/auth/mutationActorFence";

const INVITE_CODE_PATTERN = /^WH-[A-Z0-9]{6,12}$/;

type CoupleRecord = {
  invite_code: string | null;
  bride_id: string | null;
  groom_id: string | null;
  membership_sealed_at: string | null;
  /** 20260812030000 이 붙인 7일 창. 없는 DB 도 있으므로 선택 필드다. */
  invite_code_expires_at?: string | null;
};

// 20260812030000 이 초대 코드에 7일 만료를 붙였다. 그 컬럼이 아직 없는 DB 에서
// 42703 하나로 커플 카드 전체를 죽이지 않는다 — 앱이 마이그레이션보다 먼저
// 나가는 일은 이 저장소에서 실제로 있었다.
const COUPLE_COLUMNS_WITH_EXPIRY =
  "invite_code, bride_id, groom_id, membership_sealed_at, invite_code_expires_at";
const COUPLE_COLUMNS_LEGACY =
  "invite_code, bride_id, groom_id, membership_sealed_at";
const UNDEFINED_COLUMN = "42703";

/**
 * 만료된 코드는 join 쪽에서 조용히 거절된다(20260812030000 의
 * join_couple_invite_core 가 invite_code_expires_at > now 를 요구한다).
 * 화면이 그걸 모르면 사용자는 멀쩡해 보이는 코드를 계속 공유하고 상대는 계속
 * 실패한다 — 파트너 연결은 이 제품에서 가장 크게 새는 구간이다.
 */
function isInviteCodeExpired(couple: CoupleRecord): boolean {
  const expiresAt = couple.invite_code_expires_at;
  if (couple.invite_code === null || !expiresAt) return false;
  const parsed = Date.parse(expiresAt);
  if (Number.isNaN(parsed)) return false;
  return parsed <= Date.now();
}

class CoupleCodeError extends Error {
  constructor(
    readonly status: number,
    readonly publicMessage: string,
    readonly diagnosticCode: string,
  ) {
    super(diagnosticCode);
  }
}

function getAdmin() {
  try {
    return createAdminClient();
  } catch {
    throw new CoupleCodeError(
      500,
      "커플 코드를 확인할 수 없어요. 잠시 후 다시 시도해 주세요.",
      "ADMIN_DESTINATION_INVALID",
    );
  }
}

function isNotFound(error: { code?: string } | null) {
  return error?.code === "PGRST116";
}

function validateInviteCode(value: unknown): value is string {
  return typeof value === "string" && INVITE_CODE_PATTERN.test(value);
}

function isMember(couple: CoupleRecord, userId: string) {
  return couple.bride_id === userId || couple.groom_id === userId;
}

function isFullyLinked(couple: CoupleRecord) {
  return Boolean(couple.bride_id && couple.groom_id);
}

async function loadCoupleContext(
  admin: ReturnType<typeof getAdmin>,
  userId: string,
) {
  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("couple_id")
    .eq("id", userId)
    .single();

  if (profileError && !isNotFound(profileError)) {
    throw new CoupleCodeError(
      500,
      "커플 정보를 확인할 수 없어요. 잠시 후 다시 시도해 주세요.",
      `PROFILE_LOOKUP_${profileError.code ?? "FAILED"}`,
    );
  }
  if (!profile?.couple_id) {
    throw new CoupleCodeError(404, "연결된 커플 정보가 없어요.", "PROFILE_COUPLE_MISSING");
  }

  const couple = await loadCoupleById(admin, profile.couple_id, userId);
  return { coupleId: profile.couple_id as string, couple };
}

async function loadCoupleById(
  admin: ReturnType<typeof getAdmin>,
  coupleId: string,
  userId: string,
) {
  let { data, error } = await admin
    .from("couples")
    .select(COUPLE_COLUMNS_WITH_EXPIRY)
    .eq("id", coupleId)
    .single();

  if (error?.code === UNDEFINED_COLUMN) {
    ({ data, error } = await admin
      .from("couples")
      .select(COUPLE_COLUMNS_LEGACY)
      .eq("id", coupleId)
      .single());
  }

  if (error && !isNotFound(error)) {
    throw new CoupleCodeError(
      500,
      "커플 정보를 확인할 수 없어요. 잠시 후 다시 시도해 주세요.",
      `COUPLE_LOOKUP_${error.code ?? "FAILED"}`,
    );
  }
  if (!data) {
    throw new CoupleCodeError(404, "연결된 커플 정보가 없어요.", "COUPLE_MISSING");
  }

  const couple = data as CoupleRecord;
  if (!isMember(couple, userId)) {
    throw new CoupleCodeError(
      409,
      "커플 연결 상태가 일치하지 않아요. 다시 로그인해 주세요.",
      "COUPLE_MEMBERSHIP_INCONSISTENT",
    );
  }
  return couple;
}

async function generateInviteCode(admin: ReturnType<typeof getAdmin>) {
  const { data, error } = await admin.rpc("generate_invite_code");
  if (error) {
    throw new CoupleCodeError(
      500,
      "초대 코드를 만들지 못했어요. 잠시 후 다시 시도해 주세요.",
      `INVITE_GENERATION_${error.code ?? "FAILED"}`,
    );
  }
  if (!validateInviteCode(data)) {
    throw new CoupleCodeError(
      500,
      "초대 코드를 만들지 못했어요. 잠시 후 다시 시도해 주세요.",
      "INVITE_GENERATION_INVALID_RESULT",
    );
  }
  return data;
}

async function compareAndSwapInviteCode(
  admin: ReturnType<typeof getAdmin>,
  coupleId: string,
  expectedCode: string | null,
  nextCode: string,
) {
  let query = admin
    .from("couples")
    .update({ invite_code: nextCode, updated_at: new Date().toISOString() })
    .eq("id", coupleId)
    .is("membership_sealed_at", null);

  query = expectedCode === null
    ? query.is("invite_code", null)
    : query.eq("invite_code", expectedCode);

  let { data, error } = await query
    .select(COUPLE_COLUMNS_WITH_EXPIRY)
    .maybeSingle();
  if (error?.code === UNDEFINED_COLUMN) {
    ({ data, error } = await query
      .select(COUPLE_COLUMNS_LEGACY)
      .maybeSingle());
  }
  if (error) {
    throw new CoupleCodeError(
      500,
      "초대 코드를 저장하지 못했어요. 잠시 후 다시 시도해 주세요.",
      `INVITE_UPDATE_${error.code ?? "FAILED"}`,
    );
  }
  return (data as CoupleRecord | null) ?? null;
}

function activeCodeResponse(couple: CoupleRecord) {
  if (couple.membership_sealed_at) {
    return {
      inviteCode: null,
      isFullyLinked: isFullyLinked(couple),
      isMembershipSealed: true,
    };
  }
  if (!validateInviteCode(couple.invite_code)) {
    throw new CoupleCodeError(
      500,
      "초대 코드를 확인할 수 없어요. 잠시 후 다시 시도해 주세요.",
      "STORED_INVITE_CODE_INVALID",
    );
  }
  return {
    inviteCode: couple.invite_code,
    isFullyLinked: isFullyLinked(couple),
    isMembershipSealed: false,
  };
}

function handleError(error: unknown, operation: "GET" | "POST") {
  if (error instanceof CoupleCodeError) {
    console.warn("[couple/code] request rejected", {
      operation,
      code: error.diagnosticCode,
    });
    return NextResponse.json({ error: error.publicMessage }, { status: error.status });
  }
  console.error("[couple/code] unexpected failure", { operation });
  return NextResponse.json(
    { error: "커플 코드를 처리할 수 없어요. 잠시 후 다시 시도해 주세요." },
    { status: 500 },
  );
}

// Return an invite only while the couple is still in its first, unsealed epoch.
export async function GET(request: Request) {
  try {
    const supabase = await createClientFromRequest(request);
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError) {
      throw new CoupleCodeError(401, "로그인이 필요해요.", "AUTH_LOOKUP_FAILED");
    }
    if (!authData.user) {
      return NextResponse.json({ error: "로그인이 필요해요." }, { status: 401 });
    }

    const actorFence = verifyMutationActorFence(request.headers, authData.user.id);
    if (!actorFence.ok) {
      return NextResponse.json(
        { error: actorFence.message, code: actorFence.code },
        { status: actorFence.status },
      );
    }

    const admin = getAdmin();
    const { coupleId, couple } = await loadCoupleContext(admin, authData.user.id);
    if (couple.membership_sealed_at) {
      return NextResponse.json(activeCodeResponse(couple));
    }
    // 저장된 코드가 형식부터 어긋나면 조용히 갈아끼우지 말고 멈춘다 — 회전은
    // 만료를 위한 것이지 손상된 데이터를 덮는 수단이 아니다.
    if (couple.invite_code !== null && !validateInviteCode(couple.invite_code)) {
      throw new CoupleCodeError(
        500,
        "저장된 초대 코드를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.",
        "STORED_INVITE_CODE_INVALID",
      );
    }
    // 만료됐으면 조용히 새 코드로 갈아끼운다. 사용자가 "왜 안 되지"를 겪기 전에.
    // 만료 자체는 20260812030000 의 의도이므로 되돌리지 않고, 화면이 그 사실을
    // 반영하게 한다.
    const expired = isInviteCodeExpired(couple);
    if (couple.invite_code !== null && !expired) {
      return NextResponse.json(activeCodeResponse(couple));
    }

    const generatedCode = await generateInviteCode(admin);
    const updated = await compareAndSwapInviteCode(
      admin,
      coupleId,
      // 만료된 코드는 NULL 이 아니다. 기대값을 틀리면 CAS 가 아무것도 안 바꾼다.
      expired ? couple.invite_code : null,
      generatedCode,
    );
    if (updated) {
      if (!isMember(updated, authData.user.id)) {
        throw new CoupleCodeError(409, "커플 연결 상태가 변경됐어요.", "UPDATE_MEMBERSHIP_CHANGED");
      }
      return NextResponse.json(activeCodeResponse(updated));
    }

    // Another join or code request won the compare-and-swap. Re-read the
    // canonical row; a newly sealed row must never disclose its retained code.
    const canonical = await loadCoupleById(admin, coupleId, authData.user.id);
    return NextResponse.json(activeCodeResponse(canonical));
  } catch (error) {
    return handleError(error, "GET");
  }
}

// Rotate the invite only before the first two-member roster has been sealed.
export async function POST(request: Request) {
  try {
    if (!isTrustedMutationRequest(request)) {
      return NextResponse.json({ error: "잘못된 요청 출처입니다." }, { status: 403 });
    }
    const supabase = await createClientFromRequest(request);
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError) {
      throw new CoupleCodeError(401, "로그인이 필요해요.", "AUTH_LOOKUP_FAILED");
    }
    if (!authData.user) {
      return NextResponse.json({ error: "로그인이 필요해요." }, { status: 401 });
    }

    const actorFence = verifyMutationActorFence(request.headers, authData.user.id);
    if (!actorFence.ok) {
      return NextResponse.json(
        { error: actorFence.message, code: actorFence.code },
        { status: actorFence.status },
      );
    }

    const admin = getAdmin();
    const { coupleId, couple } = await loadCoupleContext(admin, authData.user.id);
    if (couple.membership_sealed_at || isFullyLinked(couple)) {
      throw new CoupleCodeError(
        409,
        "첫 커플 연결이 완료되어 초대 코드를 다시 만들 수 없어요.",
        "ROSTER_EPOCH_SEALED",
      );
    }
    if (couple.invite_code !== null && !validateInviteCode(couple.invite_code)) {
      throw new CoupleCodeError(
        500,
        "기존 초대 코드를 확인할 수 없어요. 잠시 후 다시 시도해 주세요.",
        "STORED_INVITE_CODE_INVALID",
      );
    }

    const generatedCode = await generateInviteCode(admin);
    const updated = await compareAndSwapInviteCode(
      admin,
      coupleId,
      couple.invite_code,
      generatedCode,
    );
    if (updated) {
      if (updated.membership_sealed_at || isFullyLinked(updated)) {
        throw new CoupleCodeError(409, "커플 연결 상태가 변경됐어요.", "UPDATE_SEALED_RACE");
      }
      if (!isMember(updated, authData.user.id) || updated.invite_code !== generatedCode) {
        throw new CoupleCodeError(409, "커플 연결 상태가 변경됐어요.", "UPDATE_STATE_MISMATCH");
      }
      return NextResponse.json({ inviteCode: generatedCode });
    }

    const canonical = await loadCoupleById(admin, coupleId, authData.user.id);
    if (canonical.membership_sealed_at || isFullyLinked(canonical)) {
      throw new CoupleCodeError(
        409,
        "커플 연결이 완료되어 초대 코드를 다시 만들 수 없어요.",
        "REGENERATION_SEALED_RACE",
      );
    }
    if (!validateInviteCode(canonical.invite_code)) {
      throw new CoupleCodeError(
        409,
        "초대 코드가 동시에 변경됐어요. 다시 시도해 주세요.",
        "REGENERATION_UNRESOLVED_RACE",
      );
    }
    return NextResponse.json({ inviteCode: canonical.invite_code });
  } catch (error) {
    return handleError(error, "POST");
  }
}
