// 채팅 사진 첨부 — 웹 ChatBubble 과 앱이 함께 쓰는 판정과 서명 URL 해석(2026-09-18).
//
// 첨부 원본은 비공개 버킷 `chat-image` 에 있다. 화면은 경로를 직접 읽지 않고
// POST /api/chat/image-urls 에 메시지 id 만 보내, 서버가 요청자 권한(RLS)으로 그 메시지를 읽은 뒤
// 만들어 준 1시간짜리 서명 URL 로만 그린다. 이 모듈은 그 앞뒤의 두 판정만 진다:
//   1) 이 메시지에 첨부가 있는가(요청을 보낼지) — 웹과 앱이 같은 규칙을 쓴다.
//   2) 돌아온 서명 URL 을 그려도 되는가 — 앱이 쓴다. 웹은 이 필터를 쓰지 않는다(동작 불변).
//
// 서명 URL 은 만료 전까지 누구나 열 수 있는 자격증명이다. 이 모듈은 URL 을 어디에도 남기지 않고,
// 호출부에는 개수만 돌려준다.

/** 서명 URL 을 받는 곳. 본문은 `{ messageId }` 하나뿐이다. */
export const CHAT_IMAGE_URLS_ENDPOINT = "/api/chat/image-urls";

/** 한 메시지에서 읽는 첨부 최대 개수. 서버 route 의 MAX_PATHS 와 같다. */
export const CHAT_IMAGE_MAX_ATTACHMENTS = 10;

/**
 * 클라이언트가 받은 서명 URL 을 다시 쓰는 시간. 서버 서명은 1시간이라, 끝나기 10분 전에
 * 새로 받는다 — 목록을 오르내리며 다시 그릴 때 만료 직전 URL 을 붙잡지 않는다.
 */
export const CHAT_IMAGE_CLIENT_REFRESH_TTL_MS = 50 * 60 * 1000;

/** 서명 URL 의 경로 머리. 다른 버킷이나 공개 경로는 그리지 않는다. */
export const CHAT_IMAGE_SIGNED_URL_PATH_PREFIX = "/storage/v1/object/sign/chat-image/";

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * 메시지 metadata 에서 첨부 참조를 읽는다. imagePaths 다음 legacy imageUrls 순서로,
 * 문자열만, 중복 없이, 최대 10개. `attachmentKey` 는 그 목록을 `|` 로 이은 안정적인 키다 —
 * 정상 자료(문자열 배열)에서는 웹이 예전에 인라인으로 만들던 키와 같다.
 */
export function getChatImageAttachmentRefs(metadata) {
  const record = isRecord(metadata) ? metadata : null;
  const paths = record && Array.isArray(record.imagePaths) ? record.imagePaths : [];
  const urls = record && Array.isArray(record.imageUrls) ? record.imageUrls : [];
  const refs = [];
  const seen = new Set();
  for (const value of [...paths, ...urls]) {
    if (typeof value !== "string" || seen.has(value)) continue;
    seen.add(value);
    refs.push(value);
    if (refs.length === CHAT_IMAGE_MAX_ATTACHMENTS) break;
  }
  return { refs, attachmentKey: refs.join("|") };
}

export function hasChatImageAttachments(metadata) {
  return getChatImageAttachmentRefs(metadata).refs.length > 0;
}

// 끝 슬래시·대소문자·경로가 붙은 설정값도 origin 으로 정규화한다. https 는 항목마다 따로 확인하므로,
// http 설정값이면 어떤 항목도 이 origin 과 같아질 수 없다.
function configuredOrigin(supabaseUrl) {
  if (typeof supabaseUrl !== "string" || supabaseUrl.length === 0) return null;
  try {
    return new URL(supabaseUrl).origin;
  } catch {
    return null;
  }
}

function acceptedSignedUrl(item, expectedOrigin) {
  if (expectedOrigin === null || !isRecord(item) || typeof item.signedUrl !== "string") return null;
  let url;
  try {
    url = new URL(item.signedUrl);
  } catch {
    return null;
  }
  if (
    url.protocol !== "https:"
    || url.origin !== expectedOrigin
    || url.username !== ""
    || url.password !== ""
    || !url.pathname.startsWith(CHAT_IMAGE_SIGNED_URL_PATH_PREFIX)
    || url.pathname.length === CHAT_IMAGE_SIGNED_URL_PATH_PREFIX.length
  ) {
    return null;
  }
  return url.href;
}

/**
 * image-urls 응답에서 그려도 되는 서명 URL 만 남긴다.
 *
 * - `urls` 가 배열이 아니거나 10개를 넘으면 응답 전체를 버린다(`malformed`). 서버는 10개를 넘겨 보내지 않는다.
 * - 항목마다 https 이고, `new URL(supabaseUrl).origin` 과 같은 origin 이고, 경로가
 *   `/storage/v1/object/sign/chat-image/` 로 시작하는 것만 남긴다. 설정값의 끝 슬래시·대소문자는 origin 으로 정규화된다.
 * - `received`·`rejected` 는 개수뿐이다. 받은 것이 있는데 모두 버렸다면 호출부가 그 개수로 진단을 남긴다 —
 *   출처 설정이 어긋나 사진이 조용히 사라지는 것을 알아채기 위해서다. URL·경로는 돌려주지 않는다.
 */
export function parseChatImageUrlsResponse(payload, { supabaseUrl }) {
  if (!isRecord(payload) || !Array.isArray(payload.urls)) {
    return { urls: [], received: 0, rejected: 0, malformed: true };
  }
  const received = payload.urls.length;
  if (received > CHAT_IMAGE_MAX_ATTACHMENTS) {
    return { urls: [], received, rejected: received, malformed: true };
  }
  const expectedOrigin = configuredOrigin(supabaseUrl);
  const urls = [];
  for (const item of payload.urls) {
    const accepted = acceptedSignedUrl(item, expectedOrigin);
    if (accepted !== null) urls.push(accepted);
  }
  return { urls, received, rejected: received - urls.length, malformed: false };
}
