import { createClientFromRequest } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

// 축의금 항목 소유권 검증: row의 couple_id와 사용자의 couple_id 일치 여부
async function assertMoneyOwner(
  supabase: SupabaseClient,
  moneyId: string,
  userId: string
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
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

  return { ok: true };
}

// 화이트리스트 — 임의 컬럼 (couple_id 등) 변조 방지
const PATCHABLE_FIELDS = ["guest_name", "amount", "side", "relation", "method", "memo", "received_at"] as const;

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClientFromRequest(request);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

    const ownerCheck = await assertMoneyOwner(supabase, id, user.id);
    if (!ownerCheck.ok) {
      return NextResponse.json({ error: ownerCheck.error }, { status: ownerCheck.status });
    }

    const body = await request.json();
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
    if (typeof update.guest_name === "string") {
      update.guest_name = update.guest_name.trim().slice(0, 60);
      if (!update.guest_name) return NextResponse.json({ error: "이름을 입력해주세요." }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("congratulatory_money")
      .update(update)
      .eq("id", id)
      .select()
      .single();

    if (error) {
      console.error("[money/:id PATCH] supabase:", error);
      return NextResponse.json({ error: "수정에 실패했습니다." }, { status: 500 });
    }
    return NextResponse.json({ money: data });
  } catch (err) {
    console.error("[money/:id PATCH]", err);
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClientFromRequest(_request);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

    const ownerCheck = await assertMoneyOwner(supabase, id, user.id);
    if (!ownerCheck.ok) {
      return NextResponse.json({ error: ownerCheck.error }, { status: ownerCheck.status });
    }

    const { error } = await supabase.from("congratulatory_money").delete().eq("id", id);
    if (error) {
      console.error("[money/:id DELETE] supabase:", error);
      return NextResponse.json({ error: "삭제에 실패했습니다." }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[money/:id DELETE]", err);
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
