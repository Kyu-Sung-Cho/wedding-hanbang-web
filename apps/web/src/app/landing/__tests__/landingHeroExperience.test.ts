// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const appRoot = resolve(process.cwd());
const hero = readFileSync(
  resolve(appRoot, "src/components/landing/CelebrationHero.tsx"),
  "utf8",
);

function sourceWindowAround(copy: string, before = 500, after = 200): string {
  const copyIndex = hero.indexOf(copy);
  expect(copyIndex, `Hero에서 계약 문구를 찾지 못함: ${copy}`).toBeGreaterThanOrEqual(0);
  return hero.slice(Math.max(0, copyIndex - before), copyIndex + copy.length + after);
}

function nearestOpeningTag(copy: string): string {
  const copyIndex = hero.indexOf(copy);
  expect(copyIndex, `Hero에서 계약 문구를 찾지 못함: ${copy}`).toBeGreaterThanOrEqual(0);
  const openingIndex = hero.lastIndexOf("<", copyIndex);
  return hero.slice(openingIndex, copyIndex);
}

describe("landing hero product experience contract", () => {
  it("pairs a human first message with the concrete Amora confirmation loop", () => {
    expect(hero).toMatch(/(둘이|두 사람|우리)[\s\S]{0,120}(대화|결혼|함께)/);
    expect(hero).toContain("커플 공동 채팅");
    expect(hero).toContain("예산·할 일·일정");
    expect(hero).toMatch(/아모라[\s\S]{0,220}(정리|변경을 하나씩 보여)/);
    expect(hero).toMatch(/(확인|이대로 적용)[\s\S]{0,220}(반영|추가)/);
  });

  it("keeps the no-login secondary CTA visible from the smallest breakpoint", () => {
    const startHereCta = sourceWindowAround('href="/start-here"', 40, 600);

    expect(startHereCta).toContain("로그인 없이");
    expect(startHereCta).not.toMatch(/className="[^"]*(?:^|\s)hidden(?:\s|$)[^"]*"/);
  });

  it("keeps the core conversation, D-day, and headings readable on mobile", () => {
    const h1 = hero.match(/<h1[\s\S]*?<\/h1>/)?.[0] ?? "";
    expect(h1).not.toContain("whitespace-nowrap");

    for (const copy of [
      "D-184",
      "드레스 투어, 10월 17일 오후 어때?",
      "좋아. 아모라, 우리 일정에 넣어줘.",
      "아모라의 일정 제안 · 변경 전 확인",
    ]) {
      const nearbySource = sourceWindowAround(copy);
      expect(nearbySource, `${copy}: 모바일에서 hidden이면 안 됨`).not.toMatch(
        /className="[^"]*\bhidden\b[^"]*"/,
      );
      expect(nearbySource, `${copy}: lg에서만 flex이면 안 됨`).not.toContain("lg:flex");
    }
  });

  it("does not render trust-critical copy at nine-pixel utility sizes", () => {
    for (const copy of [
      "기능 예시이며 실제로 저장되지 않아요",
      "나만 상담은 파트너에게 보이지 않아요",
      "아모라의 일정 제안 · 변경 전 확인",
    ]) {
      expect(nearestOpeningTag(copy), copy).not.toMatch(/text-\[(?:8|9)px\]/);
    }
  });

  it("offers a real, clearly bounded no-login mini demo", () => {
    expect(hero).toMatch(/<button[\s\S]*?onClick=/);
    expect(hero).toContain("기능 예시이며 실제로 저장되지 않아요");
    expect(hero).toContain("나만 상담은 파트너에게 보이지 않아요");

    const captureCalls = [
      ...hero.matchAll(
        /captureEvent\(\s*"([^"]+)"\s*,\s*\{([\s\S]*?)\}\s*\)/g,
      ),
    ];
    expect(captureCalls.length).toBeGreaterThan(0);
    expect(
      captureCalls.some(([, eventName]) => /demo|preview|example/.test(eventName)),
      "미니 데모 상호작용을 구분하는 분석 이벤트가 필요함",
    ).toBe(true);

    for (const [, eventName, payload] of captureCalls) {
      const payloadKeys = [...payload.matchAll(/([A-Za-z_]\w*)\s*:/g)].map(
        (match) => match[1],
      );
      expect(payloadKeys, `${eventName} 이벤트는 source만 전송해야 함`).toEqual([
        "source",
      ]);
    }

    for (const browserPersistenceOrTransmission of [
      "localStorage",
      "sessionStorage",
      "indexedDB",
      "document.cookie",
      "navigator.sendBeacon",
      "XMLHttpRequest",
      "FormData",
      "fetch(",
      "<form",
      "<input",
      "<textarea",
    ]) {
      expect(hero).not.toContain(browserPersistenceOrTransmission);
    }
  });
});
