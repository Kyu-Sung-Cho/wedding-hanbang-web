/**
 * 웹 15초 후기 요청을 만드는 곳. 앱의 `apps/mobile/src/lib/communityQuickReview.mjs` 와 같은 규칙이다.
 *
 * 서버(`POST /api/community/posts` -> `community_create_post_service`)가 요구하는 것:
 *   - `Idempotency-Key` 헤더(UUID). 없으면 본문을 읽기 전에 400 이다.
 *   - `ad_disclosure === "sponsored"` 이면 `sponsorship_detail` 을 앞뒤 공백 없이 5자 이상.
 *     서버, 웹 모달, 앱 모두 "협찬 내용을 5자 이상 입력해주세요." 로 거절한다.
 *   - `vendor_tags` 는 **등록된 업체의 UUID 배열**이다. 저장 RPC 가 UUID 가 아닌 값을
 *     `COMMUNITY_POST_PAYLOAD_INVALID` 로 거절한다. 15초 후기는 업체를 목록에서 고르지 않고
 *     이름을 적으므로 넣을 UUID 가 없다. 이름은 제목("업체 이름 후기")으로만 간다.
 *
 * 2026-09-19 까지 웹 화면은 헤더 없이 보내고 업체 이름을 `vendor_tags` 에 넣어, 한 건도
 * 저장되지 않았다.
 */
import type { AdDisclosure } from "@/types/community.types";

export const QUICK_REVIEW_SPONSORSHIP_DETAIL_MIN = 5;
export const QUICK_REVIEW_SPONSORSHIP_DETAIL_MAX = 500;
export const QUICK_REVIEW_SPONSORSHIP_DETAIL_ERROR = "협찬 내용을 5자 이상 입력해주세요.";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export interface QuickReviewDraft {
  vendorName: string;
  category: string;
  rating: number;
  review: string;
  images: readonly string[];
  adDisclosure?: AdDisclosure;
  sponsorshipDetail?: string;
}

export interface QuickReviewPostBody {
  category: "tour_review";
  title: string;
  content: string;
  images: string[];
  visibility: "public";
  vendor_tags: string[];
  tags: string[];
  is_quick_review: true;
  rating: number;
  ad_disclosure: AdDisclosure | undefined;
  sponsorship_detail?: string;
}

export interface QuickReviewCommand {
  idempotencyKey: string;
  body: QuickReviewPostBody;
}

export interface QuickReviewSubmission {
  commandFor(draft: QuickReviewDraft): QuickReviewCommand;
  clear(): void;
}

function sponsorshipDetailOf(draft: QuickReviewDraft): string {
  return (draft.sponsorshipDetail ?? "").trim();
}

/**
 * 빠진 칸이 있으면 사용자에게 보여 줄 문장 하나, 없으면 null.
 * 광고 표시를 고르기 전(`adDisclosure` 없음)에는 입력 칸만 본다.
 */
export function validateQuickReviewDraft(draft: QuickReviewDraft): string | null {
  if (!draft.vendorName.trim()) return "업체명을 입력해주세요.";
  if (draft.rating < 1) return "별점을 선택해주세요.";
  if (!draft.review.trim()) return "한 줄 후기를 입력해주세요.";
  if (
    draft.adDisclosure === "sponsored"
    && sponsorshipDetailOf(draft).length < QUICK_REVIEW_SPONSORSHIP_DETAIL_MIN
  ) {
    return QUICK_REVIEW_SPONSORSHIP_DETAIL_ERROR;
  }
  return null;
}

/** 서버에 보낼 본문. 검사(`validateQuickReviewDraft`)를 통과한 초안에만 쓴다. */
export function buildQuickReviewPostBody(draft: QuickReviewDraft): QuickReviewPostBody {
  const body: QuickReviewPostBody = {
    category: "tour_review",
    title: `${draft.vendorName.trim()} 후기`,
    content: draft.review.trim(),
    images: [...draft.images],
    visibility: "public",
    vendor_tags: [],
    tags: [draft.category],
    is_quick_review: true,
    rating: draft.rating,
    ad_disclosure: draft.adDisclosure,
  };
  if (draft.adDisclosure === "sponsored") {
    body.sponsorship_detail = sponsorshipDetailOf(draft).slice(0, QUICK_REVIEW_SPONSORSHIP_DETAIL_MAX);
  }
  return body;
}

