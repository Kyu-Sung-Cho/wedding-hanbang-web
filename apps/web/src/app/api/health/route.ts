import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

/**
 * 로그인 없이 열리는 상태 확인.
 *
 * ## 왜 필요한가
 *
 * 이 저장소는 CI 가 전역에서 꺼져 있어 로컬 게이트가 유일한 안전망이고, 프로덕션 빌드가
 * 죽어도 **직전 배포가 계속 서비스돼서 사이트는 멀쩡해 보인다.** 실제로 2026-08-21 에
 * 그런 상태가 두 시간 있었다. 지금은 앱이 죽거나 DB 가 끊겨도 **사용자가 말해줄 때까지
 * 아무도 모른다** — 잡힌 서버 오류를 밖으로 올리는 제품 코드가 사실상 없다.
 *
 * 그래서 무료 감시 서비스가 1분마다 두드릴 수 있는 주소 하나를 낸다.
 *
 * ## 무엇을 확인하고 무엇을 말하지 않는가
 *
 * "200 을 돌려준다"만으로는 아무것도 확인하지 않는 것이다. 앱이 살아 있어도 DB 가
 * 끊기면 화면은 전부 빈다. 그래서 **DB 에 한 번 닿아 본다.**
 *
 * 반대로 상태 확인이 너무 많이 말하면 그 자체가 정보 노출이다. 그래서 이 응답에는
 * 아래 것들이 **없다.**
 *
 * - 사용자·커플 데이터, 개수, 통계
 * - 남은 하루 한도 — 얼마나 남았는지 알려주면 얼마나 태워야 하는지도 알려주는 셈이다
 * - 오류 원문·스택·DB 메시지 — 실패해도 `database: "down"` 한 마디만 남긴다
 * - 환경변수·버전·경로
 *
 * 남기는 것은 **살아 있나**와 **어느 커밋인가** 둘뿐이다. 커밋 해시는 배포 플랫폼이
 * 이미 공개하는 값이고, 이것이 있어야 "배포가 나갔는데 옛 빌드가 서비스되는" 상태를
 * 밖에서 구분할 수 있다.
 *
 * ## DB 확인이 값싼 이유
 *
 * 로그인 없이 열리는 자리에서 DB 를 두드리므로 **아무나 반복해서 부를 수 있다.**
 * 그래서 행을 읽지 않는다 — `head: true` 로 개수만 세고, 그마저 `limit(1)` 로 묶는다.
 * RLS 아래의 익명 클라이언트를 쓰므로 이 요청은 어떤 사적인 행에도 닿지 않는다.
 */

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** 응답이 캐시되면 죽은 뒤에도 살아 있다고 말한다. */
const NO_STORE = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
  "Pragma": "no-cache",
} as const;

/** 배포 플랫폼이 넣어 주는 커밋. 없으면 알 수 없다고 말한다(지어내지 않는다). */
function deployedCommit(): string {
  const sha = process.env.VERCEL_GIT_COMMIT_SHA;
  return typeof sha === "string" && /^[0-9a-f]{7,40}$/i.test(sha)
    ? sha.slice(0, 12)
    : "unknown";
}

export async function GET() {
  const checkedAt = new Date().toISOString();
  const commit = deployedCommit();

  let database: "up" | "down" = "down";
  try {
    const supabase = await createClient();
    // 행을 읽지 않는다. 닿는지만 본다.
    // 공개 공시 가격 뷰. `/price` 화면이 로그인 없이 읽는 것과 같은 자리라, 익명
    // 권한으로 닿는 것이 이미 증명돼 있다. 사적인 행은 이 뷰에 들어오지 않는다.
    const { error } = await supabase
      .from("v_public_prices")
      .select("*", { count: "exact", head: true })
      .limit(1);
    if (!error) database = "up";
  } catch {
    // 오류 원문은 밖으로 내보내지 않는다. 아래 한 마디로 충분하다.
    database = "down";
  }

  const ok = database === "up";
  return NextResponse.json(
    { ok, database, commit, checkedAt },
    { status: ok ? 200 : 503, headers: NO_STORE },
  );
}

export async function HEAD() {
  const response = await GET();
  return new NextResponse(null, {
    status: response.status,
    headers: NO_STORE,
  });
}
