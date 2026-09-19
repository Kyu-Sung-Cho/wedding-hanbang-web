// @vitest-environment node

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import * as quickReview from "./quickReviewSubmission";

/**
 * 웹 15초 후기. "후기 등록"이 실제로 글이 되는가.
 *
 * 확인한 것(2026-09-19, e05c0a0e):
 *   - 웹 화면은 `Idempotency-Key` 헤더 없이 보냈다. 서버(`POST /api/community/posts`)는 헤더가
 *     UUID 가 아니면 **본문을 읽기도 전에** 400 `COMMUNITY_POST_IDEMPOTENCY_REQUIRED` 를 낸다.
 *     웹의 15초 후기는 한 건도 저장되지 않았다.
 *   - 헤더가 있었어도 `vendor_tags: [업체 이름]` 이 저장 RPC 의 UUID 검사에 걸려
 *     `COMMUNITY_POST_PAYLOAD_INVALID` -> 503 "같은 내용으로 다시 시도해 주세요"가 된다.
 *     같은 내용으로 다시 보내도 영원히 같은 답이다.
 *   - 앱은 같은 두 문제를 `apps/mobile/src/lib/communityQuickReview.mjs` 에서 먼저 고쳤다.
 *     여기 규칙은 그쪽과 같다.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SERVER_SPONSOR_ERROR = "협찬 내용을 5자 이상 입력해주세요.";

/** vitest 는 apps/web 에서 돈다. */
function readFromWeb(relative: string): string {
  return readFileSync(path.resolve(process.cwd(), relative), "utf8");
}

const baseDraft: quickReview.QuickReviewDraft = {
  vendorName: "  라벨르 스튜디오 ",
  category: "studio",
  rating: 4,
  review: " 실장님이 친절해요 ",
  images: [],
  adDisclosure: "general",
};

const expectedGeneralBody = {
  category: "tour_review",
  title: "라벨르 스튜디오 후기",
  content: "실장님이 친절해요",
  images: [],
  visibility: "public",
  vendor_tags: [],
  tags: ["studio"],
  is_quick_review: true,
  rating: 4,
  ad_disclosure: "general",
};

describe("15초 후기 요청 본문", () => {
  it("서버 계약과 같다. 업체 이름은 제목에만 가고 vendor_tags 는 비운다", () => {
    const body = quickReview.buildQuickReviewPostBody(baseDraft);
    expect(body).toStrictEqual(expectedGeneralBody);
    expect(Object.hasOwn(body, "sponsorship_detail"), "일반 글에 협찬 내용 칸을 싣지 않는다").toBe(false);
    expect(JSON.stringify(body).split("라벨르 스튜디오").length - 1, "업체 이름은 제목에 한 번만").toBe(1);
  });

  it("vendor_tags 는 저장 RPC 가 받는 업체 UUID 만 담는다. 서버 SQL 계약과 맞춰 본다", () => {
    const sql = readFromWeb(
      "../../supabase/migrations/20260804200000_community_post_service_write_boundary.sql",
    );
    // 이 검사가 SQL 에서 빠지면 이 테스트의 전제가 바뀐 것이다. 그때 다시 판단한다.
    expect(sql).toMatch(/p_payload -> 'vendor_tags'[\s\S]{0,400}\[0-9a-f\]\{8\}-/u);
    for (const vendorName of ["라벨르 스튜디오", "Studio A", "a", "11111111-1111-4111-8111-111111111111 후기"]) {
      const body = quickReview.buildQuickReviewPostBody({ ...baseDraft, vendorName });
      expect(body.vendor_tags, vendorName).toStrictEqual([]);
      for (const tag of body.vendor_tags) expect(tag).toMatch(UUID);
    }
  });

  it("협찬이면 앞뒤 공백을 걷은 협찬 내용을 싣고, 일반으로 되돌리면 싣지 않는다", () => {
    const sponsored = quickReview.buildQuickReviewPostBody({
      ...baseDraft,
      adDisclosure: "sponsored",
      sponsorshipDetail: "  드레스 대여비 1회 제공  ",
    });
    expect(sponsored).toStrictEqual({
      ...expectedGeneralBody,
      ad_disclosure: "sponsored",
      sponsorship_detail: "드레스 대여비 1회 제공",
    });

    const long = quickReview.buildQuickReviewPostBody({
      ...baseDraft,
      adDisclosure: "sponsored",
      sponsorshipDetail: "가".repeat(600),
    });
    expect(long.sponsorship_detail, "서버는 500자에서 자른다").toHaveLength(500);

    const switchedBack = quickReview.buildQuickReviewPostBody({
      ...baseDraft,
      adDisclosure: "general",
      sponsorshipDetail: "드레스 대여비 1회 제공",
    });
    expect(Object.hasOwn(switchedBack, "sponsorship_detail")).toBe(false);
  });
});

