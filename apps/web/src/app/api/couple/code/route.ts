import { createClientFromRequest } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

function getAdmin() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

function generateCode() {
  const hex = Array.from({ length: 6 }, () =>
    "0123456789ABCDEF"[Math.floor(Math.random() * 16)]
  ).join("");
  return `WH-${hex}`;
}

// GET: 현재 커플 코드 조회 + 연동 상태
export async function GET(req: NextRequest) {
  try {
    const supabase = await createClientFromRequest(req);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }

    const admin = getAdmin();

    const { data: profile } = await admin
      .from("profiles")
      .select("couple_id")
      .eq("id", user.id)
      .single();

    if (!profile?.couple_id) {
      return NextResponse.json({ error: "커플 정보가 없습니다." }, { status: 404 });
    }

    const { data: couple } = await admin
      .from("couples")
      .select("invite_code, bride_id, groom_id")
      .eq("id", profile.couple_id)
      .single();

    if (!couple) {
      return NextResponse.json({ error: "커플 정보가 없습니다." }, { status: 404 });
    }

    // 코드가 없으면 생성
    let inviteCode = couple.invite_code;
    if (!inviteCode) {
      const { data: newCode } = await admin.rpc("generate_invite_code");
      inviteCode = (newCode as string) || generateCode();
      await admin
        .from("couples")
        .update({ invite_code: inviteCode })
        .eq("id", profile.couple_id);
    }

    // 양쪽 다 연동되었는지 확인
    const isFullyLinked = !!(couple.bride_id && couple.groom_id);

    return NextResponse.json({ inviteCode, isFullyLinked });
  } catch (err) {
    console.error("커플 코드 조회 에러:", err);
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}

// POST: 코드 재발급 (양쪽 다 연동된 경우 불가)
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClientFromRequest(req);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }

    const admin = getAdmin();

    const { data: profile } = await admin
      .from("profiles")
      .select("couple_id")
      .eq("id", user.id)
      .single();

    if (!profile?.couple_id) {
      return NextResponse.json({ error: "커플 정보가 없습니다." }, { status: 404 });
    }

    const { data: couple } = await admin
      .from("couples")
      .select("bride_id, groom_id")
      .eq("id", profile.couple_id)
      .single();

    if (!couple) {
      return NextResponse.json({ error: "커플 정보가 없습니다." }, { status: 404 });
    }

    // 양쪽 다 연동되었으면 재발급 불가
    if (couple.bride_id && couple.groom_id) {
      return NextResponse.json(
        { error: "이미 파트너와 연동 완료되어 코드를 재발급할 수 없습니다." },
        { status: 409 }
      );
    }

    // 새 코드 생성
    const { data: newCode } = await admin.rpc("generate_invite_code");
    const code = (newCode as string) || generateCode();

    const { error: updateError } = await admin
      .from("couples")
      .update({ invite_code: code, updated_at: new Date().toISOString() })
      .eq("id", profile.couple_id);

    if (updateError) {
      console.error("코드 재발급 에러:", updateError);
      return NextResponse.json({ error: "코드 재발급에 실패했습니다." }, { status: 500 });
    }

    return NextResponse.json({ inviteCode: code });
  } catch (err) {
    console.error("코드 재발급 에러:", err);
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
