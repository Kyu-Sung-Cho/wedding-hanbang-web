import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  BETA_DISABLED_TOOL_NAMES,
  BETA_SAFE_TOOLS,
  WEDDING_TOOLS,
} from "@/lib/ai/tools";
import { selectAmoraTools } from "@/lib/ai/amoraToolPolicy";
import { getSpecialistPromptAddon, routeSpecialist } from "@/lib/ai/stage-router";
import { chooseAmoraChatModelRole } from "@/lib/ai/modelConfig";
import { PROTECTION_TOOL_NAMES } from "@/components/app/chat/ProtectionToolCard";

/**
 * 계약 개입 금지 — 파운더 결정, 2026-08-18.
 *
 * 계약서·약관 해석과 계약 위험 등급 부여는 법률사무에 해당할 소지가 있고,
 * 제품 계약 §9의 "판정 금지(점수·등급)"와도 정면으로 어긋난다. 그래서 도구·
 * 전문분야·프롬프트·UI 카드 네 경로를 모두 닫고, 등급을 산출하던 모듈
 * (lib/amora/contractShield.ts, 503줄)과 그 실행기를 저장소에서 삭제했다.
 *
 * 이 파일은 그 결정이 조용히 되살아나는 것을 막는다. 여기가 깨지면 "테스트를
 * 고치는" 것이 아니라 왜 계약 개입이 다시 들어왔는지를 먼저 확인해야 한다.
 * 되살리려면 법무 검토가 선행되어야 한다.
 *
 * 유지되는 것: 공시 자료 열람(/price)과 견적 확인(analyze_quote). 둘 다
 * 아모라가 해석·판정하지 않고, 공개 자료를 보여주거나 업체에 물어볼 질문만
 * 만든다. 이 테스트는 그 둘이 함께 죽지 않았는지도 확인한다.
 */
describe("계약 개입 금지 (2026-08-18)", () => {
  it("계약 점검 도구가 스키마 목록에서 사라졌고 묘비가 남아 있다", () => {
    // 스키마 자체가 삭제됐다 — 업체 도구처럼 "보존하되 끔"이 아니다.
    expect(WEDDING_TOOLS.map((tool) => tool.name))
      .not.toContain("analyze_contract_readiness");
    expect(BETA_SAFE_TOOLS.map((tool) => tool.name))
      .not.toContain("analyze_contract_readiness");
    // 같은 이름의 도구가 다시 추가되더라도 모델에 닿지 못하게 막는 묘비.
    expect(BETA_DISABLED_TOOL_NAMES.has("analyze_contract_readiness")).toBe(true);
  });

  it("계약 위험 등급을 산출하던 모듈이 저장소에 없다", () => {
    // 정적 import로는 검증할 수 없다(타입체크가 먼저 깨진다). 파일 부재로 확인한다.
    for (const relativePath of [
      "../../amora/contractShield.ts",
      "../../amora/__tests__/contractShield.test.ts",
    ]) {
      expect(existsSync(fileURLToPath(new URL(relativePath, import.meta.url)))).toBe(false);
    }
  });

  it("계약 관련 발화가 계약 검토 전문분야를 만들지 않는다", () => {
    for (const text of [
      "계약서 검토해줘",
      "위약금이 얼마인지 봐줘",
      "이거 환불 받을 수 있어?",
      "약관 조항이 불리한지 봐줘",
      "손해배상 청구할 수 있을까",
    ]) {
      expect(routeSpecialist(text, "preparation_1")).not.toBe("contract_reviewer");
    }
  });

  it("은퇴한 전문분야는 프롬프트 애드온도 모델 승급도 만들지 않는다", () => {
    expect(getSpecialistPromptAddon("contract_reviewer")).toBe("");
    expect(chooseAmoraChatModelRole({
      specialistType: "contract_reviewer",
      userText: "이 계약 어때?",
      correctionCount: 0,
    })).toBe("fast");
  });

  it("문서를 첨부해도 계약 검토로 넘어가지 않되, 견적 확인은 살아 있다", () => {
    const selected = selectAmoraTools({
      availableTools: BETA_SAFE_TOOLS,
      userText: "이 견적서 같이 봐줘",
      specialistType: "general",
      attachmentKind: "document",
    }).map((tool) => tool.name);

    expect(selected).not.toContain("analyze_contract_readiness");
    expect(selected).toContain("analyze_quote");
    // 2026-11-16: 시세 도구는 함께 붙지 않는다 — 참가격 자료를 쓰지 않는다(파운더 결정 D-79).
    expect(selected).not.toContain("get_market_price");
  });

  it("계약 점검 결과 카드를 렌더할 경로가 없다", () => {
    expect(PROTECTION_TOOL_NAMES.has("analyze_contract_readiness")).toBe(false);
  });
});
