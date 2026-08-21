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
/**
 * 주석은 벗기고 본다. 왜 어떤 문구를 쓰지 않는지 설명하려면 그 문구를 적어야 하는데,
 * 자기 설명에 걸려 넘어지는 가드는 가드가 아니다. 주석은 렌더되지 않으므로 카피
 * 검사 대상이 아니다(같은 처리가 twoSidedTrust·landingAvailableNow에도 있다).
 */
const withoutComments = (source: string) =>
  source
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .replace(/^[\t ]*\/\/.*$/gmu, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/gu, "");

const community = withoutComments(readFileSync(
  resolve(appRoot, "src/components/landing/redesign/CommunityBridgeSection.tsx"),
  "utf8",
));
const content = withoutComments(readFileSync(
  resolve(appRoot, "src/components/landing/redesign/landingContent.ts"),
  "utf8",
));

describe("landing product outcome evidence", () => {
  it("shows how separate proposals reach the three preparation records", () => {
    expect(landing).toContain("<PreparationResult />");
    expect(content).toContain("계정을 만들면 이어지는 정리 방식");
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
    // 2026-08-06: 로그인 없는 체험 언급을 내렸다(파운더 결정: 한도 예정).
    // 남은 계약은 "계정에서 분리할 수 있다"는 경계 자체다.
    expect(privacy).toContain("계정을 만들면 함께 관리할 준비와 파트너에게 보이지 않을 상담을 분리할 수 있어요");
    expect(privacy, "되돌린 방향의 체험 잔재").not.toContain("로그인 없는 체험");
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
    expect(content).toContain("같은 준비에서 이어가요.");

    // 이 계약은 원래 continuity 02단계의 문장("무엇이 바뀌는지 먼저 봐요.")을
    // 고정하고 있었다. 그 단계는 `PreparationResult` 섹션 전체가 하는 이야기와
    // 같은 말이어서 걷어냈다 — 같은 약속을 세 번 하면 페이지만 길어진다.
    //
    // **약속이 사라진 게 아니라 자리만 정리됐다**는 것을 여기서 지킨다. 문구를
    // 고정하는 대신 약속이 실제로 살아 있는 곳들을 검사한다.
    expect(content, "확인 전에는 반영되지 않는다는 약속이 히어로에서 사라졌다")
      .toContain("확인한 변경만 준비 기록에 반영해요");
    expect(content, "같은 약속이 신뢰 섹션에서도 사라졌다")
      .toContain("확인 버튼을 누르기 전까지 예산·할 일·일정에 반영되지 않아요");
    // 중복이 슬그머니 돌아오면 여기서 걸린다.
    expect(content, "걷어낸 중복 단계가 되살아났다").not.toContain("무엇이 바뀌는지 먼저 봐요.");
    expect(continuity).toContain("계정에서는 준비 기록에 반영될 변경을 먼저 확인할 수 있어요.");
    expect(continuity, "되돌린 방향의 체험 잔재").not.toContain("체험 대화");
  });

  it("describes the community as it actually is, and only promises what exists", () => {
    // 이 계약은 원래 "커뮤니티는 아직 운영 공개 전"을 **강제**했다. 그 전제가 참일
    // 때는 사람을 못 보내게 막는 것이 맞았지만, 커뮤니티는 이미 열려 있고 로그인
    // 없이 읽힌다(라이브 확인). 열린 것을 닫혔다고 말하는 화면을 테스트가 지키고
    // 있었던 셈이다. 계약을 뒤집는 게 아니라 **지키는 대상을 현재 사실로 옮긴다.**
    expect(landing).toContain("<CommunityBridgeSection />");

    // 닫혔다고 말하지 않는다.
    expect(content).not.toContain("커뮤니티는 아직 운영 공개 전이에요.");
    expect(community).not.toContain("운영 공개 전");
    expect(community).not.toContain("공개할 때 구분할 출처");

    // 실재하는 것만 현재형으로 약속한다 — AdDisclosureBadge·AiCommentBox.
    expect(community).toContain("지금 구분해서 보여주는 것");
    expect(community).toContain("광고·협찬 · 별도 표시");
    expect(community).toContain("AI 답변 · AI 생성 표시");
    expect(community).toContain("사람의 경험과 AI의 제안을 같은 근거처럼 보여주지 않아요.");

    // 없는 것을 있다고 하지도, 조용히 지우지도 않는다. `UserRole`이
    // "bride" | "groom"뿐이라 작성자 종류 구분은 아직 없다.
    expect(community).toContain("아직 구분하지 않는 것");
    expect(community).toContain("일반 회원 · 업계 종사자 구분");
    expect(community).not.toContain("업계 종사자 · 이해관계 확인");
  });
});
