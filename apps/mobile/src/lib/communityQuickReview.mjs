/**
 * 15초 후기 요청을 만드는 곳.
 *
 * 서버(`POST /api/community/posts` → `community_create_post_service`)가 요구하는 것:
 *   - `Idempotency-Key` 헤더(UUID). 없으면 본문을 읽기 전에 400 이다.
 *   - `ad_disclosure === "sponsored"` 이면 `sponsorship_detail` 을 앞뒤 공백 없이 5자 이상.
 *     서버·웹 모두 「협찬 내용을 5자 이상 입력해주세요.」 로 거절한다.
 *   - `tags` 는 문자열 배열(최대 10개). 웹 15초 후기는 고른 카테고리 하나를 싣는다.
 *   - `vendor_tags` 는 **등록된 업체의 UUID 배열**이다. 저장 RPC 가 UUID 가 아닌 값을
 *     `COMMUNITY_POST_PAYLOAD_INVALID` 로 거절한다. 15초 후기는 업체를 목록에서 고르지 않고
 *     이름을 적으므로 여기에 넣을 UUID 가 없다 — 이름은 제목(「○○ 후기」)으로만 간다.
 */

export const QUICK_REVIEW_SPONSORSHIP_DETAIL_MIN = 5;
export const QUICK_REVIEW_SPONSORSHIP_DETAIL_MAX = 500;
export const QUICK_REVIEW_SPONSORSHIP_DETAIL_ERROR = "협찬 내용을 5자 이상 입력해주세요.";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function isUuid(value) {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function isSponsored(draft) {
  return draft.adDisclosure === "sponsored";
}

/** 빠진 칸이 있으면 사용자에게 보여 줄 문장 하나, 없으면 null. */
export function validateQuickReviewDraft(draft) {
  if (!text(draft.vendorName)) return "업체명을 입력해주세요.";
  if (!text(draft.category)) return "카테고리를 선택해주세요.";
  if (!Number.isInteger(draft.rating) || draft.rating < 1 || draft.rating > 5) {
    return "별점을 선택해주세요.";
  }
  if (!text(draft.review)) return "한줄 후기를 입력해주세요.";
  if (
    isSponsored(draft)
    && text(draft.sponsorshipDetail).length < QUICK_REVIEW_SPONSORSHIP_DETAIL_MIN
  ) {
    return QUICK_REVIEW_SPONSORSHIP_DETAIL_ERROR;
  }
  return null;
}

/** 서버에 보낼 본문. 검사(`validateQuickReviewDraft`)를 통과한 초안에만 쓴다. */
export function buildQuickReviewPostBody(draft) {
  const body = {
    category: "tour_review",
    title: `${text(draft.vendorName)} 후기`,
    content: text(draft.review),
    visibility: "public",
    is_quick_review: true,
    rating: draft.rating,
    ad_disclosure: draft.adDisclosure,
    tags: [text(draft.category)],
    vendor_tags: [],
  };
  if (isSponsored(draft)) {
    body.sponsorship_detail = text(draft.sponsorshipDetail)
      .slice(0, QUICK_REVIEW_SPONSORSHIP_DETAIL_MAX);
  }
  return body;
}

/**
 * 같은 본문을 다시 보내면 같은 요청 키를 돌려준다.
 *
 * 응답만 잃고 글은 저장된 경우, 같은 키로 다시 보내면 서버가 저장된 결과를 그대로 돌려준다
 * (`community_replay_post_command_service`). 새 키로 보내면 같은 후기가 두 번 생긴다.
 */
export function createQuickReviewSubmission(createId) {
  if (typeof createId !== "function") {
    throw new Error("QUICK_REVIEW_IDEMPOTENCY_FACTORY_INVALID");
  }
  let current = null;
  return {
    commandFor(draft) {
      const body = buildQuickReviewPostBody(draft);
      const identity = JSON.stringify(body);
      if (current?.identity === identity) {
        return { idempotencyKey: current.key, body };
      }
      const key = createId();
      if (!isUuid(key)) throw new Error("QUICK_REVIEW_IDEMPOTENCY_KEY_INVALID");
      current = { identity, key: key.toLowerCase() };
      return { idempotencyKey: current.key, body };
    },
    clearIf(key) {
      if (!isUuid(key) || current?.key !== key.toLowerCase()) return false;
      current = null;
      return true;
    },
    clear() {
      current = null;
    },
  };
}

/** 서버 영수증(`{ post: { id } }`)에서 새 글 id 를 읽는다. 확인하지 못하면 null. */
export function readCreatedQuickReviewPostId(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const post = value.post;
  if (!post || typeof post !== "object" || Array.isArray(post)) return null;
  return isUuid(post.id) ? post.id : null;
}
