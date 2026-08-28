import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  APP_ROOT,
  contentBlock,
  rendered,
  source,
} from "../../../app/landing/__tests__/landingSource";

/**
 * 랜딩 카피는 `landing/page.tsx` 한 장이 아니라 `redesign/` 아래 컴포넌트와
 * `landingContent.ts`에 흩어져 있다. 목록에 파일 이름을 손으로 적으면 새 섹션이
 * 생길 때마다 조용히 검사 밖으로 빠져나간다 — 실제로 개편 뒤 랜딩 카피 전체가
 * 금지어 검사에서 빠져 있었고, page.tsx는 import 목록만 남아 통과하고 있었다.
 * 디렉터리를 통째로 읽어 새 파일이 자동으로 걸리게 한다.
 */
const LANDING_REDESIGN_PATHS = readdirSync(
  resolve(APP_ROOT, "src/components/landing/redesign"),
)
  .filter((f) => (f.endsWith(".tsx") || f.endsWith(".ts")) && !f.includes(".test."))
  .map((f) => `src/components/landing/redesign/${f}`);

const ACTIVE_PUBLIC_PATHS = [
  "src/app/layout.tsx",
  "src/app/landing/page.tsx",
  "src/app/landing/opengraph-image.tsx",
  "src/app/demo/page.tsx",
  "src/app/beta/page.tsx",
  "src/components/customer-landing/CustomerNav.tsx",
  // 2026-08-27 랜딩 개편에서 PreparationResult·SharedPrivateSection·
  // CommunityBridgeSection·TrustEvidenceSection이 삭제됐다. 이름을 남겨 두면
  // ENOENT로 파일 전체가 수집 단계에서 죽어 금지어 검사가 통째로 사라진다.
  // 랜딩 표면은 위 `LANDING_REDESIGN_PATHS`가 디렉터리를 통째로 읽어 덮는다 —
  // landingContent·ConfirmSection 같은 개별 파일을 여기 다시 적지 않는다.
  "src/components/landing/CompareToHumanPlanner.tsx",
  "src/components/landing/FiveRoles.tsx",
  "src/components/landing/ForBetaCouples.tsx",
  "src/components/landing/Footer.tsx",
  // ServicePreview·Hero·CommunityFeed는 랜딩 개편에서 삭제됐다. 검사할 표면이 없다.
  "src/components/community/ServiceCTA.tsx",
  "src/app/(community)/community/quote-check/layout.tsx",
  // 시세 화면은 살아 있지만 components/app/market-prices/* 가 라우트로 재구성됐다.
  // 죽은 경로를 지우기만 하면 이 표면의 검사가 조용히 사라지므로 살아 있는 파일로 옮긴다.
  "src/app/(community)/market-prices/page.tsx",
  "src/app/wedding/market-prices/page.tsx",
].concat(LANDING_REDESIGN_PATHS);

/**
 * 금지어는 **원문**에서 찾는다.
 *
 * 주석에 적힌 금지어까지 걸리는 것은 오탐이 아니라 여유분이다 — 주석에 남은 옛 카피는
 * 다음 사람이 그대로 되살리는 재료가 된다. 반대로 "있어야 한다"는 단언은 주석을 벗긴
 * 뒤에 본다(아래). 그쪽을 원문에서 보면 **화면에서 지운 문장이 줄 끝 주석으로 남아
 * 있다는 이유로 통과**한다 — 2026-08-27 적대적 검증에서 실제로 그 갈래로 빠져나갔다.
 */
const PUBLISHED_RAW = ACTIVE_PUBLIC_PATHS.map(source).join("\n");

/** 주석을 벗긴 랜딩 카피 전부. "있어야 한다"·"있으면 안 된다"를 화면 기준으로 본다. */
const LANDING_RENDERED = LANDING_REDESIGN_PATHS.map(rendered)
  .concat(rendered("src/app/landing/page.tsx"))
  .join("\n");

