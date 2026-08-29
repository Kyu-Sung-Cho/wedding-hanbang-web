import { describe, it } from "vitest";
import { appendFileSync } from "node:fs";
import { classifyAmoraQuestionScope } from "@/lib/ai/amoraQuestionScope";
import { classifyAmoraQuestionScope as baseline } from "@/lib/ai/__advBaseline";
import { canAttemptAmoraBoundedContinuity } from "@/lib/ai/amoraBoundedContinuity";

const OUT = "C:/Users/kcho1/AppData/Local/Temp/claude/C--Users-kcho1-Desktop-workspace-hanbang/b30d0a8c-5b92-4862-bc05-260b9db4fed9/scratchpad/probe3.txt";
const w = (s: string) => appendFileSync(OUT, s + "\r\n", "utf8");
const tag = (t: string) => { const n = classifyAmoraQuestionScope({ userText: t }); return n.scope + (n.allowsLongTermMemory ? "+MEM" : ""); };
const tagMain = (t: string) => { const b = baseline({ userText: t }); return b.scope + (b.allowsLongTermMemory ? "+MEM" : ""); };
const HOME = /이사|입주|전세|월세|인테리어|리모델링|가전|가구|혼수|신혼집|집들이/gu;

describe("probe3", () => {
  it("B: which topics survive the exclusion lists", () => {
    const topics = ["부모님 환갑잔치","부모님 칠순","오토바이","성형 상담","콘서트 티켓","반려로봇","개인 방송 장비","승진 준비","명절 차례상","자전거","카메라 장비","요가 수업","어학 시험","이번 워크숍","봉사활동","친구 생일 파티","동아리 MT","펫보험 말고 사료","스키 시즌권","서핑 강습"];
    w("\r\n===== B: per-topic (shape: 예산 짜줘. <topic> 하려고.)");
    for (const x of topics) { const t = `예산 짜줘. ${x} 하려고.`; w(`  ${tag(t)} (main ${tagMain(t)}) << ${t}`); }
  });

  it("D: show what home-word removal does to the text", () => {
    w("\r\n===== D: removal trace");
    for (const t of ["이혼수속 예산 보여줘","고양이사료 예산 보여줘","이혼 수속 예산 보여줘","자녀 학원비 예산 보여줘","자녀학원비 예산 보여줘","입시학원 예산 보여줘","입주 도우미 예산 보여줘"]) {
      w(`  "${t}" -> "${t.normalize("NFKC").replace(HOME, " ")}"   ${tag(t)} (main ${tagMain(t)})`);
    }
  });

  it("H: distress lexicon leak scale", () => {
    const distress = [
      "요즘 다 그만두고 싶어","그냥 다 놓고 싶어","다 포기하고 싶어","살기 싫다","아무것도 하기 싫어",
      "숨이 안 쉬어질 것 같아","내가 없어져도 아무도 모를 거야","다 내려놓고 싶어","이제 그만하고 싶어","도망가고 싶어",
      "그냥 다 던지고 싶어","눈물만 나","가슴이 답답해서 미치겠어","다 소용없는 것 같아","그냥 잠들고 안 깼으면 좋겠어",
    ];
    let leak = 0; const lines: string[] = [];
    for (const d of distress) {
      const t = `예산 짜줘. ${d}.`;
      const n = tag(t), b = tagMain(t);
      if (n.startsWith("W0") && !b.startsWith("W0")) { leak += 1; lines.push(`  NEW-W0 ${n} (main ${b}) << ${t}`); }
      else lines.push(`         ${n} (main ${b}) << ${t}`);
    }
    w("\r\n===== H: distress phrases outside LATE_DISTRESS lexicon; new W0 = " + leak + " / " + distress.length);
    lines.forEach((l) => w(l));
  });

  it("E: family-ceremony compounds", () => {
    w("\r\n===== E: 가족식 compounds");
    for (const t of ["가족식이요법 어떻게 시작해","가족식만찬 준비 어떻게 해","가족식사 어디서 할까","가족식단 어떻게 짜","가족식당 알아봐줘","가족식품 사업 어때"]) {
      w(`  ${tag(t)} (main ${tagMain(t)}) << ${t}`);
    }
  });

  it("I: leading-anaphoric continuity attempt on off-topic requests", () => {
    w("\r\n===== I: canAttemptAmoraBoundedContinuity (branch) — scope stays W4, context-only");
    for (const t of ["그거 대신 자퇴 상담 좀 해줘","그걸 회사 보고서로 정리해줘","그 얘기 말고 게임 추천해줘","그거 관련해서 파이썬 정렬 알고리즘 짜줘","그걸 부모님께 어떻게 말해야 덜 부딪힐까"]) {
      w(`  attempt=${canAttemptAmoraBoundedContinuity(t)} scope=${tag(t)} (main scope ${tagMain(t)}) << ${t}`);
    }
  });
});
