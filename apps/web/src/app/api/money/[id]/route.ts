import { createClientFromRequest } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { PrivateNextResponse as NextResponse } from "@/lib/http/privateResponse";
import type { SupabaseClient } from "@supabase/supabase-js";
import { checkRateLimitPersistent, rateLimitKey } from "@/utils/rateLimit";
import {
  cleanOptionalEnum,
  cleanOptionalIsoDate,
  cleanOptionalText,
  isBodyTooLarge,
  isRecord,
  isUuid,
  readBoundedJsonValue,
} from "@/utils/requestValidation";
import { safeErrorDiagnostic } from "@/utils/safeErrorDiagnostic";
import { CONGRATULATORY_MONEY_PRIVATE_SELECT } from "@/lib/privacy/privateDataSelects";

const MAX_BODY_BYTES = 8 * 1024;
const MONEY_SIDES = ["groom", "bride", "both"] as const;
const MONEY_METHODS = ["cash", "transfer", "etc"] as const;

// 축의금 항목 소유권 검증: row의 couple_id와 사용자의 couple_id 일치 여부
async function assertMoneyOwner(
  supabase: SupabaseClient,
  moneyId: string,
  userId: string
): Promise<
  { ok: true; coupleId: string }
  | { ok: false; status: number; error: string }
> {
  const { data: row } = await supabase
    .from("congratulatory_money")
    .select("couple_id")
    .eq("id", moneyId)
    .single();

  if (!row) return { ok: false, status: 404, error: "기록을 찾을 수 없습니다." };

  const { data: profile } = await supabase
    .from("profiles")
    .select("couple_id")
    .eq("id", userId)
    .single();

  if (!profile || profile.couple_id !== row.couple_id) {
    return { ok: false, status: 403, error: "권한이 없습니다." };
  }

  return { ok: true, coupleId: row.couple_id };
}

// 화이트리스트 — 임의 컬럼 (couple_id 등) 변조 방지
const PATCHABLE_FIELDS = ["guest_name", "amount", "side", "relation", "method", "memo", "received_at"] as const;

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!isUuid(id)) {
      return NextResponse.json({ error: "잘못된 기록 ID입니다." }, { status: 400 });
    }
    if (isBodyTooLarge(request, MAX_BODY_BYTES)) {
      return NextResponse.json({ error: "요청 본문이 너무 큽니다." }, { status: 413 });
    }

    const supabase = await createClientFromRequest(request);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

    const limited = await checkRateLimitPersistent(rateLimitKey("money:update", request, user.id), {
      maxRequests: 60,
      windowMs: 60 * 1000,
    });
    if (limited) return limited;

    const ownerCheck = await assertMoneyOwner(supabase, id, user.id);
    if (!ownerCheck.ok) {
      return NextResponse.json({ error: ownerCheck.error }, { status: ownerCheck.status });
    }

    const bodyResult = await readBoundedJsonValue(request, MAX_BODY_BYTES);
    if (!bodyResult.ok) {
      return NextResponse.json(
        { error: bodyResult.reason === "too_large" ? "요청 본문이 너무 큽니다." : "잘못된 요청입니다." },
        { status: bodyResult.reason === "too_large" ? 413 : 400 },
      );
    }
    const body = bodyResult.value;
    if (!isRecord(body)) {
      return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
    }

    const update: Record<string, unknown> = {};
    for (const key of PATCHABLE_FIELDS) {
      if (key in body) update[key] = body[key];
    }
    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: "수정할 항목이 없습니다." }, { status: 400 });
    }
    // amount가 수정 대상이면 POST와 동일하게 범위 검증
    if ("amount" in update) {
      const amount = Number(update.amount);
      if (!Number.isInteger(amount) || amount < 0 || amount > 100_000_000) {
        return NextResponse.json({ error: "금액을 0~1억원 사이 숫자로 입력해주세요." }, { status: 400 });
      }
      update.amount = amount;
    }
    if ("guest_name" in update) {
      const guestName = cleanOptionalText(update.guest_name, 60);
      if (!guestName) return NextResponse.json({ error: "이름을 입력해주세요." }, { status: 400 });
      update.guest_name = guestName;
    }
    if ("side" in update) {
      const side = cleanOptionalEnum(update.side, MONEY_SIDES);
      if (!side) return NextResponse.json({ error: "구분을 선택해주세요." }, { status: 400 });
      update.side = side;
    }
    if ("method" in update) {
      const method = cleanOptionalEnum(update.method, MONEY_METHODS);
      if (!method) return NextResponse.json({ error: "수령 방식을 선택해주세요." }, { status: 400 });
      update.method = method;
    }
    if ("relation" in update) {
      update.relation = cleanOptionalText(update.relation, 60);
    }
    if ("memo" in update) {
      update.memo = cleanOptionalText(update.memo, 500);
    }
    if ("received_at" in update) {
      const receivedAt = cleanOptionalIsoDate(update.received_at);
      if (!receivedAt) {
        return NextResponse.json({ error: "날짜 형식이 올바르지 않습니다." }, { status: 400 });
      }
      update.received_at = receivedAt;
    }

    const { data, error } = await createAdminClient()
      .from("congratulatory_money")
      .update(update)
      .eq("id", id)
      .eq("couple_id", ownerCheck.coupleId)
      .select(CONGRATULATORY_MONEY_PRIVATE_SELECT)
      .single();

    if (error) {
      console.error("[money/:id PATCH] supabase", safeErrorDiagnostic(error));
      return NextResponse.json({ error: "수정에 실패했습니다." }, { status: 500 });
    }
    return NextResponse.json({ money: data });
  } catch (err) {
    console.error("[money/:id PATCH]", safeErrorDiagnostic(err));
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!isUuid(id)) {
      return NextResponse.json({ error: "잘못된 기록 ID입니다." }, { status: 400 });
    }

    const supabase = await createClientFromRequest(_request);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

    const limited = await checkRateLimitPersistent(rateLimitKey("money:delete", _request, user.id), {
      maxRequests: 30,
      windowMs: 60 * 1000,
    });
    if (limited) return limited;

    const ownerCheck = await assertMoneyOwner(supabase, id, user.id);
    if (!ownerCheck.ok) {
      return NextResponse.json({ error: ownerCheck.error }, { status: ownerCheck.status });
    }

    const { error } = await createAdminClient()
      .from("congratulatory_money")
      .delete()
      .eq("id", id)
      .eq("couple_id", ownerCheck.coupleId);
    if (error) {
      console.error("[money/:id DELETE] supabase", safeErrorDiagnostic(error));
      return NextResponse.json({ error: "삭제에 실패했습니다." }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[money/:id DELETE]", safeErrorDiagnostic(err));
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