/**
 * 같은 본문을 다시 보내면 같은 요청 키를 돌려준다.
 *
 * 응답만 잃고 글은 저장된 경우, 같은 키로 다시 보내면 서버가 저장된 결과를 그대로 돌려준다
 * (`community_replay_post_command_service`). 새 키로 보내면 같은 후기가 두 번 생긴다.
 *
 * 그래서 확인되지 않은 본문마다 처음 붙인 키를 모두 기억한다. 마지막 본문 하나만 기억하면
 * 고쳤다가 되돌린 본문이 새 키를 받는다(2026-09-19 리뷰, 실제 SQL 로 중복 글).
 * 본문이 다르면 다른 요청이므로 새 키를 쓴다. 새 글 id 를 확인한 뒤에만 `clear()` 로 모두 버린다.
 *
 * 기억은 이 객체, 곧 화면 하나가 떠 있는 동안만 산다. 새로고침하거나 화면을 떠났다 오면 없다.
 * 화면 문구(QUICK_REVIEW_CONNECTION_LOST_MESSAGE)는 그 범위만큼만 약속한다.
 */
export function createQuickReviewSubmission(createId: () => string): QuickReviewSubmission {
  const keysByBody = new Map<string, string>();
  return {
    commandFor(draft) {
      const body = buildQuickReviewPostBody(draft);
      const identity = JSON.stringify(body);
      const known = keysByBody.get(identity);
      if (known) return { idempotencyKey: known, body };
      const key = createId();
      if (!UUID_PATTERN.test(key)) throw new Error("QUICK_REVIEW_IDEMPOTENCY_KEY_INVALID");
      const idempotencyKey = key.toLowerCase();
      keysByBody.set(identity, idempotencyKey);
      return { idempotencyKey, body };
    },
    clear() {
      keysByBody.clear();
    },
  };
}

// ── 응답 읽기 ────────────────────────────────────────────────────────────────
//
// 브라우저의 영어 오류("Failed to fetch", JSON SyntaxError)나 서버의 영어 문장("Forbidden")을
// 그대로 보이지 않는다. 약속은 지킬 수 있는 만큼만 한다. 같은 본문은 같은 요청 키로 가지만,
// 그 키는 이 화면이 떠 있는 동안만 있다.

/** fetch 가 거절됐다. 서버에 닿았는지 모른다. */
export const QUICK_REVIEW_CONNECTION_LOST_MESSAGE =
  "연결이 끊겼어요. 이 화면에서 그대로 다시 보내도 후기가 두 번 올라가지 않아요.";
/**
 * 서버가 응답했지만 새 글 id 도, 읽을 한국어 문장도 없다(201 인데 영수증이 없음, HTML 오류 페이지,
 * 문장 없는 JSON, 영어 문장). 저장됐을 수도 있으므로 실패했다고 말하지 않는다.
 * 앱(apps/mobile/app/community/quick-review.tsx)과 같은 문장이다.
 */
export const QUICK_REVIEW_RECEIPT_MISSING_MESSAGE =
  "후기가 저장됐는지 확인하지 못했어요. 내용을 그대로 두었으니 다시 올려 주세요.";
/** 401. 로그인하러 다녀오면 쓴 내용은 남지 않으므로 이어서 올릴 수 있다고 말하지 않는다. */
export const QUICK_REVIEW_LOGIN_REQUIRED_MESSAGE = "로그인하면 후기를 올릴 수 있어요.";

/** 한글이 하나라도 있으면 우리가 쓴 문장으로 본다. 앱의 `toKoreanErrorMessage` 와 같은 기준이다. */
const HANGUL = /[가-힣]/u;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 서버 영수증에서 새 글 id 를 읽는다. UUID 가 아니면 null. 앱의 `readCreatedQuickReviewPostId` 와 같다.
 * null 이면 등록됐다고 말하지 않는다. 저장됐을 수 있으므로 요청 키도 버리지 않는다.
 */
export function readCreatedQuickReviewPostId(value: unknown): string | null {
  if (!isPlainObject(value)) return null;
  const post = value.post;
  if (!isPlainObject(post)) return null;
  return typeof post.id === "string" && UUID_PATTERN.test(post.id) ? post.id : null;
}

/**
 * 서버가 응답했지만 실패했을 때(401 제외) 보여 줄 문장. 본문이 JSON 이 아니면 payload 는 null.
 * 서버 문장은 한글이 있을 때만 그대로 쓴다. 없으면 저장됐는지 모른다는 고정 문장이다.
 */
export function quickReviewFailureMessage(payload: unknown): string {
  if (isPlainObject(payload) && typeof payload.error === "string" && HANGUL.test(payload.error)) {
    return payload.error.trim();
  }
  return QUICK_REVIEW_RECEIPT_MISSING_MESSAGE;
}
