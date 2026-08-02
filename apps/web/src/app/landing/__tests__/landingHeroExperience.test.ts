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
    expect(content).toContain("둘이 함께 쓰는 AI 결혼 준비 도우미 · 아모라");
    expect(content).toContain("우리 얘기가, 우리 결혼 준비가 되는 순간.");
    expect(content).toContain("예산·할 일·일정으로 정리하고");
    expect(content).toContain("확인한 내용만 우리 준비에 저장해요");
    expect(content).toContain("내 준비 순서 바로 보기");
    expect(hero).toContain("예산");
    expect(hero).toContain("할 일");
    expect(hero).toContain("일정");
    expect(hero).toContain("확인 후 저장");
  });

  it("keeps the no-login primary CTA visible from the smallest breakpoint", () => {
    const startHereCta = sourceWindowAround("href={amoraStartHref}", 80, 800);

    expect(content).toContain("내 준비 순서 바로 보기");
    expect(startHereCta).not.toMatch(/className="[^"]*(?:^|\s)hidden(?:\s|$)[^"]*"/);
    expect(hero).toContain('const amoraStartHref = "/start-here"');
  });

  it("shows a complete conversation to review to saved-state flow without a live AI call", () => {
    expect(hero).toContain('type DemoState = "conversation" | "review" | "saved"');
    expect(hero).toContain("정리한 내용 보기");
    expect(hero).toContain("이렇게 정리할까요?");
    expect(hero).toContain("확인하고 저장 흐름 보기");
    expect(hero).toContain("확인한 준비만");
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
      expect(hero.toLowerCase()).not.toContain(forbiddenPersistenceOrNetworkCall.toLowerCase());
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

    for (const copy of ["첫 준비 화면의 날짜는 서버로 보내지 않아요", "직접 눌러보는 예시"]) {
      const nearbySource = sourceWindowAround(copy);
      expect(nearbySource).not.toMatch(/className="[^"]*\bhidden\b[^"]*"/);
      expect(nearbySource).not.toMatch(/text-\[(?:8|9)px\]/);
    }
  });
});
