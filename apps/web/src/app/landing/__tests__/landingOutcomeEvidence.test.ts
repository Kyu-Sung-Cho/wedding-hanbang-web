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
const content = readFileSync(
  resolve(appRoot, "src/components/landing/redesign/landingContent.ts"),
  "utf8",
);

describe("landing product outcome evidence", () => {
  it("shows where one conversation leaves concrete shared preparation records", () => {
    expect(landing).toContain("<PreparationResult />");
    expect(content).toContain("대화가 준비로 남는 방식");
    expect(content).toContain("한 번 말한 준비를 다시 옮겨 적지 않게.");

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

    expect(outcomes).toContain("확인 버튼을 누르기 전에는 예산·할 일·일정에 반영되지 않아요.");
  });

  it("keeps shared records and private consultation visibly distinct", () => {
    expect(content).toContain("같이 보는 우리 준비");
    expect(content).toContain("파트너에게 비공개인 상담");
    expect(content).toContain("서비스에서 처리·저장되지만, 연결된 파트너 화면에는 표시하지 않아요");
    expect(privacy).toContain("확인해 반영한 결과를 함께 보기");
    expect(privacy).toContain("파트너 화면에는 표시하지 않음");
    expect(privacy).toContain('href="/privacy"');
    expect(privacy).toContain("로그인 없는 체험은 공유 모드로만 열립니다");
  });

  it("keeps the editorial story in the intended order", () => {
    const heroIndex = landing.indexOf("<TransformationHero />");
    const outcomeIndex = landing.indexOf("<PreparationResult />");
    const continuityIndex = landing.indexOf("<ContinuitySection />");
    const privacyIndex = landing.indexOf("<SharedPrivateSection />");
    const trustIndex = landing.indexOf("<TrustEvidenceSection");

    expect(heroIndex).toBeGreaterThanOrEqual(0);
    expect(outcomeIndex).toBeGreaterThan(heroIndex);
    expect(continuityIndex).toBeGreaterThan(outcomeIndex);
    expect(privacyIndex).toBeGreaterThan(continuityIndex);
    expect(trustIndex).toBeGreaterThan(privacyIndex);
  });

  it("shows why the product remains useful after the first conversation", () => {
    expect(content).toContain("오늘 정한 한 가지가, 다음 준비의 기준으로 이어져요.");
    expect(content).toContain("무엇이 바뀌는지 먼저 봐요.");
    expect(content).toContain("같은 준비에서 이어가요.");
    expect(continuity).toContain("로그인 없이 여는 체험 대화와 변경은 계정의 준비 기록에 남지 않아요.");
  });
});
