// 채팅에서 받은/보낸 사진 보기 — 보내기는 하지 않는다(2026-09-18, wave 2 · 2.5a).
//
// 웹에서 사진만 보내면 "파일을 보냈어요. 확인해줘." 가 붙은 사람 메시지가 생기고, 사진 경로는
// metadata.imagePaths 에 남는다. 앱은 그 경로를 직접 읽지 않는다(비공개 버킷이다). 웹 ChatBubble 과
// 같이 POST /api/chat/image-urls 에 메시지 id 만 보내고, 서버가 요청자 권한(RLS)으로 그 메시지를
// 읽은 뒤 만든 1시간짜리 서명 URL 로만 그린다.
//
// 이 모듈이 지는 것:
// - 요청 대상 판정: 사람이 보낸 메시지(내 것·상대 것)이고, 서버가 받는 UUID id 이고, 첨부가 있을 때만.
//   아모라 메시지·pinned 안전 카드·temp_ 같은 임시 id 에는 요청하지 않는다.
// - 메시지별 캐시: 키에 채팅 화면의 세션 세대·소유자·메시지·첨부 키가 들어간다. 갱신 TTL(50분) 안에는
//   다시 묻지 않고, 동시에 붙으면 요청 하나를 나눈다. Android 는 목록을 오르내리면 행을 다시 마운트하는데,
//   서버는 사용자당 분당 60회로 막는다.
// - 사진이 onError 를 내면 정확히 한 번 새로 받고, 그래도 안 되면 오류 상태다(재시도는 사람이 누를 때만).
// - 세션 세대가 바뀌면(로그아웃·계정 전환·다시 불러오기) 캐시를 비우고, 이전 세대에서 시작한 요청의
//   결과는 버린다.
//
// 서명 URL 은 만료 전까지 누구나 열 수 있는 자격증명이다. console·진단·Sentry 로 보내지 않는다.
// 진단은 개수만 담는다.
/* global console */
import {
  CHAT_IMAGE_CLIENT_REFRESH_TTL_MS,
  CHAT_IMAGE_URLS_ENDPOINT,
  getChatImageAttachmentRefs,
  parseChatImageUrlsResponse,
} from "@hanbang/shared/chat-image-attachments";

export const CHAT_IMAGE_ATTACHMENT_COPY = Object.freeze({
  loadFailed: "사진을 불러오지 못했어요",
  retry: "다시 시도",
  retryAccessibilityLabel: "첨부 사진 다시 불러오기",
  loadingAccessibilityLabel: "첨부 사진 불러오는 중",
  openAccessibilityHint: "크게 보기",
  closeAccessibilityLabel: "사진 보기 닫기",
});

/** 썸네일과 보기 창이 함께 쓰는 이름. N 은 1부터다. */
export function chatImageAttachmentLabel(index) {
  return `첨부 사진 ${index + 1}`;
}

/** 썸네일 사이 간격. */
export const CHAT_IMAGE_THUMBNAIL_GAP = 6;

/**
 * 썸네일 한 변. 한 장이면 크게, 여러 장이면 두 칸씩 놓는다. 320pt 화면의 말풍선 폭(78%, 약 224pt) 안에
 * 들어가고, 불러오는 동안의 자리표시도 같은 크기라 뒤집힌 목록이 튀지 않는다.
 */
export function chatImageThumbnailSize(count) {
  return count === 1 ? 168 : 104;
}

/** 서버 image-urls route 의 UUID 규칙과 같다 — 서버가 400 을 돌려줄 id 로는 묻지 않는다. */
export const CHAT_MESSAGE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** 이 메시지에 사진을 붙일지, 붙인다면 무엇으로 물을지. 붙이지 않으면 null. */
export function getChatImageAttachmentTarget(message) {
  if (!isRecord(message)) return null;
  if (message.sender_type !== "bride" && message.sender_type !== "groom") return null;
  if (typeof message.id !== "string" || !CHAT_MESSAGE_ID_PATTERN.test(message.id)) return null;
  const metadata = isRecord(message.metadata) ? message.metadata : null;
  if (metadata?.pinned_safety_card === true) return null;
  const { refs, attachmentKey } = getChatImageAttachmentRefs(metadata);
  if (refs.length === 0) return null;
  return { messageId: message.id, attachmentKey, count: refs.length };
}

export const CHAT_IMAGE_DIAGNOSTIC_CODE = "CHAT_IMAGE_URLS_REJECTED";

/**
 * 기본 진단. 서버가 URL 을 보냈는데 출처 확인에서 버렸거나 응답 모양이 틀렸을 때 남긴다 —
 * 출처 설정이 어긋나 사진이 조용히 사라지는 것을 알아채기 위해서다. 개수만 담는다.
 */
export function reportChatImageDiagnostic({ received, accepted, rejected, malformed }) {
  console.warn(CHAT_IMAGE_DIAGNOSTIC_CODE, { received, accepted, rejected, malformed });
}

const IDLE = Object.freeze({ status: "idle", urls: Object.freeze([]) });
const LOADING = Object.freeze({ status: "loading", urls: Object.freeze([]) });
const EMPTY = Object.freeze({ status: "empty", urls: Object.freeze([]) });
const ERROR = Object.freeze({ status: "error", urls: Object.freeze([]) });

