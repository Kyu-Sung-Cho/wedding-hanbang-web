import { createClientFromRequest } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

interface ResetBody {
  confirmText?: string;
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

    const body = (await request.json().catch(() => ({}))) as ResetBody;
    if (body.confirmText !== "초기화합니다") {
      return NextResponse.json({ error: "확인 문구가 일치하지 않습니다." }, { status: 400 });
    }

    const admin = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("id, couple_id, role")
      .eq("id", user.id)
      .single();

    if (profileError || !profile) {
      return NextResponse.json({ error: "프로필을 찾을 수 없습니다." }, { status: 404 });
    }

    const coupleId = profile.couple_id as string | null;
    if (coupleId) {
      const { data: couple } = await admin
        .from("couples")
        .select("id, bride_id, groom_id")
        .eq("id", coupleId)
        .single();

      if (couple) {
        const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
        if (couple.bride_id === user.id) update.bride_id = null;
        if (couple.groom_id === user.id) update.groom_id = null;

        if ("bride_id" in update || "groom_id" in update) {
          const { error: coupleError } = await admin
            .from("couples")
            .update(update)
            .eq("id", coupleId);
          if (coupleError) {
            return NextResponse.json({ error: coupleError.message }, { status: 500 });
          }
        }
      }
    }

    const { error: resetError } = await admin
      .from("profiles")
      .update({
        couple_id: null,
        onboarding_completed: false,
        onboarding_step: 1,
        shared_chat_cleared_at: null,
        private_chat_cleared_at: null,
      })
      .eq("id", user.id);

    if (resetError) {
      return NextResponse.json({ error: resetError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[couple/reset] error:", err);
    return NextResponse.json({ error: "초기화에 실패했습니다." }, { status: 500 });
  }
}
