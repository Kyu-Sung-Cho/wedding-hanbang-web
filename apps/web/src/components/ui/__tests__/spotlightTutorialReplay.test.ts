// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { stripComments } from "../../../lib/testing/sourceText";

/**
 * `storageKey`는 "자동으로 다시 뜨지 않게" 하는 장치다. 그런데 event 모드가 같은
 * 검사를 써서, 한 번 본 사람이 "처음이신가요?"를 눌러도 아무 일도 없었다 —
 * 자동 투어가 살아 있던 2026-07-25~26 사이에 한 번 닫은 방문자에게는 죽은 버튼이다.
 *
 * 반대로 선행 가이드 완료 신호로 열리는 투어(ServiceDashboardTutorial·CommunityTutorial)는
 * 이미 본 사람에게 다시 뜨면 안 된다. 그래서 `replayOnTrigger`로 두 의미를 나눈다.
 *
 * ※ 렌더 테스트가 아니라 소스 계약이다. `SpotlightTutorial`은 portal + mounted 이펙트 +
 *   requestAnimationFrame 위치 측정이 겹쳐 현재 jsdom 설정에서는 auto 모드조차
 *   렌더되지 않는다(실측). 실제 화면 확인은 브라우저에서 해야 한다.
 */
const UI_DIR = resolve(process.cwd(), "src", "components", "ui");
const COMMUNITY_DIR = resolve(process.cwd(), "src", "components", "community");
const APP_DIR = resolve(process.cwd(), "src", "components", "app");

const read = (path: string) => stripComments(readFileSync(path, "utf8"));

describe("스포트라이트 투어 재실행 계약", () => {
  const tutorial = read(resolve(UI_DIR, "SpotlightTutorial.tsx"));

  it("명시적 요청은 '이미 봤음'으로 막지 않는다", () => {
    // 이벤트 핸들러가 replayOnTrigger에 따라 갈라져야 한다.
    expect(tutorial).toMatch(/replayOnTrigger\s*\?\s*startNow\(\)\s*:\s*tryStart\(\)/);
  });

  it("startNow는 storageKey를 보지 않고, tryStart는 본다", () => {
    const startNow = tutorial.slice(
      tutorial.indexOf("const startNow"),
      tutorial.indexOf("const tryStart"),
    );
    const tryStart = tutorial.slice(
      tutorial.indexOf("const tryStart"),
      tutorial.indexOf("if (mode === \"auto\")"),
    );

    expect(startNow.length).toBeGreaterThan(0);
    expect(startNow).not.toContain("storageKey");
    expect(tryStart).toContain("storageKey");
  });

  it("첫방문 투어만 재실행을 켠다", () => {
    // 이 이벤트는 "처음이신가요?" 버튼 — 사용자의 명시적 요청이다.
    expect(read(resolve(COMMUNITY_DIR, "CommunityFirstVisitTour.tsx")))
      .toContain("replayOnTrigger");
  });

  it.each([
    [COMMUNITY_DIR, "CommunityTutorial.tsx"],
    [APP_DIR, "ServiceDashboardTutorial.tsx"],
  ])("선행 완료로 열리는 %s/%s는 재실행을 켜지 않는다", (dir, file) => {
    // 이 이벤트는 "선행 가이드가 끝났다"는 신호다. 이미 본 사람에게 다시 뜨면 잔소리다.
    const source = read(resolve(dir, file));
    expect(source).toContain('mode="event"');
    expect(source).not.toContain("replayOnTrigger");
  });
});
