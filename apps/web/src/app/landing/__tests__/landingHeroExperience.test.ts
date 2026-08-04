// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const appRoot = resolve(process.cwd());
const hero = readFileSync(
  resolve(appRoot, "src/components/landing/redesign/TransformationHero.tsx"),
  "utf8",
);
const content = readFileSync(
  resolve(appRoot, "src/components/landing/redesign/landingContent.ts"),
  "utf8",
);

function sourceWindowAround(copy: string, before = 500, after = 260): string {
  const copyIndex = hero.indexOf(copy);
  expect(copyIndex, `새 Hero에서 계약 문구를 찾지 못함: ${copy}`).toBeGreaterThanOrEqual(0);
  return hero.slice(Math.max(0, copyIndex - before), copyIndex + copy.length + after);
}

describe("landing hero product experience contract", () => {
  it("explains the product in plain language before asking for action", () => {
    expect(content).toContain("웨딩한방 · 둘이 함께 관리하는 결혼 준비 공간");
    expect(content).toContain("아모라 · 대화를 정리하는 AI");
    expect(content).toContain("날짜를 넣으면 지금 볼 세 가지가 나와요");
    expect(content).toContain("이어서 예산·할 일·일정을 아모라에게 말해보세요");
    expect(content).toContain("계정 베타에서는 한 번에 한 가지 변경을 제안하고");
    expect(content).toContain("한 번에 한 가지 변경을 제안하고");
    expect(content).toContain("확인한 변경만 준비 기록에 반영해요");
    expect(content).toContain("아모라와 시작하기");
    expect(hero).toContain("예산");
    expect(hero).toContain("할 일");
    expect(hero).toContain("일정");
    expect(hero).toContain("변경 제안");
    expect(hero).toContain("준비에 반영");
    expect(hero).not.toContain("landingContent.hero.emotionalLine");
  });

  it("keeps the no-login first-step action visible from the smallest breakpoint", () => {
    const startHereCta = sourceWindowAround("type=\"submit\"", 80, 900);

    expect(content).toContain("아모라와 시작하기");
    expect(startHereCta).not.toMatch(/className="[^"]*(?:^|\s)hidden(?:\s|$)[^"]*"/);
    expect(hero).toContain('const amoraStartHref = "/start-here"');
    expect(hero).toContain('id="landing-wedding-date"');
    expect(hero).toContain("로그인·결제 없이 지금 볼 세 가지 확인");
    expect(hero).toContain("없어도 시작 가능");
    expect(hero).toContain("첫 날짜 계산은 이 브라우저에서 처리");
    expect(hero).toContain("AI 처리·대화 저장 정책이 적용돼요");
  });

  it("shows one concrete proposal and demonstrates only that applied item without a live AI call", () => {
    const demoSource = hero.slice(hero.indexOf("function ConversationToPlanDemo"));

    expect(hero).toContain('type DemoState = "proposal" | "saved"');
    expect(hero).toContain('useState<DemoState>("proposal")');
    expect(hero).toContain("아모라의 첫 번째 변경 제안");
    expect(hero).toContain("이 일정을 추가할까요?");
    expect(hero).toContain("아직 반영 전");
    expect(hero).toContain("이 일정 반영 예시 보기");
    expect(hero).toContain("각각 별도 제안과 확인이 필요해요");
    expect(hero).not.toContain("세 가지를 찾았어요");
    expect(content).toContain("기능 예시 · 이 화면에서는 실제로 저장되지 않아요");

    for (const forbiddenPersistenceOrNetworkCall of [
      "localStorage",
      "sessionStorage",
      "indexedDB",
      "document.cookie",
      "navigator.sendBeacon",
      "XMLHttpRequest",
      "FormData",
      "fetch(",
      "anthropic",
      "openai",
    ]) {
      expect(demoSource.toLowerCase()).not.toContain(
        forbiddenPersistenceOrNetworkCall.toLowerCase(),
      );
    }
  });

  it("keeps analytics bounded to a non-sensitive source label", () => {
    const captureCalls = [
      ...hero.matchAll(/captureEvent\(\s*"([^"]+)"\s*,\s*\{([\s\S]*?)\}\s*\)/g),
    ];

    expect(captureCalls.length).toBeGreaterThanOrEqual(2);
    for (const [, eventName, payload] of captureCalls) {
      const payloadKeys = [...payload.matchAll(/([A-Za-z_]\w*)\s*:/g)].map(
        (match) => match[1],
      );
      expect(payloadKeys, `${eventName} 이벤트는 source만 전송해야 함`).toEqual(["source"]);
    }
  });

  it("keeps headline and trust-critical copy readable on mobile", () => {
    const h1 = hero.match(/<h1[\s\S]*?<\/h1>/)?.[0] ?? "";
    expect(h1).not.toContain("whitespace-nowrap");

    for (const copy of ["로그인·결제 없이 지금 볼 세 가지 확인", "직접 눌러보는 예시"]) {
      const nearbySource = sourceWindowAround(copy);
      expect(nearbySource).not.toMatch(/className="[^"]*\bhidden\b[^"]*"/);
      expect(nearbySource).not.toMatch(/text-\[(?:8|9)px\]/);
    }
  });

  it("keeps the hero compact and prioritizes the result on smaller screens", () => {
    expect(hero).toContain("lg:min-h-[min(720px,calc(100svh-4rem))]");
    expect(hero).not.toContain("lg:min-h-[min(820px");
    expect(hero).toContain('<div className="relative z-10 max-w-[610px]">');
    expect(hero).toContain("md:grid-cols-[0.88fr_1.12fr]");
    expect(hero).toContain("hidden border-b border-[#243832]/10");
    expect(hero).toContain("md:block md:border-b-0 md:border-r");
  });
});
