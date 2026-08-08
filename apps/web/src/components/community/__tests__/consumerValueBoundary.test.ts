// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

describe("community consumer-value boundary", () => {
  it("opens the community navigation directly at the people-first feed", () => {
    const nav = source("src/components/community/CommunityNav.tsx");

    expect(nav).toContain('/community?feed=all');
    expect(nav).toContain('label: "커뮤니티"');
  });

  it("gives value before asking a first-time visitor to contribute", () => {
    const landing = source("src/components/community/CommunityLandingClient.tsx");

    expect(landing).toContain("계약하기 전에,");
    expect(landing).toContain("내 상황과 가까운 해결 경험부터 찾아보세요");
    expect(landing).toContain("사람이 직접 남긴 답변 확인");
    expect(landing).not.toContain("최근 글 중 답변을 기다리는 고민");
  });

  it("turns a zero-result search into an editable question draft", () => {
    const landing = source("src/components/community/CommunityLandingClient.tsx");
    const writePage = source("src/app/(community)/community/post/write/page.tsx");

    expect(landing).toContain("아직 같은 상황의 공개 경험을 찾지 못했어요");
    expect(landing).toContain("이 내용으로 질문 만들기");
    expect(landing).toContain('prefill: "community_search"');
    expect(writePage).toContain('prefillKind === "community_search"');
    expect(writePage).toContain("제목보다 상황이 중요해요");
    expect(writePage).toContain("경험자에게 질문하기");
  });

  it("frames search and sorting around decisions and helpfulness", () => {
    const landing = source("src/components/community/CommunityLandingClient.tsx");

    expect(landing).toContain("내 상황과 가까운 해결 경험부터 찾아보세요");
    expect(landing).toContain('top: "도움된순"');
    expect(landing).toContain("도움돼요 기준");
  });

  it("keeps the full community feed compact enough for posts to lead", () => {
    const landing = source("src/components/community/CommunityLandingClient.tsx");

    expect(landing).toContain("결혼 준비 이야기");
    expect(landing).toContain("지금 올라온 글");
    expect(landing).toContain("compact={showFullFeed}");
    expect(landing).toContain("feedFirst={showFullFeed || showLandingIntro}");
  });

  it("keeps the visible community choices to four intents and three useful destinations", () => {
    const landing = source("src/components/community/CommunityLandingClient.tsx");

    for (const intent of [
      "처음이라 막막해요",
      "견적·추가금",
      "계약·취소",
      "가족·파트너",
    ]) {
      expect(landing).toContain(intent);
    }

    for (const destination of ["답변 기다려요", "해결된 고민", "내 글"]) {
      expect(landing).toContain(destination);
    }

    expect(landing).toContain('sort=unanswered');
    expect(landing).toContain('sort=resolved');
    expect(landing).toContain('/community/my/posts');
  });

  it("backs answer-state destinations with honest server filters", () => {
    const postsApi = source("src/app/api/community/posts/route.ts");

    expect(postsApi).toContain('sort === "unanswered"');
    expect(postsApi).toContain('sort === "resolved"');
    expect(postsApi).toContain('.in("category", QUESTION_CATEGORIES)');
    expect(postsApi).toContain('.eq("comment_count", 0)');
    expect(postsApi).toContain('.eq("is_resolved", false)');
    expect(postsApi).toContain('.eq("is_resolved", true)');
    expect(postsApi).toContain('.eq("ad_disclosure", "general")');
  });

  it("keeps empty status feeds and helped rankings honest", () => {
    const landing = source("src/components/community/CommunityLandingClient.tsx");
    const postsApi = source("src/app/api/community/posts/route.ts");

    expect(landing).toContain("아직 해결 표시된 고민이 없어요");
    expect(landing).toContain("답변 기다리는 고민 보기");
    expect(landing).toContain("지금은 답변을 기다리는 고민이 없어요");
    expect(landing).toContain("아직 이 기간에 도움 반응을 받은 글이 없어요");
    expect(landing).toContain(".filter((post) => post.upvote_count > 0)");
    expect(postsApi).toContain('.gt("upvote_count", 0)');
  });

  it("takes an answerer directly to the answer form", () => {
    const landing = source("src/components/community/CommunityLandingClient.tsx");
    const commentSection = source("src/components/community/CommentSection.tsx");

    expect(landing).toContain('communityPostLinkProps(post.id, "comments")');
    expect(commentSection).toContain('id="comment-composer"');
    expect(commentSection.match(/id="comments"/g) ?? []).toHaveLength(0);
  });

  it("keeps a decision record in the order question, human answers, then Amora action", () => {
    const detail = source(
      "src/app/(community)/community/post/[id]/PostDetailClient.tsx",
    );

    expect(detail).toContain("질문자가 해결됐다고 표시한 기록");
    expect(detail).toContain("특정 답변을 채택했다는 뜻은 아닙니다");
    expect(detail).toContain("작성 출처와 광고·혜택 공개 여부");
    expect(detail.indexOf('id="decision-question"')).toBeLessThan(
      detail.indexOf('id="comments"'),
    );
    expect(detail.indexOf('id="comments"')).toBeLessThan(
      detail.indexOf('id="decision-next-action"'),
    );
  });

  it("lets a guest shape a question before login and warns about public personal data", () => {
    const writePage = source("src/app/(community)/community/post/write/page.tsx");

    expect(writePage).toContain("로그인은 게시할 때만 필요해요");
    expect(writePage).toContain("검색엔진");
    expect(writePage).toContain("전화번호");
    expect(writePage).toContain("계좌");
    expect(writePage).toContain("서명");
    expect(writePage).toContain("사진 속 글자는 자동으로 가려지지 않아요");
    expect(writePage).toContain("publicSafetyConfirmed");
    expect(writePage).toContain('type="checkbox"');
    expect(writePage).toContain('searchParams.set("resume", "1")');
  });

  it("fails closed when AI answer provenance cannot be persisted", () => {
    const aiCommentApi = source("src/app/api/community/ai-comment/route.ts");
    const commentItem = source("src/components/community/CommentItem.tsx");

    expect(aiCommentApi).toContain("COMMUNITY_AI_ORIGIN_PERSISTENCE_FAILED");
    expect(aiCommentApi).not.toContain("fallbackComment");
    expect(commentItem).not.toContain('nickname === "아모라 AI"');
  });

  it("keeps unverified UGC out of search indexing until trust and SSR gates pass", () => {
    const detailLayout = source("src/app/(community)/community/post/[id]/layout.tsx");
    const sitemap = source("src/app/sitemap.ts");

    expect(detailLayout).toContain("index: false");
    expect(detailLayout).toContain("follow: true");
    expect(sitemap).not.toContain('from("community_posts")');
  });

  it("uses plain language in public community guidance", () => {
    const guidance = [
      source("src/components/community/CommunityGuide.tsx"),
      source("src/app/(community)/community/about/page.tsx"),
      source("src/app/start-here/page.tsx"),
      source("src/components/community/StartHereClient.tsx"),
      source("src/constants/communityCategories.ts"),
    ].join("\n");

    expect(guidance).not.toMatch(
      /스드메|예식장|예식일|원본·보정본|본식 스냅/,
    );
    expect(guidance).toContain("사진 촬영·드레스·메이크업");
    expect(guidance).toContain("결혼식 날 사진·영상");
    expect(guidance).toContain("결혼식 날짜");
  });

  it("keeps the full checklist collapsed until a visitor asks for it", () => {
    const startHere = source("src/components/community/StartHereClient.tsx");

    expect(startHere).toContain("날짜가 있으면 지금 볼 세 가지");
    expect(startHere).not.toContain('<details open={dday === null}');
  });

  it("does not expose booking controls on the community vendor page", () => {
    const vendorPage = source(
      "src/app/(community)/community/vendor/[name]/page.tsx",
    );
    const renderedPage = vendorPage.slice(
      vendorPage.indexOf("export default function VendorDetailPage"),
      vendorPage.indexOf("function Stat"),
    );

    expect(renderedPage).toContain(
      "웨딩한방에서는 이 업체의 예약 가능 시간이나 예약 완료 여부를 제공하지",
    );
    expect(renderedPage).not.toContain("<BookingSection");
    expect(renderedPage).not.toContain("<NoBookingFallback");
  });

  it("does not turn Amora's answer or invented market averages into a user's post", () => {
    const chat = source("src/components/app/chat/ChatContent.tsx");
    const cohort = source("src/app/(community)/community/cohort/[id]/page.tsx");
    const priceComment = source("src/lib/community/priceComment.ts");

    expect(chat).toContain("const text = normalizeChatText(userQuestion)");
    expect(chat).toContain("void amoraAnswer");
    expect(chat).not.toContain("결혼식 형태에 따라 결혼식장");
    expect(chat).not.toContain("계약 전에 빠뜨리기 쉬운 비용");

    expect(cohort).not.toContain("NATIONAL_AVG");
    expect(cohort).not.toContain("전국 평균:");
    expect(cohort).toContain("시장 전체의 시세는 아니에요");

    expect(priceComment).not.toContain("compareAgainstBenchmark");
    expect(priceComment).toContain("가격 수준 판정 안 함");
  });
});
