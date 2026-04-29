import { createClientFromRequest } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

// 스크립트 소유권 검증: ai_scripts.couple_id의 bride/groom 중 하나여야 함.
async function assertScriptOwner(
  supabase: SupabaseClient,
  scriptId: string,
  userId: string
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const { data: script } = await supabase
    .from("ai_scripts")
    .select("couple_id")
    .eq("id", scriptId)
    .single();

  if (!script) return { ok: false, status: 404, error: "스크립트를 찾을 수 없습니다." };

  const { data: couple } = await supabase
    .from("couples")
    .select("bride_id, groom_id")
    .eq("id", script.couple_id)
    .single();

  if (!couple || (couple.bride_id !== userId && couple.groom_id !== userId)) {
    return { ok: false, status: 403, error: "권한이 없습니다." };
  }

  return { ok: true };
}

// PATCH 가능한 필드 화이트리스트 (임의 컬럼 변조 방지)
const PATCHABLE_FIELDS = ["title", "content", "is_favorite", "params"] as const;

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClientFromRequest(request);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

    const ownerCheck = await assertScriptOwner(supabase, id, user.id);
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

    const { data, error } = await supabase
      .from("ai_scripts")
      .update(update)
      .eq("id", id)
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ script: data });
  } catch (err) {
    console.error("[scripts/:id PATCH]", err);
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

    const ownerCheck = await assertScriptOwner(supabase, id, user.id);
    if (!ownerCheck.ok) {
      return NextResponse.json({ error: ownerCheck.error }, { status: ownerCheck.status });
    }

    const { error } = await supabase.from("ai_scripts").delete().eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[scripts/:id DELETE]", err);
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
