import { createClientFromRequest } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { recordDecision } from "@/lib/memory/record-decision";
import { determineStage } from "@/lib/ai/stage-router";
import { getEvents, upsertMomentEvent } from "@/utils/scheduleEvents";

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
      weddingDate: rawWeddingDate,
      venue: rawVenue,
      sanggyeonryeDate,
      totalBudget: rawTotalBudget,
      progress,
    } = body;

    if (!role || !coupleAction) {
      return NextResponse.json(
        { error: "역할과 커플 연동 방법을 선택해주세요." },
        { status: 400 }
      );
    }

    // 입력 검증 — 인증·커플 스코프지만 거대 숫자/음수/무제한 텍스트가 예산 계산·
    // 표시를 깨뜨릴 수 있어 경계에서 정규화한다.
    const weddingDate =
      typeof rawWeddingDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(rawWeddingDate)
        ? rawWeddingDate
        : null;
    const venue =
      typeof rawVenue === "string" && rawVenue.trim() ? rawVenue.trim().slice(0, 100) : null;
    const budgetNum = Number(rawTotalBudget);
    const totalBudget =
      Number.isFinite(budgetNum) && budgetNum > 0 && budgetNum <= 10_000_000_000
        ? Math.round(budgetNum)
        : null;

    // 상견례 날짜를 받으면 모멘트 루프 연료로 progress.__events에 태깅 저장.
    // (D-3/D-1/D+1에 아모라가 먼저 챙기는 첫 관계 모멘트 — moments.ts:sanggyeonrye)
    const hasSanggyeonryeDate =
      typeof sanggyeonryeDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sanggyeonryeDate);
    const baseProgress =
      progress && typeof progress === "object" ? (progress as Record<string, unknown>) : {};
    const journeyProgress = hasSanggyeonryeDate
      ? upsertMomentEvent(baseProgress, {
          momentType: "sanggyeonrye",
          date: sanggyeonryeDate,
          title: "상견례",
        }).newProgress
      : baseProgress;

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
          onboarding_step: 5,
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
        progress: journeyProgress,
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

      // 4. 커플에 합류 — 동시 join race 방어 (atomic conditional update).
      //
      // 이전 버그: 위 3 단계 read-then-write 사이에 다른 사용자가 동일 역할로
      // join 하면 두 update 모두 같은 row 를 덮어써서 한 명의 데이터가 손실.
      // 해결: WHERE 절에 `<role>_id IS NULL` 추가. Postgres row-level lock 으로
      // 직렬화되어 후속 update 는 0 rows affected → race loser 가 명시적 에러 받음.
      const coupleUpdate: Record<string, unknown> = { updated_at: new Date().toISOString() };
      const roleField = role === "bride" ? "bride_id" : "groom_id";
      coupleUpdate[roleField] = user.id;

      const { data: updatedRows, error: coupleUpdateError } = await admin
        .from("couples")
        .update(coupleUpdate)
        .eq("id", couple.id)
        .is(roleField, null)
        .select("id");

      if (coupleUpdateError) {
        console.error("[온보딩 조인] 커플 업데이트 에러:", coupleUpdateError);
        return NextResponse.json(
          { error: `커플 연동 실패: ${coupleUpdateError.message}` },
          { status: 500 }
        );
      }

      // affected rows 0 → race 에서 졌거나 그 사이 다른 사용자가 슬롯 차지
      if (!updatedRows || updatedRows.length === 0) {
        return NextResponse.json(
          { error: "방금 다른 사용자가 이 자리로 연동했어요. 다시 시도해주세요." },
          { status: 409 }
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
          onboarding_step: 5,
        })
        .eq("id", user.id);

      if (profileUpdateError) {
        console.error("[온보딩 조인] 프로필 업데이트 에러:", profileUpdateError);
      }

      // 6. 기존 웨딩 여정 확인 (파트너가 이미 세팅해둔 것 공유)
      const { data: existingJourney } = await admin
        .from("wedding_journeys")
        .select("id, progress")
        .eq("couple_id", coupleId)
        .maybeSingle();

      if (!existingJourney) {
        await admin.from("wedding_journeys").insert({
          couple_id: coupleId,
          wedding_date: weddingDate || null,
          venue: venue || null,
          total_budget: totalBudget || 20000000,
          progress: journeyProgress,
        });
      } else if (hasSanggyeonryeDate) {
        // 파트너가 이미 journey를 만들어둔 경우에도 join하는 쪽이 입력한 상견례
        // 날짜는 버리지 않고 병합 — 단, 파트너가 이미 등록했다면 보존 우선(덮어쓰기 금지).
        const existingProgress = (existingJourney.progress ?? {}) as Record<string, unknown>;
        const alreadyHasSanggyeonrye = getEvents(existingProgress).some(
          (event) => event.momentType === "sanggyeonrye"
        );
        if (!alreadyHasSanggyeonrye) {
          const { newProgress } = upsertMomentEvent(existingProgress, {
            momentType: "sanggyeonrye",
            date: sanggyeonryeDate,
            title: "상견례",
          });
          const { error: patchError } = await admin.rpc("apply_journey_progress_patch", {
            p_couple_id: coupleId,
            p_patch: { __events: getEvents(newProgress) },
          });
          if (patchError) {
            // RPC 미배포 폴백 — 온보딩 직후라 동시수정 경합은 사실상 없음
            await admin
              .from("wedding_journeys")
              .update({ progress: newProgress })
              .eq("id", existingJourney.id);
          }
        }
      }

      console.log("[온보딩 조인] 완료! coupleId:", coupleId);
    }

    // D2 Hook 3: 온보딩 완료 시 decision_nodes 기록 (fire-and-forget)
    // wedding_date/venue/total_budget 중 실제로 저장된 필드만 기록
    void (async () => {
      try {
        const stageTag = determineStage(weddingDate ?? null);
        const baseMeta = { hook: "onboarding", role, coupleAction };

        if (weddingDate) {
          await recordDecision({
            coupleId,
            userId: user.id,
            category: "timeline",
            title: "예식일 확정",
            chosenValue: { wedding_date: weddingDate },
            decisionType: "decided",
            stageTag,
            source: "onboarding",
            confidence: 0.95,
            metadata: baseMeta,
          });
        }

        if (venue) {
          await recordDecision({
            coupleId,
            userId: user.id,
            category: "venue",
            title: String(venue),
            chosenValue: { venue },
            decisionType: "considering",
            stageTag,
            source: "onboarding",
            confidence: 0.7,
            metadata: baseMeta,
          });
        }

        if (hasSanggyeonryeDate) {
          await recordDecision({
            coupleId,
            userId: user.id,
            category: "timeline",
            title: "상견례 일정",
            chosenValue: { sanggyeonrye_date: sanggyeonryeDate },
            decisionType: "decided",
            stageTag,
            source: "onboarding",
            confidence: 0.9,
            metadata: baseMeta,
          });
        }

        if (totalBudget && totalBudget > 0) {
          await recordDecision({
            coupleId,
            userId: user.id,
            category: "budget",
            title: "총 예산 설정",
            chosenValue: { total_budget: totalBudget },
            decisionType: "decided",
            stageTag,
            source: "onboarding",
            confidence: 0.9,
            metadata: baseMeta,
          });
        }
      } catch (err) {
        console.error("[onboarding recordDecision] 실패 (무시):", err);
      }
    })();

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
