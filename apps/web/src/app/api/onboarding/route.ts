import { createClientFromRequest } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

function getAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY 환경변수가 설정되지 않았습니다.");
  }

  return createAdminClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
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

    // admin 클라이언트 (RLS 우회)
    const admin = getAdmin();

    // 프로필 존재 확인 (admin으로 통일)
    const { data: existingProfile } = await admin
      .from("profiles")
      .select("id")
      .eq("id", user.id)
      .single();

    if (!existingProfile) {
      // 프로필 생성
      const { error: profileInsertErr } = await admin.from("profiles").insert({
        id: user.id,
        name: user.user_metadata?.name ?? user.email?.split("@")[0] ?? "사용자",
        email: user.email,
        onboarding_completed: false,
        onboarding_step: 0,
      });
      if (profileInsertErr) {
        console.error("프로필 생성 에러:", profileInsertErr);
      }
    }

    let coupleId: string;
    let inviteCode: string | null = null;

    if (coupleAction === "create") {
      // 초대 코드 생성 (DB 함수) — admin으로 호출
      const { data: codeResult, error: rpcError } = await admin.rpc("generate_invite_code");
      if (rpcError) {
        console.error("초대 코드 생성 에러:", rpcError);
        // fallback: 직접 생성
        const hex = Array.from({ length: 6 }, () =>
          "0123456789ABCDEF"[Math.floor(Math.random() * 16)]
        ).join("");
        inviteCode = `WH-${hex}`;
      } else {
        inviteCode = codeResult as string;
      }

      // 커플 생성
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

      // 프로필에 couple_id 설정
      const { error: profileUpdateErr } = await admin
        .from("profiles")
        .update({
          role,
          couple_id: coupleId,
          onboarding_completed: true,
          onboarding_step: 4,
        })
        .eq("id", user.id);

      if (profileUpdateErr) {
        console.error("프로필 업데이트 에러:", profileUpdateErr);
      }

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
      // ===== 파트너 코드로 기존 커플에 조인 =====
      if (!partnerInviteCode) {
        return NextResponse.json(
          { error: "파트너 초대 코드를 입력해주세요." },
          { status: 400 }
        );
      }

      const trimmedCode = partnerInviteCode.trim().toUpperCase();
      console.log("[온보딩 조인] 코드 조회 시작:", trimmedCode);

      // 1. 초대 코드로 커플 찾기
      const { data: couple, error: findError } = await admin
        .from("couples")
        .select("*")
        .eq("invite_code", trimmedCode)
        .maybeSingle();

      if (findError) {
        console.error("[온보딩 조인] 커플 조회 에러:", findError);
        return NextResponse.json(
          { error: `커플 조회 실패: ${findError.message}` },
          { status: 500 }
        );
      }

      if (!couple) {
        console.error("[온보딩 조인] 코드에 해당하는 커플 없음:", trimmedCode);
        return NextResponse.json(
          { error: "유효하지 않은 초대 코드입니다. 코드를 다시 확인해주세요." },
          { status: 404 }
        );
      }

      console.log("[온보딩 조인] 커플 찾음:", couple.id, "bride:", couple.bride_id, "groom:", couple.groom_id);

      // 2. 자기 자신의 코드인지 확인
      if (couple.bride_id === user.id || couple.groom_id === user.id) {
        return NextResponse.json(
          { error: "본인의 초대 코드로는 연동할 수 없습니다." },
          { status: 409 }
        );
      }

      // 3. 역할 슬롯 확인
      if (role === "bride" && couple.bride_id) {
        return NextResponse.json(
          { error: "이미 신부가 연동되어 있습니다. 신랑으로 참여해주세요." },
          { status: 409 }
        );
      }
      if (role === "groom" && couple.groom_id) {
        return NextResponse.json(
          { error: "이미 신랑이 연동되어 있습니다. 신부로 참여해주세요." },
          { status: 409 }
        );
      }

      // 4. 커플에 합류
      const coupleUpdate: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (role === "bride") {
        coupleUpdate.bride_id = user.id;
      } else {
        coupleUpdate.groom_id = user.id;
      }

      const { error: coupleUpdateError } = await admin
        .from("couples")
        .update(coupleUpdate)
        .eq("id", couple.id);

      if (coupleUpdateError) {
        console.error("[온보딩 조인] 커플 업데이트 에러:", coupleUpdateError);
        return NextResponse.json(
          { error: `커플 연동 실패: ${coupleUpdateError.message}` },
          { status: 500 }
        );
      }

      coupleId = couple.id;
      inviteCode = couple.invite_code;

      // 5. 프로필 업데이트
      const { error: profileUpdateError } = await admin
        .from("profiles")
        .update({
          role,
          couple_id: coupleId,
          onboarding_completed: true,
          onboarding_step: 4,
        })
        .eq("id", user.id);

      if (profileUpdateError) {
        console.error("[온보딩 조인] 프로필 업데이트 에러:", profileUpdateError);
      }

      // 6. 기존 웨딩 여정 확인 (파트너가 이미 세팅해둔 것 공유)
      const { data: existingJourney } = await admin
        .from("wedding_journeys")
        .select("id")
        .eq("couple_id", coupleId)
        .maybeSingle();

      if (!existingJourney) {
        await admin.from("wedding_journeys").insert({
          couple_id: coupleId,
          wedding_date: weddingDate || null,
          venue: venue || null,
          total_budget: totalBudget || 20000000,
          progress: progress || {},
        });
      }

      console.log("[온보딩 조인] 완료! coupleId:", coupleId);
    }

    return NextResponse.json({
      success: true,
      coupleId,
      inviteCode,
    });
  } catch (err) {
    console.error("온보딩 에러:", err);
    return NextResponse.json(
      { error: `서버 오류: ${err instanceof Error ? err.message : "알 수 없는 오류"}` },
      { status: 500 }
    );
  }
}
