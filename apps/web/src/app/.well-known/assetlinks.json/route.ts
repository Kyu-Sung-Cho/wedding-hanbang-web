import { NextResponse } from "next/server";

import {
  buildAndroidAssetLinks,
  parseAndroidCertFingerprints,
} from "@/lib/appLinks/appLinkIdentity";

/**
 * Android가 읽는 도메인 쪽 증명서(App Links).
 *
 * 서명 인증서 지문이 없거나 모양이 다르면 **404**다. 지어낸 지문을 내주면 검증이 실패한
 * 채로 굳어서, 나중에 진짜 값을 넣어도 한동안 앱이 열리지 않는다.
 *
 * 어떤 주소를 앱이 열지는 이 파일이 아니라 앱 매니페스트가 정한다
 * (`apps/mobile/app.json`의 `intentFilters`). 여기서는 패키지만 증명한다.
 */
export const dynamic = "force-dynamic";

export function GET() {
  const fingerprints = parseAndroidCertFingerprints(
    process.env.ANDROID_APP_LINKS_SHA256_CERT_FINGERPRINTS,
  );
  if (!fingerprints) {
    return new NextResponse(null, { status: 404 });
  }

  return NextResponse.json(buildAndroidAssetLinks(fingerprints), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
