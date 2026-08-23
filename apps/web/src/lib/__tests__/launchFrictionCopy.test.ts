// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 출시 전 감사에서 나온 **말이 사실과 어긋나던 자리**들을 고정한다.
 *
 * 이 파일이 지키는 것은 코드 모양이 아니라 **약속**이다. 각 검사는 "사용자가 읽는 문장이
 * 실제 동작과 같은가" 하나만 본다. 문구를 다듬는 것은 자유지만, 사실이 아닌 쪽으로
 * 돌아가면 여기가 막는다.
 */

const web = (...parts: string[]) => resolve(process.cwd(), "src", ...parts);
const mobile = (...parts: string[]) =>
  resolve(process.cwd(), "..", "mobile", ...parts);
/**
 * **주석을 지우고 읽는다.**
 *
 * 변형 시험에서 잡혔다 — 화면 문구를 지워도 검사가 통과했다. 그 문구를 인용한
 * **내 설명 주석**이 파일에 남아 있었기 때문이다. 이 저장소가 전에도 겪은 함정이다.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

const read = (path: string) => stripComments(readFileSync(path, "utf8"));

describe("되돌릴 수 없는 일은 되돌릴 수 없다고 말한다", () => {
  const settings = read(web("app", "(app)", "settings", "page.tsx"));

  it("검사가 실제로 파일을 읽는다", () => {
    expect(settings.length).toBeGreaterThan(2000);
    expect(settings).toContain("새 커플로 다시 시작할까요?");
  });

  it("커플 초기화가 '다시 연결할 수 있다'고 말하지 않는다", () => {
    // 끊긴 자리는 봉인되고 재삽입을 트리거가 영구 차단한다. 예전 문구
    // "새 파트너 코드로 다시 연결할 수 있어요" 는 되돌릴 수 있는 일처럼 읽혔다.
    expect(
      settings.includes("새 파트너 코드로 다시 연결할 수 있어요"),
      "되돌릴 수 없는 일을 되돌릴 수 있다고 말한다",
    ).toBe(false);
    expect(settings).toContain("이 작업은 되돌릴 수 없어요");
  });
});

describe("연결 상태를 못 읽은 것과 커플이 잘못된 것은 다르다", () => {
  const settings = read(web("app", "(app)", "settings", "page.tsx"));

  it("불러오는 중과 실패를 따로 그린다", () => {
    // 예전에는 셋(로딩·모름·실패)을 한 화면으로 그려서, 파트너가 아직 없는 사람이
    // 설정을 열자마자 「연결 상태를 확인하지 못했어요 · 고객지원 문의」를 봤다.
    //
    // **문구가 아니라 배선을 본다.** 첫 판은 문구만 봤는데, 갈래의 조건을 `false` 로
    // 바꿔 화면에서 끊어도 죽은 JSX 가 파일에 남아 통과했다(변형 시험이 잡음).
    expect(settings).toContain('useState<"loading" | "ready" | "failed">');
    expect(settings).toContain('connectionLookup === "loading" ?');
    expect(settings).toContain('connectionLookup === "failed" ?');
    expect(settings).toContain('setConnectionLookup("loading")');
    expect(settings).toContain('setConnectionLookup("ready")');
    expect(settings).toContain('setConnectionLookup("failed")');
    expect(settings).toContain("연결 상태를 불러오는 중이에요");
    expect(settings).toContain("연결 상태를 불러오지 못했어요");
  });

  it("실패했을 때 다시 시도할 길이 있다", () => {
    expect(settings).toContain("다시 시도");
    expect(settings).toContain("setConnectionRetryNonce");
  });
});

describe("새 메일 받는 법을 알려준다", () => {
  const messages = read(web("lib", "auth", "authErrorMessages.ts"));

  it("'새 메일을 받아 다시 시도해주세요'로 끝내지 않는다", () => {
    // 받는 법을 안 알려주면 가입 0분차에 길이 끊긴다. 나가는 문은 둘 다 살아 있다.
    for (const key of ["link_expired", "verify_failed"]) {
      const line = messages
        .split("\n")
        .find((row) => row.trim().startsWith(key));
      expect(line, `${key} 를 못 찾았다`).toBeTruthy();
    }
    expect(messages).toContain("회원가입");
    expect(messages).toContain("비밀번호 찾기");
  });
});

describe("체크리스트 카드는 체크리스트로 간다", () => {
  const landing = read(
    web("components", "community", "CommunityLandingClient.tsx"),
  );

  it("일정 화면으로 보내지 않는다", () => {
    // 일정 화면의 기본 뷰가 달력이 된 뒤로, 「체크리스트」 카드가 거기로 가면
    // 카드 설명("할 일과 끝낸 일")과 도착지가 어긋난다.
    // `label: "예산"` 은 이 파일 위쪽 커뮤니티 태그 목록에도 있다(:155). 앞에서부터
    // 찾으면 체크리스트보다 앞을 가리켜 잘라낸 구간이 빈다 — 첫 판이 그래서 실패했다.
    // 반드시 **체크리스트 뒤에서** 다음 카드를 찾는다.
    const start = landing.indexOf('label: "체크리스트"');
    expect(start, "체크리스트 카드를 못 찾았다").toBeGreaterThan(-1);
    const end = landing.indexOf('label: "예산"', start);
    expect(end, "체크리스트 다음 카드를 못 찾았다").toBeGreaterThan(start);
    const checklistCard = landing.slice(start, end);
    expect(checklistCard.length).toBeGreaterThan(20);
    expect(checklistCard).toContain('href: "/checklist"');
    expect(checklistCard).not.toContain('href: "/schedule"');
  });
});

describe("모바일 온보딩은 미리 고르지 않는다", () => {
  const onboarding = read(mobile("app", "onboarding", "index.tsx"));

  it("커플 시작 방식의 기본값이 없다", () => {
    // 기본값이 "create" 이면 초대받은 사람이 아무것도 안 누르고 자기 커플을 만든다.
    // 그렇게 만들어진 커플은 서버가 뒤늦은 합류를 영구 거절해 되돌릴 수 없다.
    expect(onboarding).toContain("useState<CoupleAction | null>(null)");
    expect(onboarding).not.toContain('useState<CoupleAction>("create")');
  });

  it("고르기 전에는 제출되지 않는다", () => {
    expect(onboarding).toContain("if (coupleAction === null) {");
    expect(onboarding).toContain("어떻게 시작할지 골라주세요");
  });
});
