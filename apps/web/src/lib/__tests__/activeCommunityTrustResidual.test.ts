import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("active public community trust residuals", () => {
  it("retires community media before request parsing or storage access", () => {
    const route = read("src/app/api/community/upload/route.ts");

    expect(route).toContain("community_media_retired");
    expect(route).toContain("status: 410");
    expect(route).not.toContain("req.formData");
    expect(route).not.toContain("createClientFromRequest");
    expect(route).not.toContain(".storage");
  });

  it("keeps the writer text-only and removes upload components", () => {
    const write = read("src/app/(community)/community/post/write/page.tsx");

    expect(write).not.toContain("/api/community/upload");
    expect(write).not.toContain("ImageUploader");
    expect(write).not.toContain("SlideBuilder");
    expect(write).toContain("사진은 보관·삭제 경로가 검증될 때까지 받지 않습니다");
    expect(existsSync(resolve(process.cwd(), "src/components/community/ImageUploader.tsx"))).toBe(false);
    expect(existsSync(resolve(process.cwd(), "src/components/community/SlideBuilder.tsx"))).toBe(false);
  });

  it("does not copy community content or price details into a chat URL", () => {
    const cta = read("src/components/community/ServiceCTA.tsx");
    const detail = read("src/app/(community)/community/post/[id]/page.tsx");

    expect(cta).not.toContain("postContent");
    expect(cta).not.toContain("priceData");
    expect(cta).not.toContain("글 내용:");
    expect(cta).not.toContain("후기 기준으로 내 조건에 맞는 후보를 좁혀보세요");
    expect(cta).not.toContain("놓치지 않게");
    expect(cta).toContain("이용자 작성 정보");
    expect(cta).toContain("검증된 사실이나 추천이 아니");
    expect(detail).not.toContain("postContent={");
    expect(detail).not.toContain("priceData={");
  });

  it("separates a load failure from a genuinely missing post and offers retry", () => {
    const store = read("src/stores/communityStore.ts");
    const detail = read("src/app/(community)/community/post/[id]/page.tsx");
    const route = read("src/app/api/community/posts/[id]/route.ts");

    expect(store).toContain('postLoadStatus: "idle"');
    expect(store).toContain('postLoadStatus: "not_found"');
    expect(store).toContain('postLoadStatus: "error"');
    expect(detail).toContain('postLoadStatus === "error"');
    expect(detail).toContain("게시글을 불러오지 못했습니다");
    expect(detail).toContain("다시 시도");
    expect(route).toContain(".maybeSingle()");
    expect(route).toMatch(/if \(error\)[\s\S]*status: 503/);
    expect(route).toMatch(/if \(!post\)[\s\S]*status: 404/);
  });

  it("retires quick reviews without presenting ratings as verified", () => {
    const quickReview = read("src/app/(community)/community/quick-review/page.tsx");

    expect(quickReview).not.toContain("검증된 기본 글쓰기");
    expect(quickReview).toContain("업체 별점과 짧은 평가는 사실 확인 없이 신뢰 신호로 오해될 수 있어 종료했습니다");
    expect(quickReview).not.toMatch(/PUBLIC_BETA_CAPABILITIES|fetch\(|rating|vendor_tags/);
  });

  it("does not render an etiquette device-storage read failure as empty data", () => {
    const etiquette = read("src/components/app/etiquette/EtiquetteClient.tsx");

    expect(etiquette).toContain("readEtiquetteDeviceSnapshot");
    expect(etiquette).toContain('deviceStorageStatus === "error"');
    expect(etiquette).toContain("기기 저장 기록을 불러오지 못했습니다");
    expect(etiquette).toContain("다시 불러오기");
    expect(etiquette).not.toMatch(/catch\s*\{\s*setCheckedItems\(new Set\(\)\)/);
    expect(etiquette).not.toMatch(/catch\s*\{\s*setItemMemos\(\{\}\)/);
  });

  it("does not assume a recorded schedule actually happened or call generic guidance personal", () => {
    const weekly = read("src/components/app/WeeklyCard.tsx");
    const lounge = read("src/app/(app)/lounge/page.tsx");

    expect(weekly).not.toContain("어땠어요?");
    expect(weekly).toContain("실제로 진행했다면");
    expect(weekly).toContain("일정이 등록돼 있어요");
    expect(weekly).toContain("일반 예절 참고");
    expect(weekly).toContain("업체 원문 질문 정리");
    expect(lounge).not.toContain("진행 단계에 맞게 바꿉니다");
    expect(lounge).toContain("입력한 예식일·예산·진행 기록");
    expect(lounge).not.toContain("열려 있는 핵심 항목이 안정적이에요");
  });

  it("shows weekly-popular load failure separately from a genuine empty result", () => {
    const landing = read("src/components/community/CommunityLandingClient.tsx");

    expect(landing).toContain('"loading" | "ready" | "error"');
    expect(landing).toContain("인기글을 불러오지 못했어요");
    expect(landing).toContain("인기글 다시 불러오기");
    expect(landing).toContain("최근 7일 좋아요 반응이 있는 글이 아직 없어요");
    expect(landing).not.toContain("이번 주 반응을 집계하고 있어요");
    expect(landing).not.toContain("if (!weeklyRes.ok) return { posts: [] }");
  });

  it("uses popularity and question language instead of quality or hidden-cost endorsement", () => {
    const sources = [
      read("src/components/community/CommunityLandingClient.tsx"),
      read("src/components/community/PostCard.tsx"),
      read("src/app/(community)/community/post/[id]/page.tsx"),
      read("src/app/(community)/community/about/page.tsx"),
      read("src/components/community/EmptyFeedStarter.tsx"),
    ].join("\n");

    expect(sources).not.toMatch(/\bBEST\b|\bBest\b/);
    expect(sources).toContain("주간 인기");
    expect(sources).not.toContain("숨은 추가금 체크리스트");
    expect(sources).toContain("추가비용 확인 질문");
  });

  it("does not claim ad-ranking exclusion, verification, or safety that the UI cannot prove", () => {
    const disclosure = read("src/components/community/AdDisclosureModal.tsx");
    const about = read("src/app/(community)/community/about/page.tsx");
    const detail = read("src/app/(community)/community/post/[id]/page.tsx");

    expect(disclosure).not.toContain("추천/검색 알고리즘에 반영되지 않습니다");
    expect(disclosure).toContain("작성자가 선택한 표시");
    expect(disclosure).toContain("검증이나 추천을 뜻하지 않습니다");
    expect(about).not.toContain("투표로 좋은 글 추천");
    expect(about).not.toContain("안전하게 지켜요");
    expect(detail).not.toContain("AI 분석");
    expect(detail).not.toContain("AI 참고");
  });
});
