// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const appRoot = resolve(process.cwd());
const landing = readFileSync(resolve(appRoot, "src/app/landing/page.tsx"), "utf8");
const outcomes = readFileSync(
  resolve(appRoot, "src/components/landing/redesign/PreparationResult.tsx"),
  "utf8",
);
const privacy = readFileSync(
  resolve(appRoot, "src/components/landing/redesign/SharedPrivateSection.tsx"),
  "utf8",
);
const continuity = readFileSync(
  resolve(appRoot, "src/components/landing/redesign/ContinuitySection.tsx"),
  "utf8",
);
const community = readFileSync(
  resolve(appRoot, "src/components/landing/redesign/CommunityBridgeSection.tsx"),
  "utf8",
);
const content = readFileSync(
  resolve(appRoot, "src/components/landing/redesign/landingContent.ts"),
  "utf8",
);

describe("landing product outcome evidence", () => {
  it("shows how separate proposals reach the three preparation records", () => {
    expect(landing).toContain("<PreparationResult />");
    expect(content).toContain("계정 베타에서 이어지는 정리 방식");
    expect(content).toContain("필요한 변경을 하나씩 제안하고, 확인받아요.");
    expect(content).toContain("예산·할 일·일정 중 한 번에 한 가지 변경을 제안하고");
    expect(content).not.toContain("말에서 세 가지 초안을 찾고");

    for (const record of [
      "총예산 3,000만원",
      "드레스숍 3곳 예약 문의",
      "10월 17일 오후 2시",
    ]) {
      expect(content).toContain(record);
    }

    for (const destination of ["우리 예산", "우리 할 일", "우리 일정"]) {
      expect(content).toContain(destination);
    }

    expect(outcomes).toContain("서로 다른 변경의 목적지");
    expect(outcomes).toContain("제안마다 따로 확인");
    expect(outcomes).toContain("한 번의 확인에는 한 가지 변경만 포함돼요");
    expect(outcomes).not.toContain("아모라의 변경 제안 예시");
    expect(outcomes).not.toContain("한 대화에서");
    expect(content).toContain("예산 변경 예시");
    expect(content).toContain("할 일 추가 예시");
    expect(content).toContain("일정 추가 예시");
  });

  it("keeps shared records and private consultation visibly distinct", () => {
    expect(content).toContain("같이 보는 우리 준비");
    expect(content).toContain("파트너에게 비공개인 상담");
    expect(content).toContain("서비스에서 처리·저장되지만, 연결된 파트너 화면에는 표시하지 않아요");
    expect(content).toContain("저장한 아모라 답변은 저장함에서 다시 볼 수 있어요");
    expect(privacy).toContain("확인해 반영한 결과를 함께 보기");
    expect(privacy).toContain("파트너 화면에는 표시하지 않음");
    expect(privacy).toContain('href="/privacy"');
    expect(privacy).toContain("로그인 없는 체험은 공유 모드로만 열려요");
  });

  it("keeps the editorial story in the intended order", () => {
    const heroIndex = landing.indexOf("<TransformationHero />");
    const outcomeIndex = landing.indexOf("<PreparationResult />");
    const continuityIndex = landing.indexOf("<ContinuitySection />");
    const privacyIndex = landing.indexOf("<SharedPrivateSection />");
    const communityIndex = landing.indexOf("<CommunityBridgeSection />");
    const trustIndex = landing.indexOf("<TrustEvidenceSection");

    expect(heroIndex).toBeGreaterThanOrEqual(0);
    expect(outcomeIndex).toBeGreaterThan(heroIndex);
    expect(continuityIndex).toBeGreaterThan(outcomeIndex);
    expect(privacyIndex).toBeGreaterThan(continuityIndex);
    expect(communityIndex).toBeGreaterThan(privacyIndex);
    expect(trustIndex).toBeGreaterThan(communityIndex);
  });

  it("shows why the product remains useful after the first conversation", () => {
    // 이 단언은 화면에 없는 문장("…기준으로 이어져요.")을 고정하고 있었다. 화면은
    // 줄곧 "…기준으로."였고, 그래서 정본과 화면이 갈린 채로 통과했다. 정본을 화면에
    // 맞춘 뒤 여기도 같은 문자열로 맞춘다. 두 사본의 일치 자체는
    // landingHeadlineParity.test.ts가 별도로 강제한다.
    expect(content).toContain("오늘 정한 한 가지가, 다음 준비의 기준으로.");
    expect(content).toContain("무엇이 바뀌는지 먼저 봐요.");
    expect(content).toContain("같은 준비에서 이어가요.");
    expect(continuity).toContain("로그인 없이 여는 체험 대화와 변경은 계정의 준비 기록에 남지 않아요.");
  });

  it("keeps the community promise bounded to an unlaunched operating plan", () => {
    expect(landing).toContain("<CommunityBridgeSection />");
    expect(content).toContain("커뮤니티의 출처 표시 기준을 준비하고 있어요.");
    expect(content).toContain("커뮤니티는 아직 운영 공개 전이에요.");
    expect(community).toContain("일반 회원 · 경험 미인증");
    expect(community).toContain("운영 공개 전 · 출처 기준 검증 중");
    expect(community).not.toContain('href="/start-here"');
    expect(community).not.toContain("weddingLinkProps");
    expect(community).not.toContain("궁금한 점을 질문해요");
  });
});