describe("15초 후기 입력 검사", () => {
  it("협찬은 5자 이상. 서버, 웹 모달, 앱과 같은 규칙, 같은 문구", () => {
    const server = readFromWeb("src/app/api/community/posts/route.ts");
    const modal = readFromWeb("src/components/community/AdDisclosureModal.tsx");
    const mobile = readFromWeb("../mobile/src/lib/communityQuickReview.mjs");
    expect(server.includes(SERVER_SPONSOR_ERROR), "서버 문구가 바뀌었다").toBe(true);
    expect(modal.includes(SERVER_SPONSOR_ERROR), "웹 모달 문구가 바뀌었다").toBe(true);
    expect(mobile.includes(SERVER_SPONSOR_ERROR), "앱 문구가 바뀌었다").toBe(true);
    // 서버 규칙: 앞뒤 공백을 걷은 길이가 5 미만이면 거절(`d.length < 5`, SQL 은 btrim).
    expect(server).toMatch(/d\.length < 5/u);
    expect(quickReview.QUICK_REVIEW_SPONSORSHIP_DETAIL_ERROR).toBe(SERVER_SPONSOR_ERROR);
    expect(quickReview.QUICK_REVIEW_SPONSORSHIP_DETAIL_MIN).toBe(5);

    const sponsored = { ...baseDraft, adDisclosure: "sponsored" as const };
    for (const detail of [undefined, "", "    ", "무료", "abcd", "  abcd  ", "\n무료\t"]) {
      expect(
        quickReview.validateQuickReviewDraft({ ...sponsored, sponsorshipDetail: detail }),
        JSON.stringify(detail),
      ).toBe(SERVER_SPONSOR_ERROR);
    }
    expect(quickReview.validateQuickReviewDraft({ ...sponsored, sponsorshipDetail: " abcde " })).toBeNull();
    expect(quickReview.validateQuickReviewDraft({ ...sponsored, sponsorshipDetail: "1회 무료" })).toBeNull();
    // 일반과 광고는 협찬 내용이 없어도 된다.
    expect(quickReview.validateQuickReviewDraft(baseDraft)).toBeNull();
    expect(quickReview.validateQuickReviewDraft({ ...baseDraft, adDisclosure: "ad" })).toBeNull();
  });

  it("빠진 칸은 화면 순서대로 한 가지만 알린다. 광고 표시를 고르기 전에도 같은 검사를 쓴다", () => {
    const fieldsOnly = { ...baseDraft, adDisclosure: undefined };
    expect(quickReview.validateQuickReviewDraft(fieldsOnly)).toBeNull();
    expect(quickReview.validateQuickReviewDraft({ ...fieldsOnly, vendorName: "  " })).toBe("업체명을 입력해주세요.");
    expect(quickReview.validateQuickReviewDraft({ ...fieldsOnly, rating: 0 })).toBe("별점을 선택해주세요.");
    expect(quickReview.validateQuickReviewDraft({ ...fieldsOnly, review: " " })).toBe("한 줄 후기를 입력해주세요.");
  });
});

