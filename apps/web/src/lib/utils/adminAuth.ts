import { createClientFromRequest } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

export function getServiceClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// 시드 라우트 환경 게이트 — 시드는 가짜 업체/상품/타임슬롯을 대량 생성하므로
// verifyAdmin만으로는 부족하다(세션 탈취 1회·운영자 실수 재호출 1번 → 프로덕션 오염).
// 프로덕션에서는 환경변수로도 우회할 수 없게 항상 차단한다. 실제 업체
// 등록은 검증된 별도 온보딩/관리 절차를 사용해야 한다.
// 차단 시 403 응답을 반환, 통과 시 null. (호출부: `const gate = seedGate(); if (gate) return gate;`)
export function seedGate(): NextResponse | null {
  const isProd =
    process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production";
  if (isProd) {
    return NextResponse.json(
      { error: "시드는 프로덕션에서 비활성화되어 있습니다." },
      { status: 403 }
    );
  }
  return null;
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
      return { authorized: true, userId: user.id };
    }
  } catch {
    // 인증 실패
  }

  return { authorized: false };
}
