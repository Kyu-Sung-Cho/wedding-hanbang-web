/**
 * 초대 코드를 "보낼 수 있는 것"으로 만드는 자리 — 링크와 QR.
 *
 * ## 왜 필요했나
 *
 * 코드는 이미 발급되고 있었다. 문제는 앱의 온보딩 완료 화면이 코드를 글자 세 줄로만
 * 그려놓고 "이 코드를 파트너에게 보내주세요"라고 적어둔 것이다. 누를 수 있는 것이
 * 하나도 없어서, 사람은 `WH-` + 12자리를 손으로 옮겨 적어야 했다. 한 글자만 틀려도
 * 파트너 쪽에서 "초대 코드가 올바르지 않습니다"가 뜬다.
 *
 * ## 왜 코드를 프래그먼트(#)에 두는가
 *
 * 이 코드는 커플 공간에 들어오는 열쇠다. 경로나 쿼리에 넣으면 서버 접근 로그,
 * 리퍼러 헤더, 각종 분석 도구에 그대로 남는다. `#` 뒤는 브라우저가 서버로 보내지
 * 않으므로, 링크를 눌러도 코드가 서버 기록에 쌓이지 않는다.
 *
 * 같은 이유로 이 링크는 색인되면 안 된다. `/wedding-code/c/[code]`는 네 글자뿐이라
 * 남의 답이 들어 있지 않지만(이전 판 코드라 지금은 색인도 멈췄다), 이건 코드 자체가 열쇠다.
 *
 * ## QR은 왜 카메라 권한 없이 되는가
 *
 * 우리가 하는 일은 QR을 **그려서 보여주는 것**뿐이다. 읽는 쪽은 파트너 폰의 기본
 * 카메라가 한다 — iOS·Android 둘 다 QR을 기본으로 인식한다. 앱에 카메라 권한을
 * 넣으면 스토어 개인정보 고지가 바뀌고 네이티브 빌드가 강제되는데, 그렇게 해서
 * 얻는 게 "우리 앱 안에서 찍기" 하나뿐이라 넣지 않았다.
 */

import {
  isCoupleInviteCode,
  normalizeCoupleInviteCode,
} from "./coupleInviteCode";

/** 초대 링크가 착지하는 공개 경로. 로그인 없이 열려야 한다. */
export const COUPLE_INVITE_LANDING_PATH = "/invite" as const;

/** 앱이 등록한 커스텀 스킴(apps/mobile/app.json의 `scheme`). */
export const COUPLE_INVITE_APP_SCHEME = "hanbang" as const;

/**
 * 파트너에게 보낼 링크. QR에도 이 문자열을 그대로 넣는다 — 기본 카메라가 읽어서
 * 브라우저를 열 수 있어야 하므로 https여야 하고, 커스텀 스킴이면 안 된다.
 *
 * origin이 비었거나 이상하면 null. 부르는 쪽은 그때 링크·QR을 아예 그리지 않고
 * 코드 복사만 남긴다 — 깨진 링크를 보내는 것보다 낫다.
 */
export function buildCoupleInviteShareUrl(input: {
  code: unknown;
  origin: unknown;
}): string | null {
  const code = normalizeCoupleInviteCode(input.code);
  if (!isCoupleInviteCode(code)) return null;
  if (typeof input.origin !== "string" || input.origin.length === 0) return null;

  let base: URL;
  try {
    base = new URL(input.origin);
  } catch {
    return null;
  }
  if (base.protocol !== "https:" && base.protocol !== "http:") return null;

  return `${base.origin}${COUPLE_INVITE_LANDING_PATH}#${code}`;
}

/**
 * 앱이 깔려 있을 때 착지 페이지가 시도하는 딥링크. 앱이 없으면 아무 일도 일어나지
 * 않으므로, 부르는 쪽은 항상 웹으로 계속할 방법을 함께 보여줘야 한다.
 */
export function buildCoupleInviteAppLink(code: unknown): string | null {
  const normalized = normalizeCoupleInviteCode(code);
  if (!isCoupleInviteCode(normalized)) return null;
  return `${COUPLE_INVITE_APP_SCHEME}://invite#${normalized}`;
}

/**
 * 링크나 해시에서 코드를 꺼낸다. `#WH-...`, `WH-...`, 전체 URL 모두 받는다 —
 * 사람이 어디를 복사해 왔는지로 실패하면 안 된다.
 */
export function parseCoupleInviteFragment(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) return null;

  const hashIndex = value.indexOf("#");
  const raw = hashIndex >= 0 ? value.slice(hashIndex + 1) : value;
  const normalized = normalizeCoupleInviteCode(raw);
  return isCoupleInviteCode(normalized) ? normalized : null;
}

/**
 * 메신저에 붙여넣을 문구. 코드와 링크를 함께 넣는 이유는, 링크를 못 여는 환경에서도
 * 코드만 보고 손으로 넣을 수 있어야 하기 때문이다.
 *
 * 파트너가 무엇을 하게 되는지 한 줄로 말한다 — 정체 모를 링크는 눌리지 않는다.
 */
export function buildCoupleInviteShareMessage(input: {
  code: unknown;
  url?: string | null;
}): string | null {
  const code = normalizeCoupleInviteCode(input.code);
  if (!isCoupleInviteCode(code)) return null;

  const lines = [
    "웨딩한방에서 같이 결혼 준비해요.",
    `초대 코드: ${code}`,
  ];
  if (typeof input.url === "string" && input.url.length > 0) {
    lines.push(input.url);
  }
  return lines.join("\n");
}
