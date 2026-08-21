import { NextResponse } from "next/server";

import {
  buildAppleAppSiteAssociation,
  normalizeAppleTeamId,
} from "@/lib/appLinks/appLinkIdentity";

/**
 * iOS가 읽는 도메인 쪽 증명서. 이게 있어야 초대 QR을 찍었을 때 웹이 아니라 앱이 열린다.
 *
 * Team ID가 없거나 모양이 다르면 **404**다. 빈 파일이나 가짜 값을 내주면 iOS는 검증에
 * 실패한 뒤 한동안 다시 묻지 않는다 — 아무것도 없을 때보다 나쁘다.
 *
 * 확장자 없이 이 경로 그대로 서빙해야 하고, `Content-Type`은 `application/json`이어야 한다.
 */
export const dynamic = "force-dynamic";

export function GET() {
  const teamId = normalizeAppleTeamId(process.env.APPLE_APP_SITE_ASSOCIATION_TEAM_ID);
  if (!teamId) {
    return new NextResponse(null, { status: 404 });
  }

  return NextResponse.json(buildAppleAppSiteAssociation(teamId), {
    headers: {
      "Content-Type": "application/json",
      // 자주 바뀌지 않지만, 값을 고친 날 하루를 기다리게 하고 싶지도 않다.
      "Cache-Control": "public, max-age=3600",
    },
  });
}
