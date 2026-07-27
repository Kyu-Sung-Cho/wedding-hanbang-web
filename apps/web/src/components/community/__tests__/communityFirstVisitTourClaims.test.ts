// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { stripComments } from "../../../lib/testing/sourceText";

/**
 * 첫방문 투어가 하는 약속은 그 버튼이 실제로 하는 일과 같아야 한다.
 *
 * 2026-07-27 실측: 5번 스텝이 아모라를 "가입 없이 바로 대화할 수 있고 … 지금 이
 * 버튼을 눌러보세요"라고 소개했는데, 그 버튼(CommunityAmoraLauncher)은 데모 쿠키가
 * 없으면 "로그인 후 이용할 수 있어요" 모달을 띄운다. 첫방문 투어이므로 그 문구를
 * 보는 사람이 정확히 못 하는 사람이었다. 랜딩 WhatWeDo 카드는 같은 기능을
 * "가입 필요 · 무료"로 정직하게 적고 있어, 한 화면 안에서 서로 어긋나 있었다.
 *
 * 코드 리뷰로는 잡히지 않는 종류다 — 문구와 도착 동작을 나란히 놓아야 보인다.
 */
const COMPONENT_DIR = resolve(process.cwd(), "src", "components", "community");

function read(file: string): string {
  return readFileSync(resolve(COMPONENT_DIR, file), "utf8");
}

const NO_SIGNUP_CLAIMS = ["가입 없이", "로그인 없이", "가입 안 하고"] as const;

describe("첫방문 투어의 약속과 실제 동작", () => {
  const tour = read("CommunityFirstVisitTour.tsx");
  const launcher = read("CommunityAmoraLauncher.tsx");

  it("아모라 버튼은 로그인을 요구한다 (이 테스트의 전제)", () => {
    // 전제가 바뀌면(예: 게스트 상담 허용) 아래 문구 제약도 함께 재검토해야 한다.
    expect(launcher).toContain("로그인 후 이용할 수 있어요");
    expect(launcher).toContain("guest_probe=1");
  });

  // 주석은 대상이 아니다 — 왜 그렇게 적지 않는지 설명을 남길 수 있어야 한다.
  const amoraStep = (): string => {
    const visible = stripComments(tour);
    return visible.slice(visible.indexOf('data-tutorial-target="landing-amora"'));
  };

  it("아모라 스텝은 가입 없이 쓸 수 있다고 말하지 않는다", () => {
    const step = amoraStep();
    const lying = NO_SIGNUP_CLAIMS.filter((claim) => step.includes(claim));

    expect(
      lying,
      `아모라 스텝이 지키지 못할 약속을 한다: ${lying.join(", ")}`
        + " — 이 버튼은 로그인 모달을 띄운다",
    ).toEqual([]);
  });

  it("로그인이 필요하다는 사실을 밝힌다", () => {
    const step = amoraStep();
    expect(step).toMatch(/로그인이 필요|가입 필요/);
    // 무료라는 점까지 붙여야 "로그인 필요"가 유료 신호로 읽히지 않는다.
    expect(step).toContain("무료");
  });
});
