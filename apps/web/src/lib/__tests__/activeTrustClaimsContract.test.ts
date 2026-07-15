import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(process.cwd(), "../..");
const read = (path: string) => readFileSync(resolve(repoRoot, path), "utf8");

describe("active trust claims", () => {
  it("does not promise recommendation results from onboarding preferences", () => {
    const onboarding = [
      read("apps/web/src/components/onboarding/WeddingStylePreferences.tsx"),
      read("apps/mobile/app/onboarding/index.tsx"),
    ].join("\n");

    expect(onboarding).not.toContain("취향에 맞는 추천을 위해 알려주세요");
    expect(onboarding).toContain("아모라가 대화를 맞춰 설명할 때 참고할 선택 정보예요");
  });

  it("does not show an undefined verification badge or label a self-promo as a recommendation", () => {
    const detail = read("apps/web/src/app/(community)/community/post/[id]/page.tsx");
    const community = read("apps/web/src/components/community/CommunityLandingClient.tsx");
    const comment = read("apps/web/src/components/community/CommentItem.tsx");

    expect(detail).not.toContain("인증후기");
    expect(community).not.toContain("아모라 추천");
    expect(community).toContain("아모라 상담");
    expect(comment).not.toContain('nickname === "아모라 AI"');
    expect(comment).not.toContain("AMORA_USER_ID");
    expect(comment).not.toContain("isOfficialAI");
  });

  it("keeps the in-app guide free of invented user progress, money, and urgency", () => {
    const guide = read("apps/web/src/components/app/ServiceGuide.tsx");
    const tutorial = read("apps/web/src/components/app/ServiceDashboardTutorial.tsx");

    expect(guide).not.toMatch(/D-149|35%|3,000만원|1,080만원|540만원/);
    expect(guide).not.toContain("추천 흐름");
    expect(guide).toContain("화면 예시 · 실제 내 데이터가 아닙니다");
    expect(guide).toContain("직접 입력한 금액");
    expect(guide).toContain("계획·계약·납부액 구분");
    expect(guide).not.toContain("상담 금액 정리");
    expect(tutorial).not.toContain("오늘 먼저 볼 준비 항목");
    expect(tutorial).toContain("웨딩한방의 기록은 계약서나 결제 증빙을 대신하지 않아요");
  });

  it("states the real chat-deletion boundary and does not present unverified support as operational", () => {
    const policy = read("apps/web/src/app/ai-policy/page.tsx");

    expect(policy).toContain("최종 수정: 2026년 7월 14일");
    expect(policy).toContain("공유 대화는 양쪽 화면에서 정리할 수 있지만 현재 물리 삭제는 지원하지 않습니다");
    expect(policy).toContain("비공개 대화는 본인이 영구 삭제할 수 있습니다");
    expect(policy).not.toContain("support@hanbang.ai");
    expect(policy).toContain("현재 공개 문제 신고 접수는 열지 않았습니다");
    expect(policy).toContain("고정된 긴급 안내를 먼저 제공합니다");
  });

  it("does not publish an unverified deletion path, legal retention shortcut, or community authority rank", () => {
    const privacy = read("apps/web/src/app/privacy/page.tsx");

    expect(privacy).not.toContain("웹사이트 방문 기록: <strong>3개월</strong>");
    expect(privacy).not.toContain("소비자의 불만 또는 분쟁처리에 관한 기록: <strong>3년</strong>");
    expect(privacy).not.toContain("삭제 요청이 있으면 그보다 먼저 처리합니다");
    expect(privacy).not.toContain("아바타·뱃지·랭크만 공개");
    expect(privacy).toContain("실제 이용자 개인정보를 받지 않습니다");
    expect(privacy).toContain("활동 합계·등급·뱃지는 다른 이용자의 응답에 포함하지 않습니다");
  });
});