describe("public marketing claim boundary", () => {
  it("does not publish unshipped features, invented evidence, or unapproved benefit promises", () => {
    for (const forbiddenClaim of [
      "AI 드레스 가상 피팅",
      "웨딩 플래너 없이도 완벽",
      "24시간 365일",
      "200~500만원",
      "아모라웨딩홀 후기 67건",
      "10% 이상 답변을 고정",
      "검증된 준비 가이드",
      "Contract Diff 무료 Premium",
      "종료 후 6개월 무료",
      "아모라 풀 기능",
      "완전 무료",
      "스드메 추가금 평균",
      "가격 정보 어려움",
      "추가비용 경험률",
      "서울 평균 총 비용",
      "비수기 절약액",
      "비수기 결혼 시 평균 절약 금액",
      "성수기와 비수기의 가격 차이는 약 400~500만원",
      "2026년 1월 기준 중위 가격",
      "빠진 항목과 추가금 가능성",
      "금액보다 먼저 빠진 항목",
      "숨은 비용",
      "예상 추가금",
    ]) {
      expect(PUBLISHED_RAW).not.toContain(forbiddenClaim);
    }
  });

  it("labels the demo as a non-indexed preview instead of presenting fictional proof", () => {
    // 있어야 하는 것은 주석을 벗기고 본다. 고지 문장을 지우고 주석으로 옮기면
    // 원문 검사는 통과하지만 방문자는 아무 고지도 못 본다.
    const demo = rendered("src/app/demo/page.tsx");

    expect(demo).toContain("현재 개발·검증 중");
    expect(demo).toContain("실사용 통계나 고객 후기가 아니라");
    expect(demo).toContain("robots: { index: false, follow: false }");
    expect(source("src/app/demo/page.tsx")).not.toContain("CustomerTestimonials");
    expect(source("src/app/demo/page.tsx")).not.toContain("CustomerStats");
  });

  it("states that AI changes require confirmation and keeps policy links real", () => {
    // 랜딩이 page.tsx 한 장에서 섹션 컴포넌트로 나뉘면서 이 계약의 문장과 링크가
    // landingContent·ConfirmSection·PrivateLaneSection·LandingFooter로 흩어졌다.
    // page.tsx만 읽으면 구조를 바꿨다는 이유로 계약이 통과해 버린다.
    //
    // ⚠️ 2026-08-27 적대적 검증: 네 파일을 이어 붙여 `toContain` 하던 옛 형태는
    // **문장이 어느 블록에 있는지 보지 않았다.** 히어로가 지던 제품 설명 문장을
    // `footer.tagline`으로 옮겨도, 확인 계약 문장을 아무 note에 옮겨 붙여도 통과했다.
    // 그래서 이제 `contentBlock()`으로 **그 문장이 있어야 할 블록**에서 찾는다
    // (경계를 못 찾으면 던진다 — `slice(-1)`로 조용히 참이 되던 옛 가드와 다르다).
    const confirmBlock = contentBlock("confirm", "notForVendors");
    const privateLaneBlock = contentBlock("privateLane", "confirm");
    const footerLinkBlock = contentBlock("footerLinks", "headerAuth");

    expect(confirmBlock, "확인 계약 문장이 confirm 블록에 없다")
      .toContain("확인한 변경만 준비 기록에 반영");
    expect(confirmBlock, "확인 전 미반영 문장이 confirm 블록에 없다")
      .toContain("확인 버튼을 누르기 전까지 예산·할 일·일정에 반영되지 않아요");
    expect(privateLaneBlock, "저장 고지가 privateLane 블록에 없다")
      .toContain("대화 내용은 서비스에서 처리·저장될 수 있어요");

    // 카피에만 있고 화면에서 빠진 상태를 통과시키지 않는다 — 정본 파일 하나가
    // 대신 답한다. 그 문장을 지는 섹션이 실제로 그 값을 그리는지 따로 본다.
    const confirmSection = rendered("src/components/landing/redesign/ConfirmSection.tsx");
    const privateLaneSection = rendered(
      "src/components/landing/redesign/PrivateLaneSection.tsx",
    );
    expect(confirmSection).toContain("{confirm.body}");
    expect(confirmSection).toContain("{confirm.body2}");
    expect(privateLaneSection).toContain("{privateLane.note}");

    // 정책 링크는 `footerLinks.policy` 묶음 안에 있어야 한다. 옛 검사는 파일 어디에
    // 있든 통과해서, 정책 링크를 "로그인 없이" 묶음으로 옮겨도 몰랐다.
    const policyStart = footerLinkBlock.indexOf("  policy: [");
    expect(policyStart, "footerLinks.policy 묶음이 없다").toBeGreaterThanOrEqual(0);
    const policyGroup = footerLinkBlock.slice(policyStart);
    expect(policyGroup).toContain('{ label: "이용약관", href: "/terms" }');
    expect(policyGroup).toContain('{ label: "개인정보처리방침", href: "/privacy" }');
    expect(policyGroup).toContain('{ label: "AI 서비스 정책", href: "/ai-policy" }');

    // 카피의 href가 진짜 목적지로 나가는지까지 본다. 푸터가 자기 목적지를 발명하면
    // (`href="#"`) 위 세 단언은 그대로 통과하면서 링크는 아무 데도 가지 않는다 —
    // 2026-08-27 적대적 검증에서 실제로 통과한 변형이다.
    const landingFooter = rendered("src/components/landing/redesign/LandingFooter.tsx");
    expect(landingFooter).toContain("footerLinks.policy");
    expect(landingFooter, "푸터가 카피의 href를 쓰지 않는다").toContain("href={item.href}");
    expect(landingFooter, "푸터가 목적지를 손으로 적었다").not.toMatch(/href="/u);

    // 있어야 할 것만 보면 **뒤에 뒤집는 문장을 붙이는 변형**을 못 막는다. 확인 계약을
    // 그대로 둔 채 "급할 때는 확인을 건너뛰고 바로 반영할 수도 있어요"를 덧붙인 변형이
    // 2026-08-27 검증에서 전부 초록이었다. 제품 계약(아모라는 사용자 확인 없이 아무것도
    // 바꾸지 않는다)을 정면으로 뒤집는데도 그랬다. 그래서 있으면 안 되는 것도 본다.
    //
    // 주석을 벗긴 뒤 본다 — 왜 그 문장이 거짓인지 적어 둔 주석이 스스로 걸리면
    // 다음 사람이 이 가드를 지운다.
    for (const [pattern, why] of [
      [/확인[^.\n]{0,12}(없이|건너뛰|생략|않아도|안 해도|안해도|안 눌러도)/u,
        "확인 없이도 반영된다는 말"],
      [/(자동으로|알아서)[^.\n]{0,16}(반영|적용|변경|저장)/u,
        "사용자 확인 없이 아모라가 스스로 바꾼다는 말"],
      // 2026-08-23 파운더 결정으로 두 사람 승인이 폐지됐다. 되살려 적으면 거짓이다.
      [/각각 확인해야/u, "폐지된 두 사람 승인"],
      // 저장 고지를 "확인한 내용만 저장"으로 바꾸면 저장 범위를 좁게 오도한다.
      [/확인한 내용만 저장/u, "저장 범위를 좁게 말하는 문장"],
    ] as Array<[RegExp, string]>) {
      expect(LANDING_RENDERED, `확인 계약을 뒤집는 문장: ${why}`).not.toMatch(pattern);
    }
  });

  it("keeps the privacy policy aligned with the shipped quote analysis scope", () => {
    const privacy = rendered("src/app/privacy/page.tsx");

    expect(privacy).toContain("새 입력은 분석 응답 생성 후 별도 DB에 저장하지 않으며");
    expect(privacy).toContain("공개 결과 링크도 만들지 않습니다");
    expect(privacy).toContain("선택한 분야·항목 상태·견적 금액은 해당 통계 이벤트에 넣지 않습니다");
    expect(privacy).toContain("웨딩코드: 답은 기기 안에서 계산하고 제품 분석·세션 녹화를 하지 않습니다");
    expect(privacy).toContain("2026년 7월 30일");

    for (const unshippedOperation of [
      "업체(파트너) 예약 시",
      "㈜ 토스페이먼츠",
      "결제 처리",
      "청첩장 정보",
      "축의금 관리 데이터",
      "견적 점검 기록(분야",
      "가격 공시 후보 내부 검토 신호",
    ]) {
      expect(source("src/app/privacy/page.tsx")).not.toContain(unshippedOperation);
    }
  });
});
