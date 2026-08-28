// @vitest-environment node

/**
 * 공개 화면이 **오늘 사용자가 재현할 수 있는 것만** 말하는가.
 *
 * `CLAUDE.md` 의 제품 계약: *"사용자에게 보이는 표면에는 오늘 사용자가 직접 재현할
 * 수 있는 것만 쓴다. 기본값 false 플래그 뒤에 있거나, 모바일에 진입점이 없거나,
 * 실행기가 스텁이면 그것은 외부 문장이 아니라 내부 문장이다."*
 *
 * ## 무엇이 있었나 (2026-08-28 감사, 전부 라이브 실측)
 *
 * **1. `/price`** — "로그인 전에는 아모라 체험을 바로 열 수 있어요" 가 조건 없이
 * 그려지는데 그 아래 버튼만 플래그 뒤였다. 체험은 기본 꺼짐이라 문장만 남고 누를
 * 것이 없었다.
 *
 * **2. `/demo`** — "로그인 전 체험은 함께 보기 대화만 지원합니다" 를 현재형으로
 * 설명하는데 그 체험 자체가 2026-08-27 에 닫혔다. 공시가·예절 화면의
 * "아모라 체험" 라벨이 사람을 여기로 보낸다.
 *
 * **3. `/about`** — "같은 지역, 비슷한 예산의 사례를 커뮤니티에서 확인" 이라고
 * 하는데 커뮤니티 필터는 category·sort·period·tag·author·bookmarked 뿐이고
 * 동기방 RPC 는 연·월만 받는다. 제품 계약 §9 가 이 문구를 명시적으로 금지한다.
 *
 * **4. 랜딩** — "받은 견적을 넣으면" 이라고 하는데 견적 점검 화면에는
 * input·textarea 가 0개다. 항목별 버튼을 누르는 체크리스트다.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

/** 주석을 걷어낸 소스. 주석은 "왜 이 문구를 안 쓰는가" 를 설명해야 한다. */
function visible(source: string): string {
  return source
    .replace(/\{\/\*[\s\S]*?\*\/\}/gu, "")
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .replace(/^\s*\/\/.*$/gmu, "");
}

describe("커뮤니티에 없는 필터를 약속하지 않는다", () => {
  // 계약 §9 의 "코호트 조건 카피 가드". RPC 가 분기만 받는 동안 유지한다.
  const BANNED = ["같은 지역, 비슷한 예산", "같은 지역/예산", "조건이 비슷한 사람", "비슷한 예산의 사례"];
  const SCREENS = [
    "src/components/landing/FiveRoles.tsx",
    "src/components/landing/redesign/landingContent.ts",
    "src/components/community/StartHereClient.tsx",
  ];

  it.each(SCREENS)("%s", (path) => {
    const text = visible(read(path));
    for (const phrase of BANNED) {
      expect(text, `계약이 금지한 문구입니다: ${phrase}`).not.toContain(phrase);
    }
  });

  it("동기방 RPC 가 아직 연·월만 받는다", () => {
    // 이 가드를 푸는 조건은 RPC 가 지역·예산을 받게 되는 것이다. 그때까지 유지한다.
    const sql = read("../../supabase/migrations/20260802180000_community_cohort_assignment_atomic.sql");
    expect(sql).toContain("p_year");
    expect(sql).toContain("p_month");
    expect(sql.includes("p_region")).toBe(false);
    expect(sql.includes("p_budget")).toBe(false);
  });
});

describe("닫힌 체험을 있는 것처럼 말하지 않는다", () => {
  it("/demo 가 로그인 전 체험을 현재형으로 설명하지 않는다", () => {
    const text = visible(read("src/app/demo/page.tsx"));
    expect(text).not.toContain("로그인 전 체험은");
    expect(text).not.toContain("로그인 없이 체험을");
  });
});

describe("견적 점검 화면에 없는 입력을 약속하지 않는다", () => {
  it("화면에 입력란이 없다는 사실을 먼저 고정한다", () => {
    // 문구가 참인지 재려면 목적지가 무엇인지부터 알아야 한다. 나중에 입력란이
    // 생기면 이 검사가 먼저 깨지고, 그때 문구를 되돌리면 된다.
    const screen = read("src/app/(community)/community/quote-check/page.tsx");
    expect(screen.includes("<input"), "입력란이 생겼습니다 — 문구를 다시 보세요").toBe(false);
    expect(screen.includes("<textarea"), "입력란이 생겼습니다 — 문구를 다시 보세요").toBe(false);
  });

  it("랜딩이 '넣으면' 이라고 하지 않는다", () => {
    const text = visible(read("src/components/landing/redesign/landingContent.ts"));
    expect(text).not.toContain("받은 견적을 넣으면");
    expect(text).not.toContain("넣은 견적은");
  });
});
