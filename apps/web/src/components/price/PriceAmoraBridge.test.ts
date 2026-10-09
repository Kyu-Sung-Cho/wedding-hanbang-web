import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 공시가 화면의 아모라 브릿지가 **없는 것을 약속하지 않는가.**
 *
 * ## 무엇이 있었나 (2026-08-28 감사)
 *
 * "로그인 전에는 아모라 체험을 바로 열 수 있어요." 가 **조건 없이** 그려지고,
 * 그 아래 버튼만 `isPublicDemoTrialEnabled()`(기본 꺼짐) 뒤에 있었다. 그래서
 * 비로그인 방문자는 체험을 약속하는 문장을 읽고 누를 것을 찾지만 아무 버튼도
 * 없다 — 라이브에서 실측했다(문장 있음 / 버튼 0개).
 *
 * 체험을 닫은 커밋(#245)은 다른 화면 셋의 문구를 플래그로 갈랐는데 이 파일만
 * 빠졌다. 그리고 **이 테스트가 그 위반 문장을 고정하고 있었다** — `toContain`
 * 으로 소스에 있는지만 봤기 때문에, 문장이 조건 밖에 있어도 초록불이었다.
 *
 * 그래서 이제 "문자열이 있나" 가 아니라 **"어느 가지에 있나"** 를 본다.
 */
const source = readFileSync(
  resolve(process.cwd(), "src/components/price/PriceAmoraBridge.tsx"),
  "utf8",
);

/** 체험이 켜졌을 때만 그리는 구간(삼항의 참 가지). */
function demoOpenBranch(): string {
  const start = source.indexOf("demoOpen ? (");
  const end = source.indexOf(") : (", start);
  expect(start, "체험 여부로 가르는 삼항이 없습니다").toBeGreaterThan(-1);
  expect(end, "닫힌 경우의 가지가 없습니다").toBeGreaterThan(start);
  return source.slice(start, end);
}

describe("체험이 닫혀 있으면 체험을 약속하지 않는다", () => {
  it("체험 문구가 플래그 안쪽에만 있다", () => {
    const open = demoOpenBranch();
    for (const promise of [
      "로그인 전에는",
      "체험 대화와 변경은 계정 기록에 남지 않아요",
      'label="아모라에게 물어보기"',
    ]) {
      expect(source, `문구가 사라졌습니다: ${promise}`).toContain(promise);
      expect(
        open,
        `${promise} 가 체험 켜짐 가지 밖에 있습니다 — 닫혀도 그려집니다`,
      ).toContain(promise);
    }
  });

  it("닫혀 있어도 갈 곳이 있다", () => {
    // 문구만 지우면 "뭐부터 해야 할지 막막하다면" 아래가 비어 아무 데도 못 간다.
    // 이 자리의 존재 이유가 다음 한 걸음이다.
    const closed = source.slice(source.indexOf(") : ("));
    expect(closed).toContain("아모라와 시작하기");
    expect(closed).toContain('href={weddingPath("/chat")}');
    expect(closed).not.toContain('href="/login?mode=signup"');
    // 닫힌 가지에서 체험을 약속하면 같은 사고가 되풀이된다.
    expect(closed).not.toContain("로그인 전에는");
    expect(closed).not.toContain("체험을 바로 열 수 있어요");
  });

  it("판정을 손으로 짓지 않고 공유 플래그를 쓴다", () => {
    expect(source).toContain("isPublicDemoTrialEnabled()");
    expect(source).not.toContain("NEXT_PUBLIC_DEMO_TRIAL_ENABLED");
  });

  it("옛 과잉 약속이 돌아오지 않는다", () => {
    expect(source).not.toContain("나눈 이야기는 저장되지 않아요");
    expect(source).not.toContain('label="가입 없이 아모라 체험하기"');
  });
});
