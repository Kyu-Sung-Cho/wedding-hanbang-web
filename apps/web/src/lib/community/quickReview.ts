/**
 * 15초 후기 요청을 만드는 곳. 앱 쪽 짝은 `apps/mobile/src/lib/communityQuickReview.mjs`.
 *
 * 서버(`POST /api/community/posts` → `community_create_post_service`)가 요구하는 것:
 *   - `Idempotency-Key` 헤더(UUID). 없으면 본문을 읽기 전에 400 이다.
 *   - `ad_disclosure === "sponsored"` 이면 `sponsorship_detail` 을 정리(`sanitizeText`)한 뒤
 *     5자 이상. 서버와 같은 정리를 거쳐 재므로 화면이 통과시킨 값을 서버가 거절하지 않는다.
 *   - `vendor_tags` 는 **등록된 업체의 UUID 배열**이다. 저장 RPC 가 UUID 가 아닌 값을
 *     `COMMUNITY_POST_PAYLOAD_INVALID` 로 거절한다. 15초 후기는 업체를 목록에서 고르지 않고
 *     이름을 적으므로 여기에 넣을 UUID 가 없다 — 이름은 제목(「○○ 후기」)으로만 간다.
 */

import type { AdDisclosure } from "@/types/community.types";
import { isRecord, isUuid } from "@/utils/requestValidation";
import { sanitizeText } from "@/utils/sanitize";

export const QUICK_REVIEW_SPONSORSHIP_DETAIL_MIN = 5;
export const QUICK_REVIEW_SPONSORSHIP_DETAIL_MAX = 500;
export const QUICK_REVIEW_SPONSORSHIP_DETAIL_ERROR = "협찬 내용을 5자 이상 입력해주세요.";

export type QuickReviewDraft = {
  vendorName: string;
  category: string;
  rating: number;
  review: string;
  images: string[];
  adDisclosure: AdDisclosure;
  sponsorshipDetail?: string;
};

export type QuickReviewPostBody = {
  category: "tour_review";
  title: string;
  content: string;
  images: string[];
  visibility: "public";
  is_quick_review: true;
  rating: number;
  ad_disclosure: AdDisclosure;
  tags: string[];
  vendor_tags: string[];
  sponsorship_detail?: string;
};

export type QuickReviewCommand = {
  idempotencyKey: string;
  body: QuickReviewPostBody;
};

function sponsorshipDetailOf(draft: Pick<QuickReviewDraft, "sponsorshipDetail">): string {
  return sanitizeText(draft.sponsorshipDetail ?? "").slice(0, QUICK_REVIEW_SPONSORSHIP_DETAIL_MAX);
}

/** 광고 표시를 고르기 전 칸. 빠진 칸이 있으면 보여 줄 문장 하나, 없으면 null. */
export function validateQuickReviewContent(
  draft: Pick<QuickReviewDraft, "vendorName" | "rating" | "review">,
): string | null {
  if (!draft.vendorName.trim()) return "업체명을 입력해주세요.";
  if (!Number.isInteger(draft.rating) || draft.rating < 1 || draft.rating > 5) {
    return "별점을 선택해주세요.";
  }
  if (!draft.review.trim()) return "한 줄 후기를 입력해주세요.";
  return null;
}

/** 서버와 같은 기준으로 협찬 내용을 잰다. */
export function validateQuickReviewDisclosure(
  draft: Pick<QuickReviewDraft, "adDisclosure" | "sponsorshipDetail">,
): string | null {
  if (
    draft.adDisclosure === "sponsored"
    && sponsorshipDetailOf(draft).length < QUICK_REVIEW_SPONSORSHIP_DETAIL_MIN
  ) {
    return QUICK_REVIEW_SPONSORSHIP_DETAIL_ERROR;
  }
  return null;
}

/** 서버에 보낼 본문. 위의 두 검사를 통과한 초안에만 쓴다. */
export function buildQuickReviewPostBody(draft: QuickReviewDraft): QuickReviewPostBody {
  const body: QuickReviewPostBody = {
    category: "tour_review",
    title: `${draft.vendorName.trim()} 후기`,
    content: draft.review.trim(),
    images: draft.images,
    visibility: "public",
    is_quick_review: true,
    rating: draft.rating,
    ad_disclosure: draft.adDisclosure,
    tags: [draft.category],
    vendor_tags: [],
  };
  if (draft.adDisclosure === "sponsored") {
    body.sponsorship_detail = sponsorshipDetailOf(draft);
  }
  return body;
}

/**
 * 같은 본문을 다시 보내면 같은 요청 키를 돌려준다.
 *
 * 응답만 잃고 글은 저장된 경우, 같은 키로 다시 보내면 서버가 저장된 결과를 그대로 돌려준다
 * (`community_replay_post_command_service`). 새 키로 보내면 같은 후기가 두 번 생긴다.
 */
export function createQuickReviewSubmission(createId: () => string) {
  let current: { identity: string; key: string } | null = null;
  return {
    commandFor(draft: QuickReviewDraft): QuickReviewCommand {
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
    clearIf(key: string): boolean {
      if (current?.key !== key.toLowerCase()) return false;
      current = null;
      return true;
    },
  };
}

/** 서버 영수증(`{ post: { id } }`)에서 새 글 id 를 읽는다. 확인하지 못하면 null. */
export function readCreatedQuickReviewPostId(value: unknown): string | null {
  if (!isRecord(value) || !isRecord(value.post)) return null;
  return isUuid(value.post.id) ? value.post.id : null;
}

/** 서버가 준 사용자용 문장. 없으면 null — 그때는 화면이 자기 문장을 쓴다. */
export function readQuickReviewServerError(value: unknown): string | null {
  if (!isRecord(value)) return null;
  return typeof value.error === "string" && value.error.trim() ? value.error : null;
}
