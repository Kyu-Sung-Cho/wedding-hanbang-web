import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }

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

    // 프로필 존재 확인 (RLS: profiles_select_own)
    const { data: existingProfile } = await supabase
      .from("profiles")
      .select("id")
      .eq("id", user.id)
      .single();

    if (!existingProfile) {
      // 프로필 생성 (RLS: profiles_insert_own)
      await supabase.from("profiles").insert({
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
      // 초대 코드 생성 (DB 함수)
      const { data: codeResult, error: rpcError } = await supabase.rpc("generate_invite_code");
      if (rpcError) {
        console.error("초대 코드 생성 에러:", rpcError);
        return NextResponse.json(
          { error: "초대 코드 생성에 실패했습니다." },
          { status: 500 }
        );
      }
      inviteCode = codeResult as string;

      // 커플 생성 (RLS: couples_insert_own - bride/groom = auth.uid())
      const coupleData: Record<string, unknown> = {
        invite_code: inviteCode,
      };
      if (role === "bride") {
        coupleData.bride_id = user.id;
      } else {
        coupleData.groom_id = user.id;
      }

      const { data: couple, error: coupleError } = await supabase
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

      // ⚡ 프로필에 couple_id 먼저 설정 (RLS: profiles_update_own)
      // 이렇게 해야 wedding_journeys INSERT 시 RLS 통과
      await supabase
        .from("profiles")
        .update({
          role,
          couple_id: coupleId,
          onboarding_completed: true,
          onboarding_step: 4,
        })
        .eq("id", user.id);

      // 웨딩 여정 생성 (RLS: journeys_insert_couple / journeys_insert_via_couple)
      const { error: journeyError } = await supabase.from("wedding_journeys").insert({
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
      // 파트너 코드로 기존 커플에 조인 (SECURITY DEFINER 함수)
      if (!partnerInviteCode) {
        return NextResponse.json(
          { error: "파트너 초대 코드를 입력해주세요." },
          { status: 400 }
        );
      }

      const { data: joinResult, error: joinError } = await supabase.rpc("join_couple", {
        p_invite_code: partnerInviteCode,
        p_role: role,
      });

      if (joinError) {
        console.error("커플 조인 에러:", joinError);
        return NextResponse.json(
          { error: "커플 연동에 실패했습니다." },
          { status: 500 }
        );
      }

      const result = joinResult as { success?: boolean; error?: string; couple_id?: string; invite_code?: string };

      if (result.error) {
        return NextResponse.json(
          { error: result.error },
          { status: 409 }
        );
      }

      coupleId = result.couple_id!;
      inviteCode = result.invite_code ?? null;

      // 온보딩 완료 처리 (join_couple이 이미 couple_id, role 설정함)
      await supabase
        .from("profiles")
        .update({
          onboarding_completed: true,
          onboarding_step: 4,
        })
        .eq("id", user.id);

      // 기존 웨딩 여정 확인, 없으면 생성
      const { data: existingJourney } = await supabase
        .from("wedding_journeys")
        .select("*")
        .eq("couple_id", coupleId)
        .single();

      if (!existingJourney) {
        await supabase.from("wedding_journeys").insert({
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
          await supabase
            .from("wedding_journeys")
            .update(updates)
            .eq("id", existingJourney.id);
        }
      }
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
