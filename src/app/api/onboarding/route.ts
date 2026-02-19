import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

// RLS 우회용 service role 클라이언트
function getAdminClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function POST(request: Request) {
  try {
    // 인증 확인 (세션 클라이언트)
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }

    // DB 작업은 service role로 (RLS 우회)
    const admin = getAdminClient();

    const body = await request.json();
    const {
      role,
      coupleAction,
      partnerInviteCode,
      weddingDate,
      venue,
      totalBudget,
      progress,
    } = body;

    if (!role || !coupleAction) {
      return NextResponse.json(
        { error: "역할과 커플 연동 방법을 선택해주세요." },
        { status: 400 }
      );
    }

    // 프로필 존재 확인 (없으면 생성)
    const { data: existingProfile } = await admin
      .from("profiles")
      .select("id")
      .eq("id", user.id)
      .single();

    if (!existingProfile) {
      await admin.from("profiles").insert({
        id: user.id,
        name: user.user_metadata?.name ?? user.email?.split("@")[0] ?? "사용자",
        email: user.email,
        onboarding_completed: false,
        onboarding_step: 0,
      });
    }

    let coupleId: string;
    let inviteCode: string | null = null;

    if (coupleAction === "create") {
      // 새 커플 생성
      const { data: codeResult, error: rpcError } = await admin.rpc("generate_invite_code");
      if (rpcError) {
        console.error("초대 코드 생성 에러:", rpcError);
        return NextResponse.json(
          { error: "초대 코드 생성에 실패했습니다." },
          { status: 500 }
        );
      }
      inviteCode = codeResult as string;

      const coupleData: Record<string, unknown> = {
        invite_code: inviteCode,
      };
      if (role === "bride") {
        coupleData.bride_id = user.id;
      } else {
        coupleData.groom_id = user.id;
      }

      const { data: couple, error: coupleError } = await admin
        .from("couples")
        .insert(coupleData)
        .select()
        .single();

      if (coupleError || !couple) {
        console.error("커플 생성 에러:", coupleError);
        return NextResponse.json(
          { error: "커플 정보 생성에 실패했습니다." },
          { status: 500 }
        );
      }

      coupleId = couple.id;

      // 웨딩 여정 생성
      const { error: journeyError } = await admin.from("wedding_journeys").insert({
        couple_id: coupleId,
        wedding_date: weddingDate || null,
        venue: venue || null,
        total_budget: totalBudget || 20000000,
        progress: progress || {},
      });

      if (journeyError) {
        console.error("웨딩 여정 생성 에러:", journeyError);
      }
    } else {
      // 파트너 코드로 기존 커플에 조인
      if (!partnerInviteCode) {
        return NextResponse.json(
          { error: "파트너 초대 코드를 입력해주세요." },
          { status: 400 }
        );
      }

      const { data: couple, error: findError } = await admin
        .from("couples")
        .select("*")
        .eq("invite_code", partnerInviteCode)
        .single();

      if (findError || !couple) {
        return NextResponse.json(
          { error: "유효하지 않은 초대 코드입니다." },
          { status: 404 }
        );
      }

      // 역할 슬롯 확인
      const targetField = role === "bride" ? "bride_id" : "groom_id";
      if (couple[targetField]) {
        return NextResponse.json(
          {
            error: `이미 ${role === "bride" ? "신부" : "신랑"}가 연동되어 있습니다.`,
          },
          { status: 409 }
        );
      }

      // 커플 업데이트
      const { error: updateError } = await admin
        .from("couples")
        .update({ [targetField]: user.id })
        .eq("id", couple.id);

      if (updateError) {
        console.error("커플 조인 에러:", updateError);
        return NextResponse.json(
          { error: "커플 연동에 실패했습니다." },
          { status: 500 }
        );
      }

      coupleId = couple.id;
      inviteCode = couple.invite_code;

      // 기존 웨딩 여정이 있으면 사용, 없으면 생성
      const { data: existingJourney } = await admin
        .from("wedding_journeys")
        .select("*")
        .eq("couple_id", coupleId)
        .single();

      if (!existingJourney) {
        await admin.from("wedding_journeys").insert({
          couple_id: coupleId,
          wedding_date: weddingDate || null,
          venue: venue || null,
          total_budget: totalBudget || 20000000,
          progress: progress || {},
        });
      } else if (weddingDate || venue || totalBudget) {
        const updates: Record<string, unknown> = {};
        if (weddingDate && !existingJourney.wedding_date) updates.wedding_date = weddingDate;
        if (venue && !existingJourney.venue) updates.venue = venue;
        if (totalBudget && !existingJourney.total_budget) updates.total_budget = totalBudget;
        if (progress) {
          const merged = { ...(existingJourney.progress || {}), ...progress };
          updates.progress = merged;
        }
        if (Object.keys(updates).length > 0) {
          await admin
            .from("wedding_journeys")
            .update(updates)
            .eq("id", existingJourney.id);
        }
      }
    }

    // 프로필 업데이트
    const { error: profileError } = await admin
      .from("profiles")
      .update({
        role,
        couple_id: coupleId,
        onboarding_completed: true,
        onboarding_step: 4,
      })
      .eq("id", user.id);

    if (profileError) {
      console.error("프로필 업데이트 에러:", profileError);
      return NextResponse.json(
        { error: `프로필 저장에 실패했습니다: ${profileError.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      coupleId,
      inviteCode,
    });
  } catch (err) {
    console.error("온보딩 에러:", err);
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
