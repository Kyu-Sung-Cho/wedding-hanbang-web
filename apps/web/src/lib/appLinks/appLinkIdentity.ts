/**
 * QR·초대 링크가 앱을 열게 하는 두 장의 증명서를 만드는 자리.
 *
 * ## 왜 필요한가
 *
 * 파트너에게 보내는 초대 링크는 `https://hanbang.ai/invite#WH-...`이고, QR에도 같은
 * 문자열이 들어간다(`packages/shared/src/contracts/coupleInviteLink.ts`). 기본 카메라가
 * 이 주소를 열 때 앱이 깔려 있으면 앱이 받아야 한다. 그런데 그 연결은 앱 설정만으로는
 * 성립하지 않는다 — **도메인 쪽**이 "이 앱이 내 주소를 열어도 된다"고 서명해 줘야 한다.
 * iOS는 `/.well-known/apple-app-site-association`, Android는 `/.well-known/assetlinks.json`을
 * 읽는다. 저장소에는 둘 다 없었고, 그래서 QR을 찍어도 웹만 열렸다.
 *
 * ## 왜 값을 코드에 적지 않는가
 *
 * 완결에는 Apple Team ID와 Android 서명 인증서 지문(SHA-256)이 필요하다. 둘 다 파운더의
 * 계정에만 있는 값이고, **지어내면 안 된다.** 틀린 값을 서빙하면 OS는 검증에 실패한
 * 뒤 한동안 재시도하지 않는다 — 아무것도 없을 때보다 나쁘다. 그래서 환경변수로 받고,
 * 없거나 모양이 다르면 파일을 아예 내주지 않는다(404).
 *
 * ## 어떤 경로를 앱에 넘기는가
 *
 * iOS는 이 파일의 `paths`로 어떤 주소를 앱에 넘길지 정한다. 지금 앱이 실제로 처리하는
 * 유니버설 링크는 초대 착지 화면 하나다(`apps/mobile/app/invite.tsx`). 없는 화면을
 * 적어두면 그 주소를 연 사람이 앱 안에서 빈 화면을 만난다.
 *
 * Android는 반대로 **어떤 주소를 열지를 앱 매니페스트가** 정하고, 이 파일은 "그 패키지가
 * 맞다"만 증명한다. 그래서 여기에는 경로가 없다.
 */

/** apps/mobile/app.json의 `ios.bundleIdentifier` · `android.package`와 같아야 한다. */
export const NATIVE_APP_ID = "ai.hanbang.wedding";

/** iOS가 앱에 넘길 주소. 앱에 실물 화면이 있는 경로만 적는다. */
export const APPLE_APP_LINK_PATHS = ["/invite"] as const;

/** Apple Developer 계정의 Team ID. 10자 영숫자. */
const APPLE_TEAM_ID_RE = /^[A-Z0-9]{10}$/u;

/** 서명 인증서 SHA-256 지문. 콜론으로 이은 32바이트. */
const ANDROID_FINGERPRINT_RE = /^(?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/u;

/**
 * Team ID를 다듬는다. 소문자로 적어 두거나 앞뒤 공백이 붙는 일은 흔하고, 그것으로
 * 딥링크가 조용히 죽을 이유는 없다. 모양이 아니면 null — 짐작해서 채우지 않는다.
 */
export function normalizeAppleTeamId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  return APPLE_TEAM_ID_RE.test(normalized) ? normalized : null;
}

/**
 * 지문 목록을 읽는다. 쉼표·공백·줄바꿈 어느 것으로 나눠 적어도 받는다.
 *
 * 릴리스 키와 업로드 키(Play 앱 서명)를 **둘 다** 적어야 하는 경우가 흔해서 목록으로
 * 받는다. 모양이 아닌 항목은 통째로 거절한다 — 하나가 깨진 목록을 반쯤 서빙하면
 * 어느 기기에서 왜 안 열리는지 알 수 없게 된다.
 */
export function parseAndroidCertFingerprints(value: unknown): string[] | null {
  if (typeof value !== "string") return null;
  const parts = value
    .split(/[\s,]+/u)
    .map((part) => part.trim().toUpperCase())
    .filter((part) => part.length > 0);
  if (parts.length === 0) return null;
  if (!parts.every((part) => ANDROID_FINGERPRINT_RE.test(part))) return null;
  return parts;
}

export interface AppleAppSiteAssociation {
  applinks: {
    apps: string[];
    details: Array<{ appID: string; paths: string[] }>;
  };
}

export function buildAppleAppSiteAssociation(
  teamId: string,
): AppleAppSiteAssociation {
  return {
    applinks: {
      // 이 키는 비어 있어야 한다고 Apple이 규정한다. 생략하면 안 읽는 기기가 있다.
      apps: [],
      details: [
        {
          appID: `${teamId}.${NATIVE_APP_ID}`,
          paths: [...APPLE_APP_LINK_PATHS],
        },
      ],
    },
  };
}

export type AndroidAssetLinks = Array<{
  relation: string[];
  target: {
    namespace: "android_app";
    package_name: string;
    sha256_cert_fingerprints: string[];
  };
}>;

export function buildAndroidAssetLinks(
  fingerprints: readonly string[],
): AndroidAssetLinks {
  return [
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: {
        namespace: "android_app",
        package_name: NATIVE_APP_ID,
        sha256_cert_fingerprints: [...fingerprints],
      },
    },
  ];
}