describe("15초 후기 요청 키", () => {
  const ids = [
    "11111111-1111-4111-8111-111111111111",
    "22222222-2222-4222-8222-222222222222",
    "33333333-3333-4333-8333-333333333333",
  ];

  it("같은 본문을 다시 보내면 같은 키, 본문이 바뀌면 새 키. 응답을 잃어도 글이 두 번 생기지 않는다", () => {
    let n = 0;
    const submission = quickReview.createQuickReviewSubmission(() => ids[n++]);
    const first = submission.commandFor(baseDraft);
    expect(first.idempotencyKey).toMatch(UUID);
    expect(first.body).toStrictEqual(expectedGeneralBody);

    // 실패 뒤 같은 내용으로 다시 누른 경우. 새 객체여도 본문이 같으면 같은 요청이다.
    expect(submission.commandFor({ ...baseDraft }).idempotencyKey).toBe(first.idempotencyKey);
    // 앞뒤 공백만 다른 입력은 서버에 가는 본문이 같으므로 같은 요청이다.
    expect(submission.commandFor({ ...baseDraft, review: "실장님이 친절해요" }).idempotencyKey)
      .toBe(first.idempotencyKey);

    const changed = submission.commandFor({ ...baseDraft, review: "다른 후기" });
    expect(changed.idempotencyKey, "내용이 바뀌면 새 요청이다").not.toBe(first.idempotencyKey);
    expect(changed.idempotencyKey).toMatch(UUID);

    // 저장이 끝나면 키를 버린다. 같은 내용을 한 번 더 올리는 것은 새 글이다.
    submission.clear();
    expect(submission.commandFor({ ...baseDraft, review: "다른 후기" }).idempotencyKey)
      .not.toBe(changed.idempotencyKey);
  });

  it("고쳤다가 되돌린 본문은 처음 키로 간다. 새 글 id 를 확인하기 전까지 모든 본문의 키를 기억한다", () => {
    // 2026-09-19 리뷰: 응답을 모두 잃은 채 스튜디오, 드레스, 다시 스튜디오로 보내면 세 번째가
    // 새 키였다. 실제 SQL 로 3행, 스튜디오 후기가 두 개 생겼다.
    let n = 0;
    const submission = quickReview.createQuickReviewSubmission(() => ids[n++]);
    const studio = submission.commandFor(baseDraft);
    const dress = submission.commandFor({ ...baseDraft, category: "dress" });
    expect(dress.idempotencyKey).not.toBe(studio.idempotencyKey);

    const studioAgain = submission.commandFor({ ...baseDraft });
    expect(studioAgain.idempotencyKey, "되돌린 본문이 새 키를 받으면 같은 후기가 두 번 생긴다")
      .toBe(studio.idempotencyKey);
    expect(JSON.stringify(studioAgain.body)).toBe(JSON.stringify(studio.body));
    expect(submission.commandFor({ ...baseDraft, category: "dress" }).idempotencyKey).toBe(dress.idempotencyKey);
    expect(n, "키는 본문마다 한 번만 만든다").toBe(2);

    // 새 글 id 를 확인한 뒤에만 비운다. 그 뒤 같은 내용은 새 글이다.
    submission.clear();
    const fresh = submission.commandFor(baseDraft);
    expect(fresh.idempotencyKey).toBe(ids[2]);
    expect(fresh.idempotencyKey).not.toBe(studio.idempotencyKey);
  });

  it("UUID 가 아닌 키는 보내지 않는다", () => {
    expect(() => quickReview.createQuickReviewSubmission(() => "not-a-uuid").commandFor(baseDraft))
      .toThrow();
  });
});

