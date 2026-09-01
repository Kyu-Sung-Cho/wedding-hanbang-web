import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export function getServiceClient() {
  return createAdminClient();
}

// 시드 라우트 환경 게이트 — 시드는 가짜 업체/상품/타임슬롯을 대량 생성하므로
// verifyAdmin만으로는 부족하다(세션 탈취 1회·운영자 실수 재호출 1번 → 프로덕션 오염).
// 프로덕션에서는 ALLOW_SEED=true가 명시된 경우에만 허용한다.
// 차단 시 403 응답을 반환, 통과 시 null. (호출부: `const gate = seedGate(); if (gate) return gate;`)
export function seedGate(): NextResponse | null {
  const isProd =
    process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production";
  if (isProd && process.env.ALLOW_SEED !== "true") {
    return NextResponse.json(
      { error: "시드는 프로덕션에서 비활성화되어 있습니다." },
      { status: 403 }
    );
  }
  return null;
}

/**
 * 개인정보취급자(관리자)가 개인정보처리시스템에 접근한 기록을 남긴다.
 *
 * ## 왜 필요한가
 *
 * 관리자 API 32개 라우트가 이 파일의 `verifyAdmin()` 하나를 거쳐 고객 프로필·
 * 예약·게시글·신고·업체 자료를 연다. 그런데 2026-09-01 확인 결과 **누가 언제
 * 무엇을 열었는지 남는 곳이 하나도 없었다** — `auth.audit_log_entries` 0행,
 * 접속기록 전용 저장소 없음. 개인정보 처리방침에 보관 기간을 적으려 해도 적을
 * 대상 자체가 없었다.
 *
 * ## 무엇을 남기나 — 누가·언제·어디만
 *
 * 요청 본문·응답·조회된 개인정보는 어느 컬럼에도 넣지 않는다. 경로도
 * `pathname` 만 쓴다 — 질의문자열에는 검색어가 들어올 수 있고 그것은 종종
 * 사람 이름이다.
 *
 * ## 이 함수는 요청을 막지 않는다
 *
 * 인증 경로 한가운데서 돈다. 기록이 실패해서 관리자가 일을 못 하게 되면 그건
 * 더 나쁜 교환이다. 그래서 삼킨다 — 다만 삼키는 대상은 **기록 실패뿐**이고,
 * 인증 판정은 이 함수를 부르기 전에 이미 끝나 있어 무엇을 해도 바뀌지 않는다.
 */
async function recordAdminAccess(adminId: string, request: Request): Promise<void> {
  try {
    // 질의문자열은 버린다. `?q=홍길동` 같은 것이 그대로 남으면 안 된다.
    const path = new URL(request.url).pathname.slice(0, 512);
    await getServiceClient()
      .from("admin_access_log")
      .insert({ admin_id: adminId, method: request.method, path });
  } catch {
    // 기록 실패가 관리자 업무를 막지 않는다.
  }
}

// 관리자 인증: Supabase Auth + is_admin 플래그만 허용
export async function verifyAdmin(request: Request): Promise<{ authorized: boolean; userId?: string }> {
  try {
    const supabase = await createClientFromRequest(request);
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) return { authorized: false };

    const serviceClient = getServiceClient();
    const { data: profile } = await serviceClient
      .from("profiles")
      .select("is_admin")
      .eq("id", user.id)
      .single();

    if (profile?.is_admin === true) {
      // 판정이 끝난 뒤에 기록한다. 기록이 판정을 바꿀 수 없는 자리다.
      await recordAdminAccess(user.id, request);
      return { authorized: true, userId: user.id };
    }
  } catch {
    // 인증 실패
  }

  return { authorized: false };
}
