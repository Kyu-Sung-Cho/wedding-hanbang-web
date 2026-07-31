// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const appRoot = resolve(process.cwd());
const landing = readFileSync(resolve(appRoot, "src/app/landing/page.tsx"), "utf8");
const hero = readFileSync(
  resolve(appRoot, "src/components/landing/CelebrationHero.tsx"),
  "utf8",
);

describe("landing two-sided trust contract", () => {
  it("leads with the concrete Amora loop, then makes its trust evidence verifiable", () => {
    expect(hero).toContain("결혼 준비 AI · 아모라");
    expect(hero).toContain("커플 공동 채팅");
    expect(hero).toContain("예산·할 일·일정");
    expect(hero).toContain("함께 대화");
    expect(hero).toContain("나만 상담");
    expect(hero).toContain("둘이 말해요");
    expect(hero).toContain("아모라가 정리해요");
    expect(hero).toContain("확인 후 함께 반영해요");
    expect(hero).toContain("변경 전 확인");
    expect(hero).toContain("이대로 적용");
    expect(hero).toContain("기능 예시이며 실제로 저장되지 않아요");
    expect(hero).toContain("나만 상담은 파트너에게 보이지 않아요");
    expect(hero).toContain("우리 둘 준비 시작하기");
    expect(hero).toContain(
      '"/login?mode=signup&redirect=%2Fwedding%2Fchat"',
    );
    expect(hero).toContain("로그인 없이 준비 순서 보기");
    expect(hero).not.toContain("landing-wedding-date");

    expect(landing).toContain("커플 공동 채팅");
    expect(landing).toContain("둘이 이야기해요");
    expect(landing).toContain("아모라가 바뀔 내용을 보여줘요");
    expect(landing).toContain("확인한 것만 함께 남겨요");
    expect(landing).toContain("사용자가 승인한 내용만 반영");
    expect(landing.indexOf("<AmoraSection />")).toBeLessThan(
      landing.indexOf("<ProofBand"),
    );

    expect(landing).toContain("취소·환불 규정");
    expect(landing).toContain("한국소비자원 참가격");
    expect(landing).toContain("추천 순서에는 반영하지 않아요");
    expect(landing).toMatch(/업체 정보 (수정|정정)·서비스 문의/);
    expect(landing).toContain("mailto:${CONTACT.email}");
  });

  it("keeps the editorial journey and navigation anchors in sync", () => {
    expect(landing.match(/id="main-content"/g)).toHaveLength(1);
    for (const anchor of ["proof", "amora", "trust"]) {
      expect(landing.match(new RegExp(`id="${anchor}"`, "g"))).toHaveLength(1);
    }
    expect(landing).toContain('href: "#amora"');
    expect(landing.indexOf("<AmoraSection />")).toBeLessThan(landing.indexOf("<ProofBand"));
  });

  it("keeps each call to action aligned with its destination", () => {
    expect(hero).toContain("href={amoraStartHref}");
    expect(hero).toContain('href="/start-here"');
    expect(hero).toContain("우리 둘 준비 시작하기");
    expect(hero).toContain("로그인 없이 준비 순서 보기");
    expect(landing.match(/href=\{amoraStartHref\}/g)).toHaveLength(2);
    expect(landing).toContain('href="/price"');
    expect(landing).toContain("href={`mailto:${CONTACT.email}`}");
    expect(landing).toContain("우리 둘 준비 시작하기");
  });

  it("keeps the disclosure source, zero-paid-ranking promise, and limits visible", () => {
    expect(landing).toContain("자료 출처 · 한국소비자원 참가격");
    expect(landing).toMatch(
      /kind: "웨딩한방 추천 원칙"[\s\S]*?value: "0"[\s\S]*?광고비로 순서를 바꾼 추천 영역/,
    );
    expect(landing).toContain("시즌·옵션에 따라 실제 계약가가");
    expect(landing).toContain("게시된 자료에 포함된 업체만");
    expect(landing).toContain("예약·결제·계약은 업체와 직접 진행해요");
    expect(landing).not.toContain("대행사별 최저 기본가");
    const period = readFileSync(resolve(appRoot, "src/lib/price/period.ts"), "utf8");
    expect(period).toContain("boardTypeCode=0090000122");
  });

  it("does not frame wedding vendors as the enemy", () => {
    for (const adversarialCopy of [
      "눈탱이 방지",
      "정보를 가진 쪽이 조건을 정하는 시장",
      "가격을 공개하지 않는 업체가 많아",
      "계약하고 나서 금액이 벌어진다",
    ]) {
      expect(landing).not.toContain(adversarialCopy);
    }
  });
});
