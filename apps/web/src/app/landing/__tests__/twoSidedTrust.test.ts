// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const appRoot = resolve(process.cwd());
const source = (relativePath: string) => readFileSync(resolve(appRoot, relativePath), "utf8");

const landing = source("src/app/landing/page.tsx");
const header = source("src/components/landing/redesign/LandingHeader.tsx");
const hero = source("src/components/landing/redesign/TransformationHero.tsx");
const content = source("src/components/landing/redesign/landingContent.ts");
const community = source("src/components/landing/redesign/CommunityBridgeSection.tsx");
const trust = source("src/components/landing/redesign/TrustEvidenceSection.tsx");
const footer = source("src/components/landing/redesign/LandingFooter.tsx");

describe("landing two-sided trust contract", () => {
  it("leads with the concrete Amora loop, then makes its trust evidence verifiable", () => {
    expect(content).toContain("웨딩한방 · 둘이 함께 관리하는 결혼 준비 공간");
    expect(content).toContain("아모라 · 대화를 정리하는 AI");
    expect(content).toContain("확인한 변경만 준비 기록에 반영해요");
    expect(content).toContain("결정은 둘이. 아모라는 정리.");
    expect(content).toContain("광고비 때문에 일반 추천 순서를 바꾸지 않아요");
    expect(content).toContain("AI 답변과 한계를 함께 표시");
    expect(content).toContain("AI는 틀리거나 놓칠 수 있어요");
    expect(content).toContain("기능 예시 · 이 화면에서는 실제로 저장되지 않아요");

    expect(trust).toContain("취소·환불 규정");
    expect(trust).toContain("한국소비자원");
    expect(trust).toContain("시즌·옵션에 따라 실제 계약가가 달라질 수 있고");
    expect(trust).toContain("예약·결제·계약은 업체와 직접 진행해요");
    expect(landing).toContain('const PUBLISHED_COUNTS_VERIFIED_AT = "2026.08.04"');
    expect(footer).toContain("서비스·업체 정보 문의");
    expect(community).toContain("사람의 경험과 AI의 제안을 같은 근거처럼 보여주지 않아요");
    expect(content).toContain("준비 기록에 반영할 변경을 먼저 보여줘요");
    expect(content).not.toContain("무엇을 저장하고 공유할지 먼저 보여줘요");
  });

  it("keeps the editorial journey and navigation anchors in sync", () => {
    expect(landing.match(/id="main-content"/g)).toHaveLength(1);
    expect(header).toContain('href: "#how-it-works"');
    expect(header).toContain('href: "#privacy"');
    expect(header).toContain('href: "#trust"');
    expect(trust).toContain('href="#start-conditions"');
    expect(source("src/components/landing/redesign/PreparationResult.tsx")).toContain('id="how-it-works"');
    expect(source("src/components/landing/redesign/SharedPrivateSection.tsx")).toContain('id="privacy"');
    expect(trust).toContain('id="trust"');
    expect(source("src/components/landing/redesign/ClosingAction.tsx")).toContain('id="start-conditions"');
  });

  it("keeps each call to action aligned with its destination", () => {
    expect(hero).toContain('const amoraStartHref = "/start-here"');
    expect(hero).toContain("href={amoraStartHref}");
    expect(header).toContain('href="/start-here"');
    expect(header).toContain('href="/login"');
    expect(content).toContain("아모라와 시작하기");
    expect(header).toContain(">\n            로그인\n          </Link>");
  });

  it("keeps the disclosure source, paid-ranking promise, and limits visible", () => {
    expect(trust).toContain("자료 출처 · 한국소비자원 참가격");
    expect(trust).toContain("광고는 광고라고 표시하고 일반 추천과 섞지 않아요");
    expect(trust).toContain("시즌·옵션에 따라 실제 계약가가 달라질 수 있고");
    expect(trust).toContain("현재는 한국소비자원");
    expect(trust).not.toContain("제휴사별 최저 기본가");
    const period = source("src/lib/price/period.ts");
    expect(period).toContain("boardTypeCode=0090000122");
  });

  it("does not invent social proof, savings, or pricing claims", () => {
    const allLandingCopy = [landing, header, hero, content, trust, footer].join("\n");
    for (const unsupportedClaim of [
      "누적 이용자",
      "만 명이 선택",
      "시간 절약",
      "비용 절감",
      "최저가 보장",
      "모든 기능 무료",
      "실제 이용 후기",
    ]) {
      expect(allLandingCopy).not.toContain(unsupportedClaim);
    }
  });

  it("states the current first-step conditions without claiming the whole service is free", () => {
    expect(content).toContain("첫 준비 순서");
    expect(content).toContain("로그인 없는 아모라 체험");
    expect(content).toContain("계정으로 계속 관리");
    expect(content).toContain("첫 준비 순서와 로그인 없는 아모라 체험에서는 결제를 요청하지 않아요.");
    expect(content).toContain("체험 대화와 변경은 계정의 준비 기록에 남지 않지만");
    expect(content).toContain("계정 베타의 제공 기능·이용 기간·무료 상담 한도");
    expect(content).toContain("추가 이용 방법과 비용은 아직 정해지지 않았으며");
    expect(content).toContain("신청만으로 결제되지 않아요");
    expect(content).toContain("계정 베타가 제공되면");
    expect(content).toContain("한 번에 한 가지 변경을 제안하면, 확인한 변경만 반영해요");
    expect(content).not.toContain("웨딩한방은 무료");
    expect(content).not.toContain("평생 무료");
  });
});