describe("15초 후기 응답 읽기", () => {
  const POST_ID = "5b0c3d2e-1f4a-4b6c-8d7e-9f0a1b2c3d4e";

  it("새 글 id 는 서버 영수증에 UUID 로 있을 때만 믿는다. 앱의 readCreatedQuickReviewPostId 와 같다", () => {
    expect(quickReview.readCreatedQuickReviewPostId({ post: { id: POST_ID }, poll_id: null, post_count: 1 }))
      .toBe(POST_ID);
    for (const value of [
      null, undefined, "", 201, [], {}, { post: null }, { post: [] }, { post: {} },
      { post: { id: "" } }, { post: { id: "not-a-uuid" } }, { post: { id: 42 } }, { id: POST_ID },
    ]) {
      expect(quickReview.readCreatedQuickReviewPostId(value), JSON.stringify(value)).toBeNull();
    }
  });

  it("서버가 준 문장은 한글이 있을 때만 그대로 쓴다. 앱의 toKoreanErrorMessage 와 같은 규칙이다", () => {
    const serverText = "게시글을 안전하게 저장하지 못했습니다. 같은 내용으로 다시 시도해 주세요.";
    expect(quickReview.quickReviewFailureMessage({ code: "COMMUNITY_POST_SAVE_FAILED", error: serverText }))
      .toBe(serverText);
    expect(quickReview.quickReviewFailureMessage({ error: "  협찬 내용을 5자 이상 입력해주세요. " }))
      .toBe("협찬 내용을 5자 이상 입력해주세요.");
    // 서버는 응답했지만 읽을 한국어 문장이 없다. HTML 오류 페이지(JSON 이 아님), 문장 없는 JSON,
    // 같은 출처 검사의 영어 "Forbidden"(route.ts). 저장됐는지 모르므로 앱과 같은 문장으로 말한다.
    for (const payload of [
      null, undefined, {}, { error: "" }, { error: "   " }, { error: 503 }, "An error occurred", [],
      { error: "Forbidden" }, { error: "Internal Server Error" }, { error: "🙏 ..." },
    ]) {
      expect(quickReview.quickReviewFailureMessage(payload), JSON.stringify(payload))
        .toBe(quickReview.QUICK_REVIEW_RECEIPT_MISSING_MESSAGE);
    }
  });

  it("화면에 나가는 고정 문장은 한국어 입말이다. 영어, 줄표, 시스템 말투가 없다", () => {
    const fixed = [
      quickReview.QUICK_REVIEW_CONNECTION_LOST_MESSAGE,
      quickReview.QUICK_REVIEW_RECEIPT_MISSING_MESSAGE,
      quickReview.QUICK_REVIEW_LOGIN_REQUIRED_MESSAGE,
    ];
    for (const message of fixed) {
      expect(message, message).not.toMatch(/[A-Za-z]/u);
      expect(message, message).not.toMatch(/[-‐-―−~]/u);
      expect(message, message).not.toMatch(/습니다|오류가 발생/u);
      expect(message, message).toMatch(/요\.$/u);
    }
    // 다시 보내도 두 번 올라가지 않는다는 말은 지킬 수 있는 만큼만 한다. 키는 이 화면 안에만
    // 있으므로 새로고침하거나 화면을 떠나 다시 쓰면 지킬 수 없다. 올라간다고 약속하지도 않는다.
    expect(quickReview.QUICK_REVIEW_CONNECTION_LOST_MESSAGE)
      .toBe("연결이 끊겼어요. 이 화면에서 그대로 다시 보내도 후기가 두 번 올라가지 않아요.");
    // 로그인하러 다녀오면 쓴 내용이 남지 않는다. 이어서 올릴 수 있다고 말하지 않는다.
    expect(quickReview.QUICK_REVIEW_LOGIN_REQUIRED_MESSAGE).toBe("로그인하면 후기를 올릴 수 있어요.");
    expect(
      Object.keys(quickReview).filter((name) => /LOGIN_RESUME|DRAFT_STORAGE|DRAFT_MAX_AGE|DraftForLogin|KeptQuickReviewDraft/u.test(name)),
      "쓴 후기를 로그인 너머로 남기는 길은 없앴다(중복 글, 공용 탭의 다른 계정, 조용한 만료)",
    ).toStrictEqual([]);
    // 앱과 같은 문장이다(apps/mobile/app/community/quick-review.tsx).
    const mobileScreen = readFromWeb("../mobile/app/community/quick-review.tsx");
    expect(mobileScreen).toContain(quickReview.QUICK_REVIEW_RECEIPT_MISSING_MESSAGE);
  });
});