export function createChatImageAttachmentStore({
  request,
  supabaseUrl,
  now = () => Date.now(),
  reportDiagnostic = reportChatImageDiagnostic,
}) {
  let currentGeneration = null;
  const entries = new Map();
  const listeners = new Set();

  const notify = () => {
    for (const listener of [...listeners]) listener();
  };

  const keyOf = ({ generation, ownerId, messageId, attachmentKey }) =>
    JSON.stringify([generation, ownerId, messageId, attachmentKey]);

  // 더 높은 세대를 처음 보면 그 세대로 옮기며 캐시를 비운다. 낮은 세대는 지난 세션이다.
  function acceptGeneration(generation) {
    if (typeof generation !== "number") return false;
    if (currentGeneration === generation) return true;
    if (currentGeneration !== null && generation < currentGeneration) return false;
    currentGeneration = generation;
    if (entries.size > 0) {
      entries.clear();
      notify();
    }
    return true;
  }

  async function requestSignedUrls(ownerId, messageId) {
    let response;
    try {
      response = await request(ownerId, CHAT_IMAGE_URLS_ENDPOINT, {
        method: "POST",
        body: JSON.stringify({ messageId }),
      });
    } catch {
      return ERROR;
    }
    // 서버가 이 메시지를 보여주지 않는다(상대의 비공개 대화 등) — 빈 틀도 그리지 않는다.
    if (response.status === 404) return EMPTY;
    if (!response.ok) return ERROR;
    let payload;
    try {
      payload = await response.json();
    } catch {
      return ERROR;
    }
    const parsed = parseChatImageUrlsResponse(payload, { supabaseUrl });
    if (parsed.malformed || parsed.rejected > 0) {
      reportDiagnostic({
        received: parsed.received,
        accepted: parsed.urls.length,
        rejected: parsed.rejected,
        malformed: parsed.malformed,
      });
    }
    if (parsed.malformed) return ERROR;
    if (parsed.urls.length > 0) return Object.freeze({ status: "ready", urls: Object.freeze([...parsed.urls]) });
    // 받은 것이 있는데 모두 버렸다면 "사진 없음"이 아니라 "못 불러옴"이다.
    return parsed.received > 0 ? ERROR : EMPTY;
  }

  function start(key, params, imageRetryUsed) {
    const entry = { snapshot: LOADING, fetchedAt: 0, imageRetryUsed, inflight: null };
    entries.set(key, entry);
    entry.inflight = requestSignedUrls(params.ownerId, params.messageId).then((snapshot) => {
      // 그사이 세대가 바뀌어 캐시가 비었거나(reset·더 높은 세대) 이 칸이 새 요청으로 바뀌었으면 결과를 버린다.
      // 캐시에는 지금 세대의 칸만 있으므로, 칸이 그대로라는 것이 곧 같은 세대라는 뜻이다.
      if (entries.get(key) !== entry) return;
      entry.inflight = null;
      entry.fetchedAt = now();
      entry.snapshot = snapshot;
      notify();
    });
    notify();
    return entry.inflight;
  }

  function isCurrent(params) {
    return typeof params.ownerId === "string"
      && params.ownerId.length > 0
      && currentGeneration !== null
      && params.generation === currentGeneration;
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot(params) {
      // 키에 세대가 들어 있고 캐시는 세대가 바뀔 때 비워지므로, 지난 세대로 물으면 늘 비어 있다.
      return entries.get(keyOf(params))?.snapshot ?? IDLE;
    },
    /** 마운트될 때 부른다. 캐시가 신선하면 요청하지 않고, 진행 중이면 그 요청을 돌려준다. */
    load(params) {
      if (typeof params.ownerId !== "string" || params.ownerId.length === 0) return undefined;
      if (!acceptGeneration(params.generation)) return undefined;
      const key = keyOf(params);
      const existing = entries.get(key);
      if (existing) {
        if (existing.inflight) return existing.inflight;
        // 오류는 사람이 재시도를 누를 때만 다시 묻는다.
        if (existing.snapshot === ERROR) return undefined;
        if (now() - existing.fetchedAt < CHAT_IMAGE_CLIENT_REFRESH_TTL_MS) return undefined;
      }
      return start(key, params, false);
    },
    /** 사람이 누른 재시도. 새 한 바퀴라 자동 재요청 한 번을 다시 갖는다. */
    retry(params) {
      if (!isCurrent(params)) return undefined;
      const key = keyOf(params);
      const existing = entries.get(key);
      if (existing?.inflight) return existing.inflight;
      return start(key, params, false);
    },
    /** 그려 둔 사진이 onError 를 냈다. 처음이면 한 번 새로 받고, 두 번째면 오류다. */
    reportImageError(params, url) {
      if (!isCurrent(params)) return;
      const key = keyOf(params);
      const entry = entries.get(key);
      // 다시 받는 중이면 칸은 loading 이라 여기서 멈춘다 — 같은 메시지의 다른 사진이 함께 실패해도 한 번만 묻는다.
      if (!entry || entry.snapshot.status !== "ready") return;
      // 새로 받기 전 URL 의 늦은 onError 는 지금 사진과 상관없다.
      if (!entry.snapshot.urls.includes(url)) return;
      if (entry.imageRetryUsed) {
        entry.snapshot = ERROR;
        notify();
        return;
      }
      void start(key, params, true);
    },
    /** 채팅 화면의 세션 세대가 바뀔 때(로그아웃·계정 전환·다시 불러오기·화면 닫힘) 부른다. */
    reset(generation) {
      currentGeneration = generation;
      entries.clear();
      notify();
    },
  };
}
