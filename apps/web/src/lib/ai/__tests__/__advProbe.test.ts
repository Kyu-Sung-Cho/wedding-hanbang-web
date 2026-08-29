import { describe, it } from "vitest";
import { appendFileSync } from "node:fs";
import { classifyAmoraQuestionScope } from "@/lib/ai/amoraQuestionScope";
import { classifyAmoraQuestionScope as baseline } from "@/lib/ai/__advBaseline";

const OUT = "C:/Users/kcho1/AppData/Local/Temp/claude/C--Users-kcho1-Desktop-workspace-hanbang/b30d0a8c-5b92-4862-bc05-260b9db4fed9/scratchpad/probe.txt";

function row(t: string) {
  const b = baseline({ userText: t });
  const n = classifyAmoraQuestionScope({ userText: t });
  const mark = n.scope !== b.scope || n.allowsLongTermMemory !== b.allowsLongTermMemory ? "* " : "  ";
  return mark + n.scope + (n.allowsLongTermMemory ? "+MEM" : "") + "  (main " + b.scope + (b.allowsLongTermMemory ? "+MEM" : "") + ")  << " + t;
}

function block(title: string, texts: string[]) {
  const out = ["", "===== " + title + " ====="];
  for (const t of texts) out.push(row(t));
  appendFileSync(OUT, out.join("\r\n") + "\r\n", "utf8");
}

describe("adversarial probe", () => {
  it("A", () => {
    block("A. wedding-state phrase anywhere disables the new canonical topic guard", [
      "결혼 예산 말고 자퇴 예산 얼마나 잡아야 해",
      "결혼 예산 말고 도박 빚 예산 알려줘",
      "결혼 일정 말고 유학 일정 내일로 추가해줘",
      "결혼 예산은 됐고 유튜브 장비 예산 알려줘",
      "신혼 일정 말고 병원 일정 보여줘",
      "청첩장 일정 정리해줘. 그리고 이민 예산 얼마 들어",
      "자퇴 예산 알려줘. 결혼 예산도 궁금하고.",
      "이혼 소송 예산 알려줘. 결혼 예산도 봐줘.",
      "도박 빚 예산 보여줘. 우리 결혼 예산도.",
      "결혼 예산 정했으니까 이제 주식 투자 예산 알려줘",
    ]);
  });

  it("B", () => {
    block("B. leading budget gate + non-wedding topic later", [
      "예산 짜줘. 부모님 환갑잔치 해드리려고.",
      "우리 전체 예산 짜줘. 부모님 칠순잔치 하려고.",
      "예산 좀 잡아줘. 오토바이 사려고.",
      "그럼 우리 예산 좀 정리해줘. 성형 상담 받으려고.",
      "예산 정리해줘. 콘서트 티켓이랑 굿즈 사려고.",
      "혹시 예산 짜줘. 반려로봇 사려고.",
      "지금 항목별 예산 다시 만들어줘. 개인 방송 장비 사려고.",
      "예산 짜줘",
      "여보 우리 예산 다시 짜줘. 나 승진 준비하려고.",
      "예산 좀 줄여줘. 부모님 환갑 선물 사야 해서.",
    ]);
  });

  it("C", () => {
    block("C. positionless branches", [
      "부모님 환갑잔치 예산표 만들어줘",
      "동아리 MT 예산 항목 정리해줘",
      "성형 상담 예산표 보여줘",
      "콘서트 대관료 얼마야",
      "교회 대관료 알려줘",
    ]);
  });

  it("D", () => {
    block("D. home-word removal", [
      "전세계 여러 나라 이민 예산 보여줘",
      "안전세미나 예산 보여줘",
      "이사 자퇴 예산 보여줘",
      "신혼집 알아보는 중. 자퇴 예산 보여줘",
      "가구 소득 대비 학원 예산 얼마 보여줘",
    ]);
  });

  it("E", () => {
    block("E. family ceremony lookahead", [
      "가족식당 예약 도와줘",
      "가족식이요법 예산 알려줘",
      "가족식만찬 준비 도와줘",
      "가족식 40명으로 할래",
      "가족식으로 할래",
      "우리 가족식단 짜줘",
      "가족식탁 새로 사려고",
    ]);
  });

  it("F", () => {
    block("F. misc", [
      "예산",
      "예산 변경해줘",
      "예산 짜줘. 요즘 사는 게 무의미해.",
      "예산 좀 봐줘",
    ]);
  });
});
