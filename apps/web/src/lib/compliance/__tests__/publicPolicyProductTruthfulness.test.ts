import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const appRoot = resolve(process.cwd(), "src/app");
const terms = readFileSync(resolve(appRoot, "terms/page.tsx"), "utf8");
const privacy = readFileSync(resolve(appRoot, "privacy/page.tsx"), "utf8");
const landing = readFileSync(resolve(appRoot, "landing/page.tsx"), "utf8");

describe("public policy product truthfulness", () => {
  it("does not claim that the current beta processes or intermediates payments", () => {
    expect(landing).toContain("업체 예약·결제·계약을 대행하지 않습니다");
    expect(terms).toContain("계약·예약·결제를 대행하거나 중개하지 않습니다");
    expect(privacy).toContain("계약·예약·결제를 대행하거나 중개하지 않으며");
    expect(terms).not.toContain("플랫폼 내 업체 예약·결제는");
    expect(privacy).not.toContain("㈜ 토스페이먼츠");
  });

  it("treats user-entered amounts as planning records, not provider receipts", () => {
    expect(terms).toContain("준비 과정을 정리하기 위한 기록");
    expect(terms).toContain("회사가 결제를 처리했다는 의미가 아닙니다");
  });

  it("requires notice and consent before a future partner-data transfer", () => {
    expect(privacy).toContain("예약 중개 기능이 없습니다");
    expect(privacy).toContain("필요한 동의를 먼저 받습니다");
  });

  it("does not invent a retention duty or claim a disabled OTA service", () => {
    expect(privacy).not.toContain("웹사이트 방문 기록: <strong>3개월</strong>");
    expect(privacy).not.toContain("통신비밀보호법");
    expect(privacy).not.toContain("모바일 앱 업데이트 및 동의 기반 푸시");
    expect(privacy).toContain("실제 운영 목적별 보유기간과 자동 파기 일정을 검증 중");
  });

  it("marks the incomplete cross-border notice as a production blocker", () => {
    expect(privacy).toContain("제6조 (개인정보의 국외 이전)");
    expect(privacy).toContain("본 초안을 국외 이전에 대한 동의나 완성된 고지로 취급하지 않으며");
    expect(privacy).toContain("신규 운영 배포를 차단합니다");
  });

  it("discloses survey fields and keeps unresolved survey retention fail-closed", () => {
    expect(privacy).toContain("고객 설문 응답(성별·연령대·예산 구간");
    expect(privacy).toContain("설문 처리 동의 버전·시각");
    expect(privacy).toContain("직접 식별자가 포함된 자유서술은 저장을 거부합니다");
    expect(privacy).toContain("응답 보유기간과 자동 파기 일정은 아직 확정되지 않았으므로");
  });
});
