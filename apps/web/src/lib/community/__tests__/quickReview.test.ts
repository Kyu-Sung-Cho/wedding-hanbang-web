import { describe, expect, it } from "vitest";
import {
  QUICK_REVIEW_SPONSORSHIP_DETAIL_ERROR,
  buildQuickReviewPostBody,
  createQuickReviewSubmission,
  readCreatedQuickReviewPostId,
  validateQuickReviewContent,
  validateQuickReviewDisclosure,
  type QuickReviewDraft,
} from "@/lib/community/quickReview";

const draft: QuickReviewDraft = {
  vendorName: "  라벨르 스튜디오 ",
  category: "studio",
  rating: 5,
  review: " 실장님이 친절해요 ",
  images: [],
  adDisclosure: "general",
};

const KEY_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const KEY_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("15초 후기 요청 모양", () => {
  it("업체 이름은 제목으로만 가고 vendor_tags(업체 UUID 자리)는 비운다", () => {
    expect(buildQuickReviewPostBody(draft)).toEqual({
      category: "tour_review",
      title: "라벨르 스튜디오 후기",
      content: "실장님이 친절해요",
      images: [],
      visibility: "public",
      is_quick_review: true,
      rating: 5,
      ad_disclosure: "general",
      tags: ["studio"],
      vendor_tags: [],
    });
  });

  it.each([
    [{ vendorName: "   " }, "업체명을 입력해주세요."],
    [{ rating: 0 }, "별점을 선택해주세요."],
    [{ rating: 6 }, "별점을 선택해주세요."],
    [{ rating: 3.5 }, "별점을 선택해주세요."],
    [{ review: " " }, "한 줄 후기를 입력해주세요."],
  ])("빠진 칸 %o 은 보내기 전에 막는다", (patch, message) => {
    expect(validateQuickReviewContent({ ...draft, ...patch })).toBe(message);
  });

  it.each([
    ["공백만 5자", "     "],
    ["공백을 합치면 4자", "무료    제"],
    ["태그를 걷으면 2자", "<b>무료</b>"],
  ])("협찬 내용은 서버와 같은 정리를 거쳐 5자 미만이면 막는다 — %s", (_label, detail) => {
    expect(validateQuickReviewDisclosure({ adDisclosure: "sponsored", sponsorshipDetail: detail }))
      .toBe(QUICK_REVIEW_SPONSORSHIP_DETAIL_ERROR);
  });

  it("협찬 내용은 서버가 저장할 모양(정리·500자)으로 싣고, 협찬이 아니면 싣지 않는다", () => {
    const sponsored = buildQuickReviewPostBody({
      ...draft,
      adDisclosure: "sponsored",
      sponsorshipDetail: `  드레스   대여비 ${"가".repeat(600)} `,
    });
    expect(sponsored.sponsorship_detail).toBe(`드레스 대여비 ${"가".repeat(600)}`.slice(0, 500));
    expect(validateQuickReviewDisclosure({ adDisclosure: "ad", sponsorshipDetail: "" })).toBeNull();
    expect(buildQuickReviewPostBody({ ...draft, adDisclosure: "ad", sponsorshipDetail: "남은 값" }))
      .not.toHaveProperty("sponsorship_detail");
  });
});

describe("15초 후기 요청 키", () => {
  it("같은 내용은 같은 키, 바뀐 내용은 새 키, 저장이 확인되면 다음 글은 새 키", () => {
    const keys = [KEY_A, KEY_B, "cccccccc-cccc-4ccc-8ccc-cccccccccccc"];
    const submission = createQuickReviewSubmission(() => keys.shift()!);

    expect(submission.commandFor(draft).idempotencyKey).toBe(KEY_A);
    expect(submission.commandFor({ ...draft }).idempotencyKey).toBe(KEY_A);
    expect(submission.commandFor({ ...draft, rating: 4 }).idempotencyKey).toBe(KEY_B);

    expect(submission.clearIf(KEY_A)).toBe(false);
    expect(submission.clearIf(KEY_B.toUpperCase())).toBe(true);
    expect(submission.commandFor({ ...draft, rating: 4 }).idempotencyKey)
      .toBe("cccccccc-cccc-4ccc-8ccc-cccccccccccc");
  });

  it("UUID 가 아닌 키는 보내지 않는다", () => {
    const submission = createQuickReviewSubmission(() => "quick-review-1");
    expect(() => submission.commandFor(draft)).toThrow("QUICK_REVIEW_IDEMPOTENCY_KEY_INVALID");
  });
});

describe("15초 후기 영수증", () => {
  it.each([
    [{ post: { id: KEY_A } }, KEY_A],
    [{ post: { id: "undefined" } }, null],
    [{ post: {} }, null],
    [{ post: [KEY_A] }, null],
    [{ id: KEY_A }, null],
    [null, null],
  ])("%o 에서 새 글 id 를 %s 로 읽는다", (value, expected) => {
    expect(readCreatedQuickReviewPostId(value)).toBe(expected);
  });
});
